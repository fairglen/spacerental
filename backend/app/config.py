from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental"
    SECRET_KEY: str = "dev-secret-key-change-this-in-production-min-32-chars"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    CORS_ORIGINS: str = "http://localhost:3000"
    # Experimental UTC series have no customer payment path yet.
    RECURRING_BOOKINGS_ENABLED: bool = False

    # ── Rate limiting ────────────────────────────────────────────────────
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

    # ── Stripe ────────────────────────────────────────────────────────────
    # "stub" runs the whole checkout → webhook flow locally with no Stripe
    # account; "live" talks to the real API and then both keys below are
    # mandatory — app.payments.validate_payment_settings() raises at import
    # rather than letting the stub run in production.
    STRIPE_MODE: str = "stub"
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    STRIPE_CURRENCY: str = "eur"
    STRIPE_SUCCESS_URL: str = "http://localhost:3000/dashboard?pagamento=sucesso"
    STRIPE_CANCEL_URL: str = "http://localhost:3000/dashboard?pagamento=cancelado"
    # Browser-facing base URL of THIS backend, used only to build the stub
    # Checkout page's URL (app.routers.checkout_stub). Like NEXT_PUBLIC_API_URL,
    # this is handed to the user's browser, not called container-to-container,
    # so `localhost` is correct here even under docker-compose (CLAUDE.md §6.3
    # governs backend-to-backend calls, not browser redirect targets). Unused
    # in live mode — real Stripe Checkout URLs live on Stripe's own domain.
    STRIPE_STUB_CHECKOUT_BASE_URL: str = "http://localhost:8000"

    # ── Email ────────────────────────────────────────────────────────────
    # "stub" (default) records what would be sent (log + in-memory list) with
    # no account, no credentials, no network; "live" calls the real Resend
    # API and RESEND_API_KEY then becomes mandatory —
    # app.email.validate_email_settings() raises at import rather than
    # letting the stub run in production.
    EMAIL_MODE: str = "stub"
    RESEND_API_KEY: str | None = None
    EMAIL_FROM_ADDRESS: str = "EspaçoHora <no-reply@espacohora.pt>"
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

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
