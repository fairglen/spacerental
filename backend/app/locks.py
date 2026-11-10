"""Smart-lock boundary: one PIN per customer on the space's lock (L01).

The owner's model (2026-11-10, superseding O04's per-booking scope): a
customer gets a single door PIN on their first confirmed booking, named on
the lock by our customer id (never the person's name), with no time window —
freedom at the door, audit afterwards (PR B). This module is only the
provider boundary and the PIN primitives; the durable bookkeeping and the
reconciliation pass live in `app/access.py` and `app/holds.py`.

Two implementations chosen by `LOCK_PROVIDER`: `StubLockGateway` (in-memory,
credential-free, with a fake log the tests append to) and `NukiGateway`
(the Nuki Web API over httpx). Neither leaks a provider type past this
module. The gateway never retries and never persists; the pass owns both.

The PIN is encrypted at rest (Fernet, `ACCESS_PIN_KEY`) and never logged.
"""

import binascii
import json
import logging
import secrets
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import cache

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger("app.locks")

STUB_PROVIDER = "stub"
NUKI_PROVIDER = "nuki"

NUKI_API_BASE_URL = "https://api.nuki.io"
# A fixed key the stub uses when ACCESS_PIN_KEY is unset, so local dev and the
# tests exercise real encryption without configuration. Never used by the
# `nuki` provider, which requires an explicit ACCESS_PIN_KEY (validated).
DEV_PIN_KEY = "zGakRnV4t_vZnLaRbW7eSb6u0rBjicew1zkHujt1CoQ="
# Keypad PIN authorisation (Nuki Web API: PUT /smartlock/{id}/auth type 13).
NUKI_AUTH_TYPE_KEYPAD = 13
# Nuki names are at most 20 chars; name the slot by our customer id only.
NUKI_NAME_MAX = 20

# ─── Nuki smartlock log action codes ────────────────────────────────────────
# Source: Nuki Web API Swagger "Model → SmartlockLog" at https://api.nuki.io/
# (interactive Swagger; not statically fetchable). These are the values this
# ingestion knows; the forum confirms 241 = door closed
# (https://developer.nuki.io/t/action-code-241/3008). Ingestion is tolerant:
# any unmapped code is stored raw and classified `unknown`, never crashes.
# DECISION (L01): the owner must re-check these against the live Swagger and
# adjust the constants if Nuki differs — see docs/runbooks/nuki.md.
LOG_ACTION_UNLOCK = 1
LOG_ACTION_LOCK = 2
LOG_ACTION_UNLATCH = 3
LOG_ACTION_LOCK_N_GO = 4
LOG_ACTION_DOOR_OPENED = 240
LOG_ACTION_DOOR_CLOSED = 241

# The event kinds PR B stores (keep in step with the lock_events.kind check).
KIND_KEYPAD_UNLOCK = "keypad_unlock"
KIND_UNLOCK = "unlock"
KIND_LOCK = "lock"
KIND_UNLATCH = "unlatch"
KIND_DOOR_OPEN = "door_open"
KIND_DOOR_CLOSE = "door_close"
KIND_AUTO_LOCK = "auto_lock"
KIND_UNKNOWN = "unknown"

# Nuki door states (GET /smartlock state.doorState).
DOOR_STATE_LABELS = {
    0: "no_sensor",
    1: "deactivated",
    2: "closed",
    3: "open",
    4: "unknown",
    5: "calibrating",
}


class LockNotConfiguredError(RuntimeError):
    """`LOCK_PROVIDER=nuki` was selected but the configuration is incomplete."""


class LockProviderError(RuntimeError):
    """The lock provider rejected, timed out on, or could not serve the request."""


@dataclass(frozen=True)
class LockEvent:
    """One normalised smartlock log entry. `raw` keeps the provider payload so
    an unknown code is never lost."""

    external_id: str
    occurred_at: datetime
    action: int
    trigger: int | None = None
    auth_id: str | None = None
    name: str | None = None
    state: int | None = None
    source: int | None = None
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class DeviceState:
    """What the operator dashboard needs about a lock."""

    online: bool
    door_state: int
    door_state_label: str
    keypad_paired: bool
    battery_critical: bool


def classify_action(action: int, *, attributed_to_keypad: bool, trigger: int | None = None) -> str:
    """Map a Nuki log `action` to a stored `kind`. `attributed_to_keypad` is
    true when the entry's authId resolves to one of our keypad PINs. Unknown
    codes classify `unknown` and are never dropped."""
    if action == LOG_ACTION_UNLOCK:
        return KIND_KEYPAD_UNLOCK if attributed_to_keypad else KIND_UNLOCK
    if action == LOG_ACTION_UNLATCH:
        return KIND_UNLATCH
    if action == LOG_ACTION_LOCK:
        return KIND_LOCK
    if action == LOG_ACTION_DOOR_OPENED:
        return KIND_DOOR_OPEN
    if action == LOG_ACTION_DOOR_CLOSED:
        return KIND_DOOR_CLOSE
    return KIND_UNKNOWN


