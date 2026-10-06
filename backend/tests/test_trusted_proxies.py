"""D20: the limiter believes `X-Forwarded-For` only from a trusted proxy.

Browser traffic reaches the API through the frontend's Next.js proxy, which
appends the real client to the header. `RATE_LIMIT_TRUSTED_PROXIES` names
that proxy (by hostname, IP or CIDR); a request from it is identified by the
entry it appended — the rightmost — and a request from anyone else by its
peer address, whatever it put in the header. `RATE_LIMIT_TRUST_FORWARDED_FOR`
(the pre-existing, any-peer, first-entry switch) is unchanged and off."""

import ipaddress

import pytest
from app.config import settings
from app.ratelimit import client_identity, limiter
from app.trusted_proxies import TrustedProxies

LOGIN_URL = "/api/v1/auth/login"
# httpx's ASGI transport presents every request from this peer.
TEST_PEER = "127.0.0.1"


def _scope(peer: str | None, forwarded: str | None = None) -> dict:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return {"type": "http", "client": (peer, 40000) if peer else None, "headers": headers}


def _login(email: str = "nobody@example.com") -> dict:
    return {"email": email, "password": "wrong-password"}


@pytest.fixture(autouse=True)
def _fresh_limiter():
    limiter.reset()
    yield
    limiter.reset()


class TestTrustedProxiesSet:
    def test_ips_cidrs_and_hostnames(self):
        calls: list[str] = []

        def resolver(host: str):
            calls.append(host)
            return (
                frozenset({ipaddress.ip_address("172.18.0.5")})
                if host == "frontend"
                else frozenset()
            )

        proxies = TrustedProxies(
            "frontend, 10.0.0.0/8, 203.0.113.9, nowhere.invalid", resolver=resolver
        )
        assert proxies.is_trusted("203.0.113.9")
        assert proxies.is_trusted("10.20.30.40")
        assert proxies.is_trusted("172.18.0.5")  # resolved
        assert proxies.is_trusted("::ffff:172.18.0.5")  # the same peer through a dual-stack socket
        assert not proxies.is_trusted("172.18.0.6")
        assert not proxies.is_trusted("not-an-address")
        assert not proxies.is_trusted(None)
        assert sorted(calls) == ["frontend", "nowhere.invalid"]

    def test_hostnames_are_resolved_once_per_ttl(self):
        now = [0.0]
        calls: list[str] = []

        def resolver(host: str):
            calls.append(host)
            return frozenset({ipaddress.ip_address("172.18.0.5")})

        proxies = TrustedProxies("frontend", ttl=60, resolver=resolver, clock=lambda: now[0])
        assert proxies.is_trusted("172.18.0.5")
        now[0] = 30
        assert proxies.is_trusted("172.18.0.5")
        assert calls == ["frontend"]
        now[0] = 61
        assert proxies.is_trusted("172.18.0.5")
        assert calls == ["frontend", "frontend"]

    def test_an_empty_spec_trusts_nobody(self):
        proxies = TrustedProxies("")
        assert not proxies
        assert not proxies.is_trusted("127.0.0.1")


class TestClientIdentity:
    def test_default_ignores_the_header(self, monkeypatch):
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", "")
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", False)
        assert client_identity(_scope("198.51.100.4", "203.0.113.7")) == "198.51.100.4"
        assert client_identity(_scope("198.51.100.4")) == "198.51.100.4"
        assert client_identity(_scope(None, "203.0.113.7")) == "unknown"

    def test_a_trusted_peer_is_identified_by_the_entry_it_appended(self, monkeypatch):
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", "198.51.100.0/24")
        # The client wrote the first entry itself; the proxy appended the real one.
        assert client_identity(_scope("198.51.100.4", "1.2.3.4, 203.0.113.7")) == "203.0.113.7"
        assert client_identity(_scope("198.51.100.4", "203.0.113.7")) == "203.0.113.7"
        # The same header from a peer outside the trusted range changes nothing.
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", "198.51.100.4")
        assert client_identity(_scope("198.51.100.200", "1.2.3.4, 203.0.113.7")) == "198.51.100.200"
        # A trusted peer with no header is itself.
        assert client_identity(_scope("198.51.100.4")) == "198.51.100.4"

    def test_the_legacy_switch_keeps_its_first_entry_meaning(self, monkeypatch):
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", True)
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", "")
        assert client_identity(_scope("198.51.100.200", "203.0.113.7, 10.0.0.1")) == "203.0.113.7"


class TestThroughTheApp:
    async def test_a_spoofed_header_from_an_untrusted_peer_shares_the_peer_budget(
        self, client, monkeypatch
    ):
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", "203.0.113.250")
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        # Every request rotates the header; the budget is still the peer's.
        for i in range(limit):
            resp = await client.post(
                LOGIN_URL, json=_login(), headers={"X-Forwarded-For": f"203.0.113.{i + 1}"}
            )
            assert resp.status_code == 401, resp.text
        blocked = await client.post(
            LOGIN_URL, json=_login(), headers={"X-Forwarded-For": "203.0.113.99"}
        )
        assert blocked.status_code == 429, blocked.text

    async def test_a_trusted_peer_is_budgeted_by_the_entry_it_appended(self, client, monkeypatch):
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", TEST_PEER)
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        # The left entry is the client's own invention and rotates; the right
        # one is what the proxy saw. Same right entry, one budget.
        for i in range(limit):
            resp = await client.post(
                LOGIN_URL,
                json=_login(),
                headers={"X-Forwarded-For": f"10.0.0.{i + 1}, 203.0.113.7"},
            )
            assert resp.status_code == 401, resp.text
        blocked = await client.post(
            LOGIN_URL, json=_login(), headers={"X-Forwarded-For": "10.0.0.99, 203.0.113.7"}
        )
        assert blocked.status_code == 429, blocked.text
        other = await client.post(
            LOGIN_URL, json=_login(), headers={"X-Forwarded-For": "10.0.0.1, 203.0.113.8"}
        )
        assert other.status_code == 401, other.text

    async def test_the_proxy_may_be_named_by_hostname(self, client, monkeypatch):
        """Compose names the frontend service; here the test client's own host."""
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_PROXIES", "localhost")
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        for _ in range(limit):
            resp = await client.post(
                LOGIN_URL, json=_login(), headers={"X-Forwarded-For": "203.0.113.7"}
            )
            assert resp.status_code == 401, resp.text
        blocked = await client.post(
            LOGIN_URL, json=_login(), headers={"X-Forwarded-For": "203.0.113.7"}
        )
        assert blocked.status_code == 429, blocked.text
        other = await client.post(
            LOGIN_URL, json=_login(), headers={"X-Forwarded-For": "203.0.113.8"}
        )
        assert other.status_code == 401, other.text
