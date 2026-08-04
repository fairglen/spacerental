from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental"
    SECRET_KEY: str = "dev-secret-key-change-this-in-production-min-32-chars"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    CORS_ORIGINS: str = "http://localhost:3000"

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

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
