"""One id per request, for the audit trail (G01).

`X-Request-ID` is honoured when a proxy sends a well-formed one, else a fresh
one is made; either way it is echoed on the response and available to
`app.audit.record` through a context variable, so every audit row written
during a request can be tied back to it.
"""

import re
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.audit import request_id_var

_WELL_FORMED = re.compile(r"[A-Za-z0-9._-]{1,64}")
HEADER = "X-Request-ID"


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        given = Headers(scope=scope).get(HEADER.lower(), "")
        request_id = given if _WELL_FORMED.fullmatch(given) else uuid.uuid4().hex
        token = request_id_var.set(request_id)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append(HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)
