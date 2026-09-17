"""The one place request handlers read the wall clock.

Routes call `utcnow()` instead of `datetime.now(tz=UTC)` so a test can pin
the clock with `monkeypatch.setattr(module, "utcnow", lambda: fixed)` and
prove time-dependent behaviour (past slots, hold expiry) without sleeping or
racing the real clock. Only the availability listing uses it so far; other
routes still call `datetime.now` directly and can migrate as they are touched.
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(tz=UTC)
