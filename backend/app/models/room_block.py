import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RoomBlock(Base):
    """A stretch of time an operator took a room out of service (A02).

    Counts as unavailable exactly like a booking: hidden from the public
    calendar and refused by every booking path's conflict check. Two blocks on
    one room may not overlap: the `room_blocks_no_overlap` EXCLUDE constraint
    lives in the migration only, like `bookings_no_overlap` (CLAUDE.md §6.5).
    A block never overrides a booking that holds its slot — the API refuses it
    and names the booking.
    """

    __tablename__ = "room_blocks"
    __table_args__ = (Index("ix_room_blocks_room_id_start_time", "room_id", "start_time"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    # Who blocked it; kept if that account goes, the block still stands.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    room: Mapped["Room"] = relationship("Room", lazy="noload")  # noqa: F821
