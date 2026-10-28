import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

# The name people see (emails, the stub checkout page). Formerly EspaçoHora;
# internal identifiers (package, DB, env vars, service names) keep their names.
BRAND_NAME = "FlowSpace"

# Where the frontend proxies this API on its own origin (D20): the browser
# reaches `<FRONTEND_URL>/backend/...` and Next.js forwards it here. Every
# browser-facing URL this app builds for itself goes through it by default.
PROXY_PREFIX = "/backend"

# The deployment kind that arms the interlock below (E02, S17).
PRODUCTION = "production"
# The signing key .env.example ships. Named so the interlock can refuse it
# by value, not only by length.
DEV_SECRET_KEY = "dev-secret-key-change-this-in-production-min-32-chars"
SECRET_KEY_MIN_LENGTH = 32
# The modes a production `.env` must name explicitly (stub is allowed, but
# never by omission — a stub running in production by default is the
# failure CLAUDE.md §10.3 forbids).
EXPLICIT_MODES = ("EMAIL_MODE", "STRIPE_MODE")
_LOCAL_DB_HOSTS = frozenset({"", "localhost", "127.0.0.1", "::1"})


class Settings(BaseSettings):
    # What kind of deployment this is (G03). Only `production` is special:
    # the local-only test hooks (`app.routers.test_hooks`) are never mounted
    # there, whatever EMAIL_MODE says, `app.seed` refuses to run (E03), and
    # the settings below are checked at import (E02, `production_problems`).
    APP_ENV: str = "development"
    # The local-only test hooks (`GET /__test__/emails`): an explicit opt-in,
    # off by default, and even then only with EMAIL_MODE=stub outside
    # production. The dev Compose stack and the test suite turn it on.
    TEST_HOOKS_ENABLED: bool = False
    DATABASE_URL: str = "postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental"
    SECRET_KEY: str = "dev-secret-key-change-this-in-production-min-32-chars"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    CORS_ORIGINS: str = "http://localhost:3000"
    # One explicit public enrollment target; never infer it from database order.
    CUSTOMER_ENROLLMENT_ORG_SLUG: str | None = None
    CUSTOMER_ENROLLMENT_ENABLED: bool = True
    # Experimental UTC series have no customer payment path yet.
    RECURRING_BOOKINGS_ENABLED: bool = False
    # How long an unpaid hourly booking holds its slot while the customer is
    # on Checkout (C03). Evaluated lazily at read/conflict time; no sweeper.
    # Positive by construction: zero or negative would expire every hold at
    # once and make hourly Checkout unusable; there is no "disable" value.
    BOOKING_HOLD_MINUTES: int = Field(default=15, gt=0)
    # B68: a pack purchase left `pending` (Checkout never finished, no
    # webhook) is cancelled by the sweeper after this long.
    PACKAGE_CHECKOUT_MINUTES: int = Field(default=60, gt=0)
    # How far ahead a CUSTOMER may book (H01): `start_time` later than now +
    # this many days is refused, and the public availability reports such
    # slots as `beyond_window`. Operators have no horizon (A01 paths are
    # untouched). The frontend mirrors it as NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS
    # for the calendar's hint; the API stays authoritative.
    BOOKING_MAX_ADVANCE_DAYS: int = Field(default=30, gt=0)
    # How long the hours credited for a cancelled paid booking stay in the
    # customer's bank (K01). The frontend mirrors it as
    # NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS for the cancel dialog.
    CANCELLATION_CREDIT_VALIDITY_DAYS: int = Field(default=365, gt=0)

    # ── Rate limiting ────────────────────────────────────────────────────
    # The limiter keeps its sliding windows in process memory (app/ratelimit.py):
    # it is a per-replica budget, correct for ONE backend process. Behind two or
    # more replicas each has its own counters, so the effective limit is
    # multiplied by the replica count — move the counters to a shared store
    # before scaling out (Q55).
    RATE_LIMIT_ENABLED: bool = True
    # Auth tier: credential endpoints. Strict, because each accepted request
    # costs an Argon2 hash (m=64MB) and is the surface for credential stuffing.
    RATE_LIMIT_AUTH_MAX_REQUESTS: int = 10
    RATE_LIMIT_AUTH_WINDOW_SECONDS: int = 60
    # Public tier: unauthenticated reads. Looser — a single visitor browsing
    # spaces and flipping through calendar days legitimately makes many calls.
    RATE_LIMIT_PUBLIC_MAX_REQUESTS: int = 120
    RATE_LIMIT_PUBLIC_WINDOW_SECONDS: int = 60
    # Only enable behind a proxy that overwrites X-Forwarded-For; see the
    # trust note in app/ratelimit.py:client_identity.
    RATE_LIMIT_TRUST_FORWARDED_FOR: bool = False
    # The proxies whose X-Forwarded-For IS trusted (D20): hostnames, IPs or
    # CIDRs, comma-separated. A request from one of them is identified by the
    # entry that proxy appended (the rightmost); from anyone else, by its
    # peer address. Compose sets `frontend` — the Next.js proxy the browser
    # reaches the API through. Empty = no peer is trusted (app/trusted_proxies.py).
    RATE_LIMIT_TRUSTED_PROXIES: str = ""
    # Upload tier: operator photo uploads (C14). Each accepted request decodes
    # and re-encodes an image of up to 8 MB.
    RATE_LIMIT_UPLOAD_MAX_REQUESTS: int = 30
    RATE_LIMIT_UPLOAD_WINDOW_SECONDS: int = 60
    # Support tier: the public help form (C17). Tight, because every accepted
    # request writes a row and sends an email to a person: 5 an hour per client.
    RATE_LIMIT_SUPPORT_MAX_REQUESTS: int = 5
    RATE_LIMIT_SUPPORT_WINDOW_SECONDS: int = 3600

    # ── Media (room and space photos, C14; private invoice PDFs, I05) ────
    # "local" writes processed photos under MEDIA_ROOT and the API serves them
    # read-only at /media — the default, what development and the tests run.
    # "s3" (E18) puts them in MEDIA_S3_BUCKET under MEDIA_S3_PREFIX, served
    # by the CloudFront distribution MEDIA_BASE_URL names (then mandatory);
    # credentials come from the environment (the instance role), never from
    # here. Anything else stops the app at startup
    # (app.media.validate_media_settings).
    MEDIA_STORAGE: str = "local"
    MEDIA_ROOT: str = "./media"
    MEDIA_S3_BUCKET: str | None = None
    MEDIA_S3_PREFIX: str = "media/"
    # boto3's region; the awslogs overlay reads the same variable on the host.
    AWS_REGION: str | None = None
    # Browser-facing URL that maps to MEDIA_ROOT, handed to the visitor's
    # browser inside API responses. Empty (the default) = derived from
    # FRONTEND_URL as `<FRONTEND_URL>/backend/media` — the API's /media reached
    # through the frontend's proxy (D20), which follows FRONTEND_URL wherever
    # it points. Set only when the photos live elsewhere (object storage).
    MEDIA_BASE_URL: str = ""
    # Where `python -m app.seed` finds the four room illustrations (V01).
    # Empty = the repo's own `flowspace-site/assets/img/room-photos`, which a
    # native run sees and the backend container does not — Compose mounts the
    # folder and sets this.
    SEED_PHOTOS_DIR: str | None = None

    # ── Stripe ────────────────────────────────────────────────────────────
    # "stub" runs the whole checkout → webhook flow locally with no Stripe
    # account; "live" talks to the real API and then both keys below are
    # mandatory — app.payments.validate_payment_settings() raises at import
    # rather than letting the stub run in production.
    STRIPE_MODE: str = "stub"
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    STRIPE_CURRENCY: str = "eur"
    # Where the browser lands after Checkout. Empty (the default) = derived
    # from FRONTEND_URL (`<FRONTEND_URL>/dashboard?pagamento=sucesso|cancelado`),
    # so one variable moves the whole flow to another address (D20).
    STRIPE_SUCCESS_URL: str = ""
    STRIPE_CANCEL_URL: str = ""
    # Browser-facing base URL of THIS backend, used only to build the stub
    # Checkout page's URL (app.routers.checkout_stub). Empty (the default) =
    # derived from FRONTEND_URL as `<FRONTEND_URL>/backend`, the proxied path
    # (D20); an absolute value sends the browser to the API directly. Handed
    # to the user's browser, never called container-to-container (CLAUDE.md
    # §6.3 governs backend-to-backend calls, not browser redirect targets).
    # Unused in live mode — real Stripe Checkout URLs live on Stripe's domain.
    STRIPE_STUB_CHECKOUT_BASE_URL: str = ""

    # ── Email ────────────────────────────────────────────────────────────
    # "stub" (default) records what would be sent (log + in-memory list) with
    # no account, no credentials, no network; "live" calls the real Resend
    # API and RESEND_API_KEY then becomes mandatory —
    # app.email.validate_email_settings() raises at import rather than
    # letting the stub run in production.
    EMAIL_MODE: str = "stub"
    RESEND_API_KEY: str | None = None
    # Live mode requires flowspace.pt to be verified at the email provider
    # before this sender is accepted; the stub only logs it.
    EMAIL_FROM_ADDRESS: str = "FlowSpace <no-reply@flowspace.pt>"
    # Where help-form requests are sent (C17). The public contact address, the
    # same one the frontend shows (frontend/lib/contact.ts, C09).
    # Where help-form requests are delivered (K03; renamed from SUPPORT_EMAIL,
    # which was only ever this destination). The address the site shows the
    # public stays geral@flowspace.pt (frontend/lib/contact.ts).
    SUPPORT_INBOX_EMAIL: str = "geral+support@flowspace.pt"
    # Base URL used to build links inside outgoing emails (e.g. "cancel this
    # booking"). This is handed to the user's mail client, so localhost is
    # correct here — unlike backend-to-backend calls (CLAUDE.md §6.3).
    FRONTEND_URL: str = "http://localhost:3000"

    # Stub codes are process-local. Live startup is gated until durable access
    # identifiers and retry state exist (roadmap O04).
    SEAM_MODE: str = "stub"
    SEAM_API_KEY: str | None = None
    SEAM_DEVICE_ID_MAP: str | None = None
    SEAM_TIMEOUT_SECONDS: float = 10.0

    # P2.2: how often the lifespan task reconciles lapsed unpaid holds
    # (app/holds.py); 0 disables it (the reads still reconcile their own).
    HOLD_SWEEP_INTERVAL_SECONDS: int = 60

    @model_validator(mode="after")
    def _derive_browser_urls(self) -> "Settings":
        """One variable drives every browser-facing URL (D20): FRONTEND_URL —
        localhost, a LAN IP or an ngrok domain — unless a value is explicit."""
        base = self.FRONTEND_URL.rstrip("/")
        # In s3 mode (E18) nothing answers at the API's /media, so there is
        # no default to derive: an empty value stays empty and stops the app
        # (app.media.validate_media_settings) instead of serving 404s.
        if not self.MEDIA_BASE_URL.strip() and self.MEDIA_STORAGE != "s3":
            self.MEDIA_BASE_URL = f"{base}{PROXY_PREFIX}/media"
        if not self.STRIPE_STUB_CHECKOUT_BASE_URL.strip():
            self.STRIPE_STUB_CHECKOUT_BASE_URL = f"{base}{PROXY_PREFIX}"
        if not self.STRIPE_SUCCESS_URL.strip():
            self.STRIPE_SUCCESS_URL = f"{base}/dashboard?pagamento=sucesso"
        if not self.STRIPE_CANCEL_URL.strip():
            self.STRIPE_CANCEL_URL = f"{base}/dashboard?pagamento=cancelado"
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    model_config = {"env_file": ".env", "extra": "ignore"}


