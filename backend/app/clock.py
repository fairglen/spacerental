"""The one place request handlers read the wall clock.

Modules import the module (`from app import clock`) and call `clock.utcnow()`
so a test can pin every reader at once with
`monkeypatch.setattr(clock, "utcnow", lambda: fixed)` and prove
time-dependent behaviour (past slots, hold expiry, late payment) without
sleeping or racing the real clock. Routes not yet migrated still call
`datetime.now` directly and can move over as they are touched.
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(tz=UTC)
