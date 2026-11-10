"""The Nuki Web API adapter (L01), driven against respx — no network, no
token. Proves the request shapes, the async confirm-by-name on issue, the log
mapping, and that every non-2xx becomes a LockProviderError without leaking
the response body (which could echo a PIN).
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from app.locks import (
    NUKI_API_BASE_URL,
    DeviceState,
    LockProviderError,
    NukiGateway,
)

DEVICE = "9999"
AUTH_ID = "4242"


def _gw() -> NukiGateway:
    return NukiGateway(api_token="secret-token", timeout_seconds=5)


@respx.mock
async def test_issue_puts_then_confirms_by_name_and_returns_the_auth_id():
    put = respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(204)
    )
    respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/sync").mock(
        return_value=httpx.Response(204)
    )
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(200, json=[{"id": AUTH_ID, "name": "fs-abc"}])
    )

    auth_id = await _gw().issue_for_customer("fs-abc", DEVICE, "345678")
    assert auth_id == AUTH_ID
    assert put.called
    sent = put.calls.last.request
    assert b'"type":13' in sent.content
    assert b'"code":345678' in sent.content


@respx.mock
async def test_issue_raises_when_the_authorisation_is_not_visible_yet():
    respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(httpx.Response(204))
    respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/sync").mock(httpx.Response(204))
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(200, json=[])
    )
    with pytest.raises(LockProviderError):
        await _gw().issue_for_customer("fs-abc", DEVICE, "345678")


@respx.mock
async def test_a_non_2xx_becomes_a_provider_error_without_the_body():
    respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(409, json={"detail": "code 345678 already used"})
    )
    with pytest.raises(LockProviderError) as exc:
        await _gw().issue_for_customer("fs-abc", DEVICE, "345678")
    assert "345678" not in str(exc.value)
    assert "409" in str(exc.value)


@respx.mock
async def test_revoke_deletes_the_authorisation():
    route = respx.delete(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth/{AUTH_ID}").mock(
        return_value=httpx.Response(204)
    )
    await _gw().revoke(DEVICE, AUTH_ID)
    assert route.called


@respx.mock
async def test_open_now_posts_an_unlock_action():
    route = respx.post(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/action").mock(
        return_value=httpx.Response(204)
    )
    await _gw().open_now(DEVICE)
    assert route.called
    assert b'"action":1' in route.calls.last.request.content


@respx.mock
async def test_read_log_maps_rows_and_filters_by_since():
    now = datetime.now(tz=UTC)
    old = (now - timedelta(hours=3)).isoformat()
    recent = (now - timedelta(minutes=5)).isoformat()
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/log").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": "e1", "date": old, "action": 1, "trigger": 0, "authId": "4242"},
                {"id": "e2", "date": recent, "action": 241, "trigger": 0},
            ],
        )
    )
    events = await _gw().read_log(DEVICE, now - timedelta(hours=1))
    assert [e.external_id for e in events] == ["e2"]
    assert events[0].action == 241


@respx.mock
async def test_device_state_reads_connectivity_and_door():
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}").mock(
        return_value=httpx.Response(
            200,
            json={
                "serverState": 0,
                "state": {"doorState": 2},
                "keypadPaired": True,
                "batteryCritical": False,
            },
        )
    )
    state = await _gw().device_state(DEVICE)
    assert isinstance(state, DeviceState)
    assert state.online is True
    assert state.door_state == 2
    assert state.door_state_label == "closed"
    assert state.keypad_paired is True