def production_problems(current: Settings) -> list[str]:
    """What stops a production start (E02, S17); empty when nothing does.

    Every development default that works silently on a laptop — the
    published signing key, the test hooks, http:// return URLs, a stub
    gateway nobody chose, a localhost database, a media directory the
    process cannot write — is refused here, all at once, so the operator
    reads one list instead of one failure per deploy.
    """
    problems: list[str] = []
    if current.SECRET_KEY == DEV_SECRET_KEY or len(current.SECRET_KEY) < SECRET_KEY_MIN_LENGTH:
        problems.append(
            f"SECRET_KEY must be a generated value of at least {SECRET_KEY_MIN_LENGTH} "
            "characters, not the development default"
        )
    if current.TEST_HOOKS_ENABLED:
        problems.append("TEST_HOOKS_ENABLED must be false")
    if not current.FRONTEND_URL.startswith("https://"):
        problems.append(f"FRONTEND_URL must be an https:// address, got {current.FRONTEND_URL!r}")
    for origin in current.cors_origins_list:
        if not origin.startswith("https://"):
            problems.append(f"every CORS_ORIGINS entry must be https://, got {origin!r}")
    for name in EXPLICIT_MODES:
        if name not in current.model_fields_set:
            problems.append(
                f"{name} must be set explicitly (stub or live), not left to its default"
            )
    if (urlsplit(current.DATABASE_URL).hostname or "") in _LOCAL_DB_HOSTS:
        problems.append("DATABASE_URL must not point at localhost")
    if current.MEDIA_STORAGE == "local":
        root = Path(current.MEDIA_ROOT)
        if not root.is_dir() or not os.access(root, os.W_OK):
            problems.append(
                f"MEDIA_ROOT {current.MEDIA_ROOT!r} must be an existing, writable directory"
            )
    elif current.MEDIA_STORAGE == "s3":
        # The same checks app.media.validate_media_settings() makes, listed
        # here with the rest so the operator reads one list (E02).
        if not (current.MEDIA_S3_BUCKET or "").strip():
            problems.append("MEDIA_STORAGE=s3 requires MEDIA_S3_BUCKET")
        if not current.MEDIA_BASE_URL.strip():
            problems.append(
                "MEDIA_STORAGE=s3 requires MEDIA_BASE_URL (the CloudFront origin in front of "
                "the bucket)"
            )
    return problems


def enforce_production_settings(current: Settings) -> None:
    """Refuse to start on a development default under APP_ENV=production;
    say so at WARNING when a gateway is deliberately the stub."""
    if current.APP_ENV != PRODUCTION:
        return
    problems = production_problems(current)
    if problems:
        raise RuntimeError(f"APP_ENV={PRODUCTION} refuses to start:\n- " + "\n- ".join(problems))
    for name in EXPLICIT_MODES:
        if getattr(current, name) == "stub":
            logging.getLogger("app").warning(
                "%s=stub under APP_ENV=%s: the %s gateway is the local stub, "
                "nothing leaves the host",
                name,
                PRODUCTION,
                name.split("_")[0].lower(),
            )


settings = Settings()
enforce_production_settings(settings)
