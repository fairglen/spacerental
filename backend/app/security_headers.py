"""Static security headers on every response (Q52).

The API serves JSON, the photo files under /media and the stub Checkout page;
none of them is meant to be framed, sniffed into another type, or to leak a
full referrer. One ASGI middleware, outermost, so a 429 from the limiter and a
CORS preflight carry the headers too. The browser-facing Content Security
Policy belongs to the Next.js app (frontend/lib/securityHeaders.js); HSTS is
the TLS terminator's to send, since the API itself never knows whether it is
behind TLS.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    # Set, not append: a route that already answered one wins
                    # nothing by repeating it, and the value is the same.
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)
