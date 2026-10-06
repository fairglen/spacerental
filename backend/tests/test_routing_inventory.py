"""The route walk the rate-limit tiers and the route inventories rely on.

FastAPI 0.142 nests included routers under one node in `app.routes`; the
helper must still see every operation with its full (prefixed) path, and the
matcher it hands out must answer for a request to that path — otherwise the
auth/public tiers quietly stop throttling and the authz/audit sweeps go blind.
"""

from app.main import app
from app.ratelimit import RateLimitMiddleware, limiter
from app.routing_inventory import iter_api_routes, route_matcher
from starlette.routing import Match


def _scope(method: str, path: str) -> dict:
    return {
        "type": "http",
        "method": method,
        "path": path,
        "root_path": "",
        "headers": [],
        "query_string": b"",
    }


class TestIterApiRoutes:
    def test_nested_operations_carry_their_full_path(self):
        found = {(m, c.path) for c in iter_api_routes(app.routes) for m in (c.methods or set())}
        assert ("POST", "/api/v1/auth/login") in found
        assert ("GET", "/api/v1/spaces") in found
        assert ("DELETE", "/api/v1/admin/bookings/{booking_id}") in found
        assert ("GET", "/health") in found
        # Nothing prefix-less leaks out of a nested router.
        assert ("POST", "/auth/login") not in found

    def test_every_documented_operation_is_walked(self):
        documented = {
            (method.upper(), path)
            for path, operations in app.openapi()["paths"].items()
            for method in operations
        }
        walked = {(m, c.path) for c in iter_api_routes(app.routes) for m in (c.methods or set())}
        assert documented <= walked


class TestRouteMatcher:
    def test_matches_the_full_request_path_and_method(self):
        login = next(c for c in iter_api_routes(app.routes) if c.path == "/api/v1/auth/login")
        assert route_matcher(login).matches(_scope("POST", "/api/v1/auth/login"))[0] is Match.FULL
        assert route_matcher(login).matches(_scope("GET", "/api/v1/auth/login"))[0] is Match.PARTIAL
        assert route_matcher(login).matches(_scope("POST", "/auth/login"))[0] is Match.NONE

    def test_tier_lookup_sees_nested_routes(self):
        middleware = RateLimitMiddleware(app, routes=app.router.routes, limiter=limiter)
        assert middleware._tier_for(_scope("POST", "/api/v1/auth/login")) == "auth"
        assert middleware._tier_for(_scope("GET", "/api/v1/spaces")) == "public"
        assert middleware._tier_for(_scope("GET", "/health")) is None
