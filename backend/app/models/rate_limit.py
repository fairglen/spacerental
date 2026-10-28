from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RateLimitHit(Base):
    """One fixed-window counter per (tier, client identity, window) for
    RATE_LIMIT_STORE=postgres (N02): every worker and replica increments the
    same row, so a limit means what the .env says whatever WEB_CONCURRENCY
    is. Rows older than two hours are deleted by the store itself; nothing
    reads this table but app/ratelimit.py."""

    __tablename__ = "rate_limit_hits"

    scope: Mapped[str] = mapped_column(String(32), primary_key=True)
    identity: Mapped[str] = mapped_column(String(255), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, nullable=False)
