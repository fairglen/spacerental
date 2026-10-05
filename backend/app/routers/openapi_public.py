"""`GET /openapi-public.json` — the API card for agents (S1.5).

The full OpenAPI document describes everything, most of it behind a login.
This one is the public, read-only slice an assistant can use to answer "is
Sala Calma free on Thursday at 16:00?": the spaces, one space with its
rooms and packs, a room's availability and the packs on sale. Each operation
keeps its parameters and schemas from the full document and gets a one-line
description with the semantics that matter to a caller (local dates). Served
as a public, cacheable resource and linked from flowspace.pt/llms.txt.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

CACHE_CONTROL = "public, max-age=3600"

# (path, method) → the one-line description that replaces the full document's.
PUBLIC_OPERATIONS: dict[tuple[str, str], str] = {
    ("/api/v1/spaces", "get"): "The public spaces (active only), each with its active rooms.",
    ("/api/v1/spaces/{space_id}", "get"): (
        "One space with its active rooms; `include=packages` adds the hour packs on sale."
    ),
    ("/api/v1/rooms/{room_id}/availability", "get"): (
        "Bookable one-hour slots of a room for one local date (`date`) or a range "
        "(`from`/`to`, at most 14 days); dates are the space's local calendar days "
        "(Europe/Lisbon), slot times are ISO 8601 with offset."
    ),
    ("/api/v1/packages", "get"): (
        "The hour packs on sale for an organisation (`org_id`), cheapest first."
    ),
}

INFO_DESCRIPTION = (
    "Read-only, unauthenticated endpoints of the FlowSpace booking platform: spaces, "
    "rooms, availability and hour packs. Booking itself needs an account "
    "(POST /api/v1/bookings, Bearer JWT) and is not described here."
)


def _collect_refs(node: Any, found: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            found.add(ref.rsplit("/", 1)[1])
        for value in node.values():
            _collect_refs(value, found)
    elif isinstance(node, list):
        for item in node:
            _collect_refs(item, found)


def public_document(full: dict[str, Any]) -> dict[str, Any]:
    paths: dict[str, dict[str, Any]] = {}
    for (path, method), description in PUBLIC_OPERATIONS.items():
        operation = dict(full["paths"][path][method])
        operation.pop("security", None)
        operation["summary"] = description.split(";")[0].split(":")[0].rstrip(".")
        operation["description"] = description
        paths.setdefault(path, {})[method] = operation

    # Only the schemas these operations reach, transitively.
    schemas = full.get("components", {}).get("schemas", {})
    needed: set[str] = set()
    _collect_refs(paths, needed)
    while True:
        before = set(needed)
        for name in list(needed):
            _collect_refs(schemas.get(name, {}), needed)
        if needed == before:
            break

    return {
        "openapi": full["openapi"],
        "info": {
            "title": "FlowSpace — public availability API",
            "version": full["info"]["version"],
            "description": INFO_DESCRIPTION,
        },
        "paths": paths,
        "components": {
            "schemas": {name: schemas[name] for name in sorted(needed) if name in schemas},
        },
    }


@router.get("/openapi-public.json", include_in_schema=False)
async def openapi_public(request: Request) -> JSONResponse:
    return JSONResponse(
        public_document(request.app.openapi()), headers={"Cache-Control": CACHE_CONTROL}
    )
