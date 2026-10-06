"""One walk over an app's operations that follows FastAPI's nested routers.

FastAPI 0.142 stopped flattening `include_router()`: an included router is
one `_IncludedRouter` node in `app.routes`, its `APIRoute`s hang below it and
their effective paths (the include prefix applied) exist only on the
contexts FastAPI builds for routing. Anything that used to loop over
`app.routes` — the rate-limit tiers, the route inventories the authz and
audit suites assert against — now sees the top-level nodes only.
`fastapi.routing.iter_route_contexts` is FastAPI's own public walk; the
contexts it yields carry the effective `path`, the `methods` and the
original `endpoint` (so attributes set by our decorators are still there).
"""

from collections.abc import Iterable, Iterator

from fastapi.routing import APIRoute, RouteContext, iter_route_contexts
from starlette.routing import BaseRoute, Route


def iter_api_routes(routes: Iterable[BaseRoute]) -> Iterator[RouteContext]:
    """Every operation (`APIRoute`) reachable from `routes`, nested routers included."""
    for context in iter_route_contexts(list(routes)):
        if isinstance(context.original_route, APIRoute):
            yield context


# One plain Starlette route per (effective path, methods), compiled once: a
# nested `APIRoute` only knows its prefix-less path, and its own `matches()`
# relies on a context FastAPI puts in the scope while routing — too late for
# a middleware. Keyed by what defines the match, so routers included after
# the middleware was built still get one when first seen.
_matchers: dict[tuple[str, frozenset[str]], Route] = {}


def route_matcher(context: RouteContext) -> BaseRoute:
    """A route whose `matches(scope)` answers for the operation's full path."""
    path = context.path or ""
    methods = frozenset(context.methods or ())
    matcher = _matchers.get((path, methods))
    if matcher is None:
        endpoint = context.endpoint or (lambda: None)
        matcher = Route(path, endpoint=endpoint, methods=sorted(methods) or None)
        _matchers[(path, methods)] = matcher
    return matcher
