"""Which peers' `X-Forwarded-For` the rate limiter believes (D20).

Browser traffic reaches the API through the frontend's Next.js proxy
(`/backend/*`), so every request's peer address is the frontend container's,
and the real client is what that proxy appended to `X-Forwarded-For`. The
header is only worth anything when it was appended by a proxy we run, so the
trust is scoped to peers: `RATE_LIMIT_TRUSTED_PROXIES` names them by hostname
(`frontend` in Compose — resolved through the stack's DNS and cached for a
minute, because a container's address is not known in advance), by IP or by
CIDR. A request from anyone else keeps its peer address as its identity,
whatever the header says.
"""

from __future__ import annotations

import ipaddress
import socket
import threading
import time
from collections.abc import Callable

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

TTL_SECONDS = 60.0


def _resolve(host: str) -> frozenset[IPAddress]:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        # Outside Compose `frontend` does not resolve: nothing is trusted, and
        # the lookup is retried only once the cache expires.
        return frozenset()
    found: set[IPAddress] = set()
    for info in infos:
        try:
            found.add(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    return frozenset(found)


def _parse_peer(peer: str) -> IPAddress | None:
    try:
        addr = ipaddress.ip_address(peer)
    except ValueError:
        return None
    # An IPv4 client seen through a dual-stack socket: compare as IPv4.
    mapped = getattr(addr, "ipv4_mapped", None)
    return mapped or addr


class TrustedProxies:
    """The set from one comma-separated spec; hostnames resolve lazily."""

    def __init__(
        self,
        spec: str,
        *,
        ttl: float = TTL_SECONDS,
        resolver: Callable[[str], frozenset[IPAddress]] = _resolve,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.networks: list[IPNetwork] = []
        self.hosts: list[str] = []
        for entry in (part.strip() for part in spec.split(",")):
            if not entry:
                continue
            try:
                self.networks.append(ipaddress.ip_network(entry, strict=False))
            except ValueError:
                self.hosts.append(entry)
        self._ttl = ttl
        self._resolver = resolver
        self._clock = clock
        self._lock = threading.Lock()
        self._resolved: frozenset[IPAddress] = frozenset()
        self._resolved_at: float | None = None

    def __bool__(self) -> bool:
        return bool(self.networks or self.hosts)

    def is_trusted(self, peer: str | None) -> bool:
        if not peer or not self:
            return False
        addr = _parse_peer(peer)
        if addr is None:
            return False
        if any(addr in network for network in self.networks):
            return True
        return bool(self.hosts) and addr in self._resolved_hosts()

    def _resolved_hosts(self) -> frozenset[IPAddress]:
        now = self._clock()
        with self._lock:
            fresh = self._resolved_at is not None and now - self._resolved_at < self._ttl
            if not fresh:
                found: set[IPAddress] = set()
                for host in self.hosts:
                    found.update(self._resolver(host))
                self._resolved = frozenset(found)
                self._resolved_at = now
            return self._resolved


_cache: dict[str, TrustedProxies] = {}
_cache_lock = threading.Lock()


def trusted_proxies_for(spec: str) -> TrustedProxies:
    """One `TrustedProxies` per spec, so the DNS cache survives across requests
    and a changed setting (tests monkeypatch it) gets a fresh one."""
    with _cache_lock:
        found = _cache.get(spec)
        if found is None:
            found = _cache[spec] = TrustedProxies(spec)
        return found
