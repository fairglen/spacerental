"""The operator's API as one router (Q50).

Every `/admin/...` route lives in the module of its entity; this package
assembles them under one prefix with the SAME paths, operation ids and tags
the single-file routers had (`tests/test_openapi_stable.py` pins that).
"""

from fastapi import APIRouter

from . import (
    audit,
    blocks,
    bookings,
    calendar,
    dashboard,
    organization,
    packages,
    purchases,
    rooms,
    spaces,
    support,
    users,
)

router = APIRouter(prefix="/admin")
# `blocks` (A02) hangs off a room but is mounted here rather than inside
# rooms.router: a nested include would prepend the rooms tag to its routes,
# and the schema is kept byte-identical to the single-file routers.
for module in (
    dashboard,
    spaces,
    rooms,
    blocks,
    bookings,
    calendar,
    packages,
    organization,
    users,
    purchases,
    audit,
    support,
):
    router.include_router(module.router)

__all__ = ["router"]
