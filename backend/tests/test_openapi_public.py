"""S1.5 — the public OpenAPI card: only the unauthenticated reads, cacheable,
self-contained, with one-line descriptions."""

import pytest
from app.routers.openapi_public import CACHE_CONTROL, PUBLIC_OPERATIONS

pytestmark = pytest.mark.asyncio

EXPECTED_PATHS = {
    "/api/v1/spaces",
    "/api/v1/spaces/{space_id}",
    "/api/v1/rooms/{room_id}/availability",
    "/api/v1/packages",
}


async def test_the_card_lists_exactly_the_public_reads_and_is_cacheable(client):
    response = await client.get("/openapi-public.json")
    assert response.status_code == 200
    assert response.headers["cache-control"] == CACHE_CONTROL
    doc = response.json()
    assert set(doc["paths"]) == EXPECTED_PATHS
    assert {m for ops in doc["paths"].values() for m in ops} == {"get"}
    assert "FlowSpace" in doc["info"]["title"]
    assert "Lisbon" in doc["paths"]["/api/v1/rooms/{room_id}/availability"]["get"]["description"]


async def test_no_operation_requires_authentication_and_every_description_is_one_line(client):
    doc = (await client.get("/openapi-public.json")).json()
    for path, ops in doc["paths"].items():
        for op in ops.values():
            assert "security" not in op, path
            assert "\n" not in op["description"], path
            assert op["summary"], path


async def test_every_public_operation_exists_in_the_full_document_without_a_lock(client):
    # The mapping cannot name an operation the API no longer has, nor one
    # that needs a token — the card would promise what a caller cannot get.
    full = (await client.get("/openapi.json")).json()
    for path, method in PUBLIC_OPERATIONS:
        operation = full["paths"][path][method]
        assert not operation.get("security"), f"{method.upper()} {path} is authenticated"
    assert "/openapi-public.json" not in full["paths"]


async def test_the_card_is_self_contained(client):
    doc = (await client.get("/openapi-public.json")).json()
    text = str(doc)
    refs = {part.split("'")[0].split('"')[0] for part in text.split("#/components/schemas/")[1:]}
    for ref in refs:
        name = ref.rstrip("}").rstrip("'")
        assert name in doc["components"]["schemas"], f"unresolved $ref {name}"
    assert doc["components"]["schemas"], "the card lost its schemas"
