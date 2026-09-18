"""Unit tests for the pure cancellation rule (C07: the exact 24-hour boundary).

`validate_cancellation` takes `now` explicitly, so the boundary is pinned here
without a database or a clock race; the route-level 400 is covered by
`test_bookings.py::test_cancel_within_24h_returns_400`.
"""

from datetime import UTC, datetime, timedelta

import pytest
from app.booking_cancellation import validate_cancellation
from app.models.booking import Booking, BookingStatus
from fastapi import HTTPException


def _booking(start: datetime, status: BookingStatus = BookingStatus.confirmed) -> Booking:
    return Booking(start_time=start, end_time=start + timedelta(hours=1), status=status)


NOW = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


class TestTwentyFourHourBoundary:
    def test_more_than_24h_ahead_is_allowed(self):
        validate_cancellation(_booking(NOW + timedelta(hours=24, seconds=1)), NOW)

    def test_exactly_24h_ahead_is_allowed(self):
        # `start - now < 24h` rejects; exactly 24h is not less than 24h.
        validate_cancellation(_booking(NOW + timedelta(hours=24)), NOW)

    def test_one_second_inside_24h_is_rejected(self):
        with pytest.raises(HTTPException) as exc:
            validate_cancellation(_booking(NOW + timedelta(hours=23, minutes=59, seconds=59)), NOW)
        assert exc.value.status_code == 400
        assert "24 hours" in exc.value.detail

    def test_already_cancelled_is_rejected_before_the_window_check(self):
        with pytest.raises(HTTPException) as exc:
            validate_cancellation(
                _booking(NOW + timedelta(days=3), status=BookingStatus.cancelled), NOW
            )
        assert exc.value.status_code == 400
        assert "already cancelled" in exc.value.detail
