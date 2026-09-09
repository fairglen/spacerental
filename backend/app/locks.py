"""Smart-lock boundary.

Mirrors `app/payments.py` and `app/email.py`'s shape: a `LockGateway`
interface with two implementations chosen by `SEAM_MODE`, so routers never
know which one is live. **Nothing outside this module may know about Seam.**

* `stub` (default) — `StubLockGateway`: no account, no network, no
  credentials. Every issued/revoked code is kept in an in-memory table, so
  `docker-compose up` with zero credentials still lets a developer (or a
  test) see exactly what a real Seam call would have done.
* `live` — `SeamGateway`: plain HTTPS calls to Seam's Access Codes API via
  `httpx` (already a dependency — no vendor SDK needed for two endpoints).
  Missing `SEAM_API_KEY` raises at import time rather than degrading to the
  stub; a stub silently running in production would be far worse than a
  crash.

**Known limitation — no persistence yet.** `Booking` has no column to store
an issued code or its Seam id. Adding one needs an Alembic migration, and
Epic 1's backend PR (`feat/recurring-bookings-backend`, #26) already has an
unmerged migration `0002` in flight — stacking a second `0002` on top of it
would fork the migration history exactly the way T8/#17 had to fix. So this
module keeps issued codes **in the running gateway's memory only**, keyed by
booking id (`LockGateway._issued`), the same shape as `StubEmailGateway.sent`.
This is honest about not surviving a process restart in *either* mode — Seam
codes issued before a redeploy become unrevokable until #26 merges and a
follow-up migration adds real storage. Fine for local/stub development and
for demoing the flow; not fine for production `live` mode as-is.

Same reasoning applies to the room → Seam device mapping: there is no
`rooms.seam_device_id` column yet, so `live` mode resolves it from the
`SEAM_DEVICE_ID_MAP` env var (a JSON object of room id → Seam device id)
instead of the database. A room missing from that map fails only that one
Seam call — logged and swallowed per Epic 3.3, never a 500.
"""

import json
import logging
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache

import httpx

from app.config import settings

logger = logging.getLogger("app.locks")

STUB_MODE = "stub"
LIVE_MODE = "live"

SEAM_API_BASE_URL = "https://connect.getseam.com"


class LockNotConfigured(RuntimeError):
    """Live mode is selected but the Seam configuration is incomplete."""


class LockProviderError(RuntimeError):
    """Seam rejected, timed out on, or could not serve the request."""


@dataclass(frozen=True)
class AccessCode:
    code: str
    external_id: str


class LockGateway(ABC):
    """The interface routers depend on. Neither implementation leaks a
    provider type past this module.

    Owns the in-memory booking_id → AccessCode table itself (see module
    docstring) so both implementations get the same bookkeeping for free;
    subclasses only implement the actual Seam call in `_issue`/`_revoke`.
    """

    def __init__(self) -> None:
        self._issued: dict[uuid.UUID, AccessCode] = {}

    async def issue_access_code(
        self,
        *,
        booking_id: uuid.UUID,
        room_id: uuid.UUID,
        name: str,
        starts_at: datetime,
        ends_at: datetime,
    ) -> AccessCode:
        """Request a code for `room_id`'s lock, valid for `[starts_at, ends_at]`."""
        code = await self._issue(
            booking_id=booking_id,
            room_id=room_id,
            name=name,
            starts_at=starts_at,
            ends_at=ends_at,
        )
        self._issued[booking_id] = code
        return code

    async def revoke_access_code(self, *, booking_id: uuid.UUID) -> None:
        """Revoke the code issued for `booking_id`, if this process issued one.

        A no-op (not an error) if no code is on file — e.g. issuance itself
        already failed best-effort, or this booking was never confirmed.
        """
        code = self._issued.pop(booking_id, None)
        if code is None:
            return
        await self._revoke(booking_id=booking_id, code=code)

    def issued_code_for(self, booking_id: uuid.UUID) -> AccessCode | None:
        """Observability/read hook: what code (if any) is on file for this
        booking. Routers use this to surface `access_code` on read endpoints
        without a database column to select it from."""
        return self._issued.get(booking_id)

    @abstractmethod
    async def _issue(
        self,
        *,
        booking_id: uuid.UUID,
        room_id: uuid.UUID,
        name: str,
        starts_at: datetime,
        ends_at: datetime,
    ) -> AccessCode:
        """Raise LockProviderError on failure."""

    @abstractmethod
    async def _revoke(self, *, booking_id: uuid.UUID, code: AccessCode) -> None:
        """Raise LockProviderError on failure."""


