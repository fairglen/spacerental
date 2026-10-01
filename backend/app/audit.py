"""The operator audit trail (G01): who changed what, in the same transaction.

Every admin mutation calls `record` once, after its change and before the
request's session commits, so an audit row exists exactly when the change
does. Snapshots are taken with the entity's PUBLIC schema (`snapshot`):
password hashes, reset tokens and token versions never reach a JSON column
because no public schema carries them, and `tests/test_audit.py` proves it.
A diff keeps only the keys that changed, plus the identifiers, so a row is
readable at a glance; a create or a delete keeps the whole snapshot.
"""

import uuid
from contextvars import ContextVar
from typing import Any

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AdminAction
from app.models.booking import Booking
from app.models.organization import Organization
from app.models.package import Package, UserPackagePurchase
from app.models.room_block import RoomBlock
from app.models.space import AvailabilityRule, Room, Space
from app.models.support import SupportRequest
from app.models.user import User
from app.schemas.admin_users import AuditUserOut
from app.schemas.booking import AdminBookingOut
from app.schemas.organization import OrganizationOut
from app.schemas.package import AdminPurchaseOut, PackageOut
from app.schemas.room_block import RoomBlockOut
from app.schemas.space import AvailabilityRuleOut, RoomOut, SpaceOut
from app.schemas.support import SupportRequestDetailOut

# Set per request by `RequestIdMiddleware`; None outside a request (a script).
request_id_var: ContextVar[str | None] = ContextVar("audit_request_id", default=None)

# The entity types the trail knows, each with the public schema its snapshot
# is taken with. A model absent here cannot be audited: add its PUBLIC
# schema first, never a raw column dump.
_ENTITIES: dict[type, tuple[str, type[BaseModel]]] = {
    Space: ("space", SpaceOut),
    Room: ("room", RoomOut),
    AvailabilityRule: ("availability_rule", AvailabilityRuleOut),
    RoomBlock: ("room_block", RoomBlockOut),
    Booking: ("booking", AdminBookingOut),
    User: ("user", AuditUserOut),
    Package: ("package", PackageOut),
    UserPackagePurchase: ("purchase", AdminPurchaseOut),
    SupportRequest: ("support_request", SupportRequestDetailOut),
    Organization: ("organization", OrganizationOut),
}
ENTITY_TYPES = frozenset(name for name, _ in _ENTITIES.values())

# Written on every flush and saying nothing about the change itself.
_NOISE = frozenset({"updated_at"})
_IDENTIFIERS = ("id",)


def entity_type_of(entity: Any) -> str:
    return _ENTITIES[type(entity)][0]


def snapshot(entity: Any) -> dict:
    """The entity as its public schema shows it, JSON-safe."""
    _, schema = _ENTITIES[type(entity)]
    return schema.model_validate(entity).model_dump(mode="json")


def diff(before: dict | None, after: dict | None) -> tuple[dict | None, dict | None]:
    """Only what changed, plus the identifiers. A one-sided pair (create,
    delete) is kept whole."""
    if before is None or after is None:
        return before, after
    changed = {
        key
        for key in set(before) | set(after)
        if key not in _NOISE and before.get(key) != after.get(key)
    }
    keep = changed | {key for key in _IDENTIFIERS if key in before or key in after}
    return (
        {key: before[key] for key in keep if key in before},
        {key: after[key] for key in keep if key in after},
    )


def _as_dict(value: BaseModel | dict | None) -> dict | None:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    return value


async def record(
    db: AsyncSession,
    *,
    actor: User | None,
    org_id: uuid.UUID,
    entity: Any,
    action: str,
    before: BaseModel | dict | None = None,
    after: BaseModel | dict | None = None,
    reason: str | None = None,
) -> AdminAction:
    """Write the row for one operator action; the caller's transaction commits it.

    `before`/`after` are snapshots (see `snapshot`) or small hand-made dicts
    for an action that is not a plain edit (a role change: `{"role": ...}`).
    `entity` names the row acted on and must be a known entity type.
    """
    stored_before, stored_after = diff(_as_dict(before), _as_dict(after))
    row = AdminAction(
        org_id=org_id,
        actor_user_id=actor.id if actor is not None else None,
        entity_type=entity_type_of(entity),
        entity_id=entity.id,
        action=action,
        before=stored_before,
        after=stored_after,
        reason=reason,
        request_id=request_id_var.get(),
    )
    db.add(row)
    await db.flush()
    return row
