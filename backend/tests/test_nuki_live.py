"""Opt-in Nuki contract test (L01). NEVER runs in CI.

It touches the real Nuki Web API, so it is skipped unless `NUKI_LIVE_TEST=1`
and a token and a device id are set. It registers one keypad PIN named
`fs-contract-<ts>`, waits for the lock to confirm it, reads the log, then
deletes the PIN again — leaving the lock as it found it.

    NUKI_LIVE_TEST=1 NUKI_API_TOKEN=... NUKI_LIVE_DEVICE_ID=... \
      python -m pytest tests/test_nuki_live.py -q -s
"""

import asyncio
import os
import time
from datetime import UTC, datetime, timedelta

import pytest
from app.locks import NukiGateway, generate_pin

pytestmark = pytest.mark.skipif(
    os.environ.get("NUKI_LIVE_TEST") != "1"
    or not os.environ.get("NUKI_API_TOKEN")
    or not os.environ.get("NUKI_LIVE_DEVICE_ID"),
    reason="live Nuki contract test: set NUKI_LIVE_TEST=1, NUKI_API_TOKEN, NUKI_LIVE_DEVICE_ID",
)


async def test_issue_confirm_read_log_then_delete():
    gateway = NukiGateway(api_token=os.environ["NUKI_API_TOKEN"], timeout_seconds=15)
    device_id = os.environ["NUKI_LIVE_DEVICE_ID"]
    name = f"fs-contract-{int(time.time())}"[:20]
    pin = generate_pin()

    auth_id = None
    try:
        # Issue confirms by name internally; poll up to ~60 s for eventual
        # consistency on a slow lock.
        deadline = time.monotonic() + 60
        while True:
            try:
                auth_id = await gateway.issue_for_customer(name, device_id, pin)
                break
            except Exception:
                if time.monotonic() > deadline:
                    raise
                await asyncio.sleep(5)
        assert auth_id

        # The log should be readable (the entry may not be there yet).
        events = await gateway.read_log(device_id, datetime.now(tz=UTC) - timedelta(days=1))
        assert isinstance(events, list)

        state = await gateway.device_state(device_id)
        assert state.door_state_label
    finally:
        if auth_id is not None:
            await gateway.revoke(device_id, auth_id)