class SeamGateway(LockGateway):
    """Real Seam. Selected by SEAM_MODE=live."""

    def __init__(
        self, api_key: str, device_id_map: dict[str, str], timeout_seconds: float = 10.0
    ) -> None:
        super().__init__()
        self._api_key = api_key
        self._device_id_map = device_id_map
        self._timeout = timeout_seconds

    def _device_id_for_room(self, room_id: uuid.UUID) -> str:
        device_id = self._device_id_map.get(str(room_id))
        if not device_id:
            raise LockProviderError(
                f"No Seam device configured for room {room_id} (SEAM_DEVICE_ID_MAP)"
            )
        return device_id

    async def _issue(
        self,
        *,
        booking_id: uuid.UUID,
        room_id: uuid.UUID,
        name: str,
        starts_at: datetime,
        ends_at: datetime,
    ) -> AccessCode:
        device_id = self._device_id_for_room(room_id)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                response = await client.post(
                    f"{SEAM_API_BASE_URL}/access_codes/create",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={
                        "device_id": device_id,
                        "name": name,
                        "starts_at": starts_at.astimezone(timezone.utc).isoformat(),
                        "ends_at": ends_at.astimezone(timezone.utc).isoformat(),
                    },
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise LockProviderError(str(exc)) from exc

        try:
            payload = response.json()["access_code"]
            return AccessCode(code=payload["code"], external_id=payload["access_code_id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise LockProviderError(
                "Seam returned an unexpected access_codes/create response"
            ) from exc

    async def _revoke(self, *, booking_id: uuid.UUID, code: AccessCode) -> None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                response = await client.post(
                    f"{SEAM_API_BASE_URL}/access_codes/delete",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={"access_code_id": code.external_id},
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise LockProviderError(str(exc)) from exc


class StubLockGateway(LockGateway):
    """Credential-free local stand-in. Selected by SEAM_MODE=stub (default).

    Codes are deterministic (derived from the booking id) rather than random,
    so tests and local debugging can assert an exact value instead of just
    "looks like a code". `revoked_booking_ids` is the observable side effect
    tests assert against instead of a Seam dashboard.
    """

    def __init__(self) -> None:
        super().__init__()
        self.revoked_booking_ids: list[uuid.UUID] = []

    async def _issue(
        self,
        *,
        booking_id: uuid.UUID,
        room_id: uuid.UUID,
        name: str,
        starts_at: datetime,
        ends_at: datetime,
    ) -> AccessCode:
        return AccessCode(
            code=f"{booking_id.int % 1_000_000:06d}",
            external_id=f"seam_stub_ac_{booking_id.hex}",
        )

    async def _revoke(self, *, booking_id: uuid.UUID, code: AccessCode) -> None:
        self.revoked_booking_ids.append(booking_id)


# ─── Best-effort wrappers ───────────────────────────────────────────────────
#
# Epic 3.3: Seam is best-effort, never a hard dependency. A booking create or
# cancel must still return its normal 2xx even if Seam is down, misconfigured,
# or bugs out in a way neither implementation above anticipated — so, unlike
# `app.email`'s narrower `except EmailProviderError`, these catch broad
# `Exception`. Email failures happen in a background task that can never
# surface as a 500 anyway; a lock failure happens inline in the request, so a
# stray bug here must not turn into one.


async def try_issue_access_code(
    gateway: LockGateway,
    *,
    booking_id: uuid.UUID,
    room_id: uuid.UUID,
    name: str,
    starts_at: datetime,
    ends_at: datetime,
) -> AccessCode | None:
    try:
        return await gateway.issue_access_code(
            booking_id=booking_id,
            room_id=room_id,
            name=name,
            starts_at=starts_at,
            ends_at=ends_at,
        )
    except Exception:
        logger.exception("Failed to issue Seam access code for booking %s", booking_id)
        return None


async def try_revoke_access_code(gateway: LockGateway, *, booking_id: uuid.UUID) -> None:
    try:
        await gateway.revoke_access_code(booking_id=booking_id)
    except Exception:
        logger.exception("Failed to revoke Seam access code for booking %s", booking_id)


def attach_access_codes(gateway: LockGateway, bookings) -> None:
    """Set `.access_code` on each ORM `Booking` from the gateway's in-memory
    table, so read endpoints can surface it without a database column.

    `bookings` may be a single `Booking` or any iterable of them. Setting a
    plain attribute on a SQLAlchemy instance that isn't a mapped column is
    safe — it's just a transient Python attribute, never flushed to the DB.
    """
    items = [bookings] if not isinstance(bookings, (list, tuple)) else bookings
    for booking in items:
        code = gateway.issued_code_for(booking.id)
        booking.access_code = code.code if code else None


# ─── Mode selection ─────────────────────────────────────────────────────────


def validate_lock_settings() -> None:
    """Fail loudly on an unusable Seam configuration.

    Called at import time so a live deployment missing its Seam key dies at
    boot instead of quietly running on the stub.
    """
    mode = settings.SEAM_MODE
    if mode not in (STUB_MODE, LIVE_MODE):
        raise LockNotConfigured(
            f"SEAM_MODE must be '{STUB_MODE}' or '{LIVE_MODE}', got {mode!r}"
        )
    if mode == STUB_MODE:
        return
    if not settings.SEAM_API_KEY:
        raise LockNotConfigured(f"SEAM_MODE={LIVE_MODE} but SEAM_API_KEY is not set")


def _parse_device_id_map(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LockNotConfigured(
            "SEAM_DEVICE_ID_MAP must be a JSON object of room id -> Seam device id"
        ) from exc
    if not isinstance(parsed, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
    ):
        raise LockNotConfigured(
            "SEAM_DEVICE_ID_MAP must be a JSON object of string room id -> string device id"
        )
    return parsed


@lru_cache(maxsize=None)
def _build_gateway(
    mode: str, api_key: str | None, device_id_map_json: str | None, timeout_seconds: float
) -> LockGateway:
    if mode == LIVE_MODE:
        return SeamGateway(
            api_key=api_key,
            device_id_map=_parse_device_id_map(device_id_map_json),
            timeout_seconds=timeout_seconds,
        )
    return StubLockGateway()


def get_lock_gateway() -> LockGateway:
    """FastAPI dependency returning the configured gateway."""
    validate_lock_settings()
    return _build_gateway(
        settings.SEAM_MODE,
        settings.SEAM_API_KEY,
        settings.SEAM_DEVICE_ID_MAP,
        settings.SEAM_TIMEOUT_SECONDS,
    )


validate_lock_settings()
