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
AUTH_ID = "6afb79e15be6e7518d9e3ad4"


def _gw() -> NukiGateway:
    return NukiGateway(api_token="secret-token", timeout_seconds=5)


@respx.mock
async def test_issue_creates_when_nothing_is_named_and_confirms_by_name():
    get = respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        side_effect=[
            httpx.Response(200, json=[{"id": "1", "name": "Entry code"}]),  # lookup before
            httpx.Response(
                200, json=[{"id": "1", "name": "Entry code"}, {"id": AUTH_ID, "name": "fs-abc"}]
            ),
        ]
    )
    put = respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(204)
    )
    sync = respx.post(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/sync").mock(
        return_value=httpx.Response(204)
    )

    auth_id = await _gw().issue_for_customer("fs-abc", DEVICE, "345678")
    assert auth_id == AUTH_ID
    assert put.call_count == 1
    assert sync.called
    assert get.call_count == 2
    sent = put.calls.last.request
    assert b'"type":13' in sent.content
    assert b'"code":345678' in sent.content


@respx.mock
async def test_issue_adopts_an_existing_authorisation_and_never_creates_twice():
    """The 2026-11-16 incident: a code per minute. With one already named
    after the customer, issue re-codes it and returns its id; no PUT."""
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(200, json=[{"id": AUTH_ID, "name": "fs-abc"}])
    )
    put = respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(204)
    )
    update = respx.post(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth/{AUTH_ID}").mock(
        return_value=httpx.Response(204)
    )

    auth_id = await _gw().issue_for_customer("fs-abc", DEVICE, "345678")
    assert auth_id == AUTH_ID
    assert not put.called
    assert update.called
    assert b'"code":345678' in update.calls.last.request.content


@respx.mock
async def test_issue_deletes_duplicates_left_by_earlier_failed_passes():
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": "a1", "name": "fs-abc"},
                {"id": "a2", "name": "fs-abc"},
                {"id": "a3", "name": "fs-abc"},
            ],
        )
    )
    deleted = respx.delete(url__regex=rf"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth/a[23]").mock(
        return_value=httpx.Response(204)
    )
    respx.post(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth/a1").mock(
        return_value=httpx.Response(204)
    )

    assert await _gw().issue_for_customer("fs-abc", DEVICE, "345678") == "a1"
    assert deleted.call_count == 2


@respx.mock
async def test_issue_survives_a_failing_sync_call():
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        side_effect=[
            httpx.Response(200, json=[]),
            httpx.Response(200, json=[{"id": AUTH_ID, "name": "fs-abc"}]),
        ]
    )
    respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(return_value=httpx.Response(204))
    respx.post(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/sync").mock(
        return_value=httpx.Response(405)
    )
    assert await _gw().issue_for_customer("fs-abc", DEVICE, "345678") == AUTH_ID


@respx.mock
async def test_issue_raises_when_the_authorisation_is_not_visible_yet(monkeypatch):
    monkeypatch.setattr("app.locks.ISSUE_VISIBILITY_INTERVAL_SECONDS", 0.0)
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.put(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(httpx.Response(204))
    respx.post(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/sync").mock(httpx.Response(204))
    with pytest.raises(LockProviderError):
        await _gw().issue_for_customer("fs-abc", DEVICE, "345678")


@respx.mock
async def test_a_non_2xx_becomes_a_provider_error_without_the_body():
    respx.get(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth").mock(
        return_value=httpx.Response(200, json=[])
    )
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
async def test_revoke_of_a_foreign_id_deletes_nothing_and_does_not_raise():
    """2026-11-17: a row carried the stub's id from a LOCK_PROVIDER=stub run;
    Nuki answered 500 to its DELETE forever and the row never left pending."""
    route = respx.delete(url__regex=rf"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth/.*").mock(
        return_value=httpx.Response(500)
    )
    await _gw().revoke(DEVICE, "stub_auth_9999_fs-759bd299fd40")
    assert not route.called


@respx.mock
async def test_revoke_treats_404_as_already_gone():
    respx.delete(f"{NUKI_API_BASE_URL}/smartlock/{DEVICE}/auth/{AUTH_ID}").mock(
        return_value=httpx.Response(404)
    )
    await _gw().revoke(DEVICE, AUTH_ID)  # no raise


def test_is_nuki_auth_id():
    from app.locks import is_nuki_auth_id

    assert is_nuki_auth_id("6afb79e15be6e7518d9e3ad4")
    assert not is_nuki_auth_id("stub_auth_22831237479_fs-759bd299fd40")
    assert not is_nuki_auth_id("")
    assert not is_nuki_auth_id(None)


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
