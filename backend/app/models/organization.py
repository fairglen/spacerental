import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, func, Enum as SAEnum, JSON, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base
import enum


class OrgPlan(str, enum.Enum):
    starter = "starter"
    pro = "pro"
    enterprise = "enterprise"


class MemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    plan: Mapped[OrgPlan] = mapped_column(
        SAEnum(OrgPlan, name="org_plan"),
        nullable=False,
        default=OrgPlan.starter,
        server_default="starter",
    )
    settings: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    members: Mapped[list["OrganizationMember"]] = relationship(
        "OrganizationMember", back_populates="organization", lazy="noload"
    )
    spaces: Mapped[list["Space"]] = relationship(  # noqa: F821
        "Space", back_populates="organization", lazy="noload"
    )
    packages: Mapped[list["Package"]] = relationship(  # noqa: F821
        "Package", back_populates="organization", lazy="noload"
    )


class OrganizationMember(Base):
    __tablename__ = "organization_members"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_org_user"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MemberRole] = mapped_column(
        SAEnum(MemberRole, name="member_role"),
        nullable=False,
        default=MemberRole.member,
        server_default="member",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="members", lazy="noload"
    )
    user: Mapped["User"] = relationship(  # noqa: F821
        "User", back_populates="memberships", lazy="noload"
    )