# ─── PIN primitives ─────────────────────────────────────────────────────────


def generate_pin(exclude: set[str] | None = None) -> str:
    """A Keypad-valid 6-digit PIN: digits 1-9 only (no 0), not starting with
    "12", and not in `exclude` (the codes already on that Keypad). Raises if
    it cannot find one (the keypad is effectively full)."""
    exclude = exclude or set()
    for _ in range(10_000):
        pin = "".join(secrets.choice("123456789") for _ in range(6))
        if pin.startswith("12"):
            continue
        if pin in exclude:
            continue
        return pin
    raise LockProviderError("Could not generate a free Keypad PIN (keypad full?)")


def _fernet() -> Fernet:
    key = settings.ACCESS_PIN_KEY
    if not key:
        if resolve_provider() == STUB_PROVIDER:
            key = DEV_PIN_KEY
        else:
            raise LockNotConfiguredError("ACCESS_PIN_KEY is required to encrypt customer PINs")
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise LockNotConfiguredError(
            "ACCESS_PIN_KEY must be a 32-byte url-safe base64 key (Fernet.generate_key())"
        ) from exc


def encrypt_pin(pin: str) -> str:
    """Encrypt a clear PIN for storage. The result is opaque text; the PIN
    itself never lands in the database or a log."""
    return _fernet().encrypt(pin.encode()).decode()


def decrypt_pin(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise LockProviderError(
            "Stored PIN could not be decrypted (wrong ACCESS_PIN_KEY?)"
        ) from exc


def customer_ref(user_id: uuid.UUID) -> str:
    """The lock-facing name for a customer: `fs-<first 12 of uuid>`, ≤ 20
    chars, never the person's name (privacy)."""
    ref = f"fs-{user_id.hex[:12]}"
    return ref[:NUKI_NAME_MAX]


# ─── Gateway contract ───────────────────────────────────────────────────────


class LockGateway(ABC):
    """The interface `app/access.py` depends on. One PIN per customer on one
    device; the external id is the provider's authorisation id for that PIN."""

    @abstractmethod
    async def issue_for_customer(self, customer_ref: str, device_id: str, pin: str) -> str:
        """Register `pin` on `device_id`'s keypad named `customer_ref`; return
        the provider authorisation id. Raise LockProviderError on failure or
        if the authorisation is not yet confirmable (the pass retries)."""

    @abstractmethod
    async def revoke(self, device_id: str, external_id: str) -> None:
        """Delete the authorisation. Raise LockProviderError on failure."""

    @abstractmethod
    async def set_enabled(self, device_id: str, external_id: str, enabled: bool) -> None:
        """Enable/disable the authorisation without deleting it."""

    @abstractmethod
    async def open_now(self, device_id: str) -> None:
        """Unlock the door once (operator action)."""

    @abstractmethod
    async def read_log(self, device_id: str, since: datetime) -> list[LockEvent]:
        """Log entries at or after `since`, oldest first."""

    @abstractmethod
    async def device_state(self, device_id: str) -> DeviceState:
        """The lock's connectivity, door and battery state."""


class StubLockGateway(LockGateway):
    """Credential-free local lock. Selected by LOCK_PROVIDER=stub (default).

    Holds authorisations and a fake log in memory. `append_log` lets tests
    feed events; `issued` and `revoked` are the observable side effects."""

    def __init__(self) -> None:
        self.issued: dict[tuple[str, str], dict] = {}  # (device_id, external_id) -> record
        self.revoked: list[tuple[str, str]] = []
        self._log: dict[str, list[LockEvent]] = {}
        self.state_overrides: dict[str, DeviceState] = {}

    async def issue_for_customer(self, customer_ref: str, device_id: str, pin: str) -> str:
        external_id = f"stub_auth_{device_id}_{customer_ref}"
        self.issued[(device_id, external_id)] = {
            "name": customer_ref,
            "code": pin,
            "enabled": True,
        }
        return external_id

    async def revoke(self, device_id: str, external_id: str) -> None:
        self.issued.pop((device_id, external_id), None)
        self.revoked.append((device_id, external_id))

    async def set_enabled(self, device_id: str, external_id: str, enabled: bool) -> None:
        record = self.issued.get((device_id, external_id))
        if record is not None:
            record["enabled"] = enabled

    async def open_now(self, device_id: str) -> None:
        self.append_log(
            LockEvent(
                external_id=f"stub_evt_{secrets.token_hex(6)}",
                occurred_at=datetime.now(tz=UTC),
                action=LOG_ACTION_UNLOCK,
                trigger=0,
            ),
            device_id=device_id,
        )

    def append_log(self, event: LockEvent, *, device_id: str) -> None:
        self._log.setdefault(device_id, []).append(event)

    async def read_log(self, device_id: str, since: datetime) -> list[LockEvent]:
        events = [e for e in self._log.get(device_id, []) if e.occurred_at >= since]
        return sorted(events, key=lambda e: e.occurred_at)

    async def device_state(self, device_id: str) -> DeviceState:
        if device_id in self.state_overrides:
            return self.state_overrides[device_id]
        return DeviceState(
            online=True,
            door_state=2,
            door_state_label=DOOR_STATE_LABELS[2],
            keypad_paired=True,
            battery_critical=False,
        )


class NukiGateway(LockGateway):
    """Nuki Web API adapter (https://api.nuki.io). No retries inside the
    gateway — every non-2xx becomes a LockProviderError and the pass decides
    what to do about it."""

    def __init__(self, api_token: str, timeout_seconds: float = 10.0) -> None:
        self._token = api_token
        self._timeout = timeout_seconds

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=NUKI_API_BASE_URL,
            timeout=self._timeout,
            headers={"Authorization": f"Bearer {self._token}"},
        )

    async def _request(
        self, client: httpx.AsyncClient, method: str, path: str, **kwargs
    ) -> httpx.Response:
        try:
            response = await client.request(method, path, **kwargs)
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            # Never include the response body: it could echo a PIN we sent.
            raise LockProviderError(f"Nuki {method} {path} -> {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            raise LockProviderError(f"Nuki {method} {path} failed: {exc!r}") from exc

    async def issue_for_customer(self, customer_ref: str, device_id: str, pin: str) -> str:
        async with self._client() as client:
            # PUT is async and returns 204; the authorisation then appears in
            # GET /auth. Confirm it there (force a sync first), and return its id.
            await self._request(
                client,
                "PUT",
                f"/smartlock/{device_id}/auth",
                json={"name": customer_ref, "type": NUKI_AUTH_TYPE_KEYPAD, "code": int(pin)},
            )
            await self._request(client, "PUT", f"/smartlock/{device_id}/sync")
            auths = (await self._request(client, "GET", f"/smartlock/{device_id}/auth")).json()
            for auth in auths if isinstance(auths, list) else []:
                if auth.get("name") == customer_ref and str(auth.get("id") or auth.get("authId")):
                    return str(auth.get("id") or auth.get("authId"))
        raise LockProviderError(
            f"Nuki authorisation {customer_ref!r} not visible yet on {device_id}; will retry"
        )

    async def revoke(self, device_id: str, external_id: str) -> None:
        async with self._client() as client:
            await self._request(client, "DELETE", f"/smartlock/{device_id}/auth/{external_id}")

    async def set_enabled(self, device_id: str, external_id: str, enabled: bool) -> None:
        async with self._client() as client:
            await self._request(
                client,
                "POST",
                f"/smartlock/{device_id}/auth/{external_id}",
                json={"enabled": enabled},
            )

    async def open_now(self, device_id: str) -> None:
        async with self._client() as client:
            await self._request(
                client, "POST", f"/smartlock/{device_id}/action", json={"action": 1}
            )

    async def read_log(self, device_id: str, since: datetime) -> list[LockEvent]:
        async with self._client() as client:
            rows = (await self._request(client, "GET", f"/smartlock/{device_id}/log")).json()
        events: list[LockEvent] = []
        for row in rows if isinstance(rows, list) else []:
            occurred_at = _parse_nuki_date(row.get("date"))
            if occurred_at is None or occurred_at < since:
                continue
            events.append(
                LockEvent(
                    external_id=str(row.get("id")),
                    occurred_at=occurred_at,
                    action=int(row.get("action", -1)),
                    trigger=row.get("trigger"),
                    auth_id=str(row["authId"]) if row.get("authId") is not None else None,
                    name=row.get("name"),
                    state=row.get("state"),
                    source=row.get("source"),
                    raw=row,
                )
            )
        return sorted(events, key=lambda e: e.occurred_at)

    async def device_state(self, device_id: str) -> DeviceState:
        async with self._client() as client:
            data = (await self._request(client, "GET", f"/smartlock/{device_id}")).json()
        door_state = int((data.get("state") or {}).get("doorState", 4))
        return DeviceState(
            online=int(data.get("serverState", 4)) == 0,
            door_state=door_state,
            door_state_label=DOOR_STATE_LABELS.get(door_state, "unknown"),
            keypad_paired=bool(data.get("keypadPaired") or data.get("keypad2Paired")),
            battery_critical=bool(data.get("batteryCritical")),
        )


def _parse_nuki_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # fromisoformat parses the trailing "Z" natively on 3.11+.
        parsed = datetime.fromisoformat(value)
    except (ValueError, AttributeError):
        return None
    if parsed.tzinfo is not None:
        return parsed
    return parsed.replace(tzinfo=UTC)


def attach_access_codes(gateway: LockGateway, bookings) -> None:
    """Deprecated no-op shim (L01). The per-booking access code is gone — a
    customer now has one PIN shown by the dashboard access card, not a code
    per booking. This keeps the booking response's `access_code` field (now
    always `null`) so the display plumbing can be removed in a follow-up
    without breaking the API this release. `gateway` is ignored.
    """
    items = [bookings] if not isinstance(bookings, (list, tuple)) else bookings
    for booking in items:
        booking.access_code = None


# ─── Device map and mode selection ──────────────────────────────────────────


def parse_device_id_map(raw: str | None) -> dict[str, str]:
    """`NUKI_DEVICE_ID_MAP`: a JSON object of space id -> smartlock id."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LockNotConfiguredError(
            "NUKI_DEVICE_ID_MAP must be a JSON object of space id -> Nuki smartlock id"
        ) from exc
    if not isinstance(parsed, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
    ):
        raise LockNotConfiguredError(
            "NUKI_DEVICE_ID_MAP must map string space id -> string smartlock id"
        )
    return parsed


def device_id_for_space(space_id: uuid.UUID) -> str | None:
    """The smartlock id for a space's entrance, or None when the space has no
    lock configured (issuance is skipped silently, nothing is shown).

    A `"*"` key is a wildcard: one lock for every space, for the common
    single-door operator (and the local/e2e stack, which cannot know the
    seeded space ids). An exact space id always wins over the wildcard.
    """
    mapping = parse_device_id_map(settings.NUKI_DEVICE_ID_MAP)
    return mapping.get(str(space_id)) or mapping.get("*")


def resolve_provider() -> str:
    """The effective lock provider. `SEAM_MODE=stub` is accepted as an alias
    for `LOCK_PROVIDER=stub` for one release (warned), nothing else."""
    if "LOCK_PROVIDER" in settings.model_fields_set:
        return settings.LOCK_PROVIDER
    if "SEAM_MODE" in settings.model_fields_set:
        logger.warning(
            "SEAM_MODE is deprecated; set LOCK_PROVIDER=%s instead (app/locks.py)",
            STUB_PROVIDER if settings.SEAM_MODE == "stub" else NUKI_PROVIDER,
        )
        return STUB_PROVIDER if settings.SEAM_MODE == STUB_PROVIDER else settings.LOCK_PROVIDER
    return settings.LOCK_PROVIDER


def validate_lock_settings() -> None:
    """Fail loudly on an unusable lock configuration, at import, so a `nuki`
    deployment missing its token/map/key dies at boot instead of quietly
    running on the stub."""
    provider = resolve_provider()
    if provider not in (STUB_PROVIDER, NUKI_PROVIDER):
        raise LockNotConfiguredError(
            f"LOCK_PROVIDER must be '{STUB_PROVIDER}' or '{NUKI_PROVIDER}', got {provider!r}"
        )
    if provider == STUB_PROVIDER:
        return
    missing = []
    if not settings.NUKI_API_TOKEN:
        missing.append("NUKI_API_TOKEN")
    if not settings.NUKI_DEVICE_ID_MAP:
        missing.append("NUKI_DEVICE_ID_MAP")
    if not settings.ACCESS_PIN_KEY:
        missing.append("ACCESS_PIN_KEY")
    if missing:
        raise LockNotConfiguredError(
            f"LOCK_PROVIDER=nuki requires {', '.join(missing)}"
        )
    parse_device_id_map(settings.NUKI_DEVICE_ID_MAP)
    _fernet()  # validate the key shape now, not on first issue.


@cache
def _build_gateway(
    provider: str, api_token: str | None, timeout_seconds: float
) -> LockGateway:
    if provider == NUKI_PROVIDER:
        return NukiGateway(api_token=api_token, timeout_seconds=timeout_seconds)
    return StubLockGateway()


def get_lock_gateway() -> LockGateway:
    """FastAPI dependency returning the configured gateway."""
    validate_lock_settings()
    return _build_gateway(
        resolve_provider(), settings.NUKI_API_TOKEN, settings.NUKI_TIMEOUT_SECONDS
    )


validate_lock_settings()
