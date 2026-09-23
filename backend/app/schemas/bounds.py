"""Shared bounds for request fields (S09).

Every request string has a length that fits its column and may not carry a NUL
byte (PostgreSQL text cannot store one); every number has a range that fits its
column and makes sense. Without them, over-long or out-of-range input reached
the database or date arithmetic and came back as a 500 instead of a 422.

These are technical limits, deliberately generous: none is a product rule, and
raising one is a one-line change here. The numbers are recorded as a decision
in TODO.md (S09).
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, ClassVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator

_NUL = chr(0)


def _no_nul(value: str) -> str:
    if _NUL in value:
        raise ValueError("must not contain NUL characters")
    return value


def _text(max_length: int, min_length: int = 0):
    return Annotated[
        str,
        StringConstraints(min_length=min_length, max_length=max_length),
        AfterValidator(_no_nul),
    ]


Name = _text(255, min_length=1)  # String(255) columns: spaces, rooms, packages
PersonName = _text(255)  # users.name, optional and may be empty
City = _text(100)  # String(100)
PostalCode = _text(20)  # String(20); the format is the operator's country's business
Address = _text(500)
Description = _text(5000)
Notes = _text(2000)
Tag = _text(100, min_length=1)
ImageUrl = Annotated[
    str,
    StringConstraints(max_length=500, pattern=r"^https?://\S+$"),
    AfterValidator(_no_nul),
]
# The admin UI appends an alpha suffix to this value, so it has to be #RRGGBB.
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]


def _known_timezone(name: str) -> str:
    # `zoneinfo` resolves names from the system database (or tzdata): the
    # one check that means the backend can actually evaluate the clock.
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("must be an IANA time zone name, e.g. Europe/Lisbon") from exc
    return name


# A location's clock (R01): a real IANA zone name, at most 64 characters.
TimeZoneName = Annotated[
    str, StringConstraints(min_length=1, max_length=64), AfterValidator(_known_timezone)
]

Tags = Annotated[list[Tag], Field(max_length=50)]
ImageUrls = Annotated[list[ImageUrl], Field(max_length=50)]

# Numeric(10, 2) columns. Zero is allowed: a free room or pack is a product
# choice, a negative one is not storable money.
Money = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]
Capacity = Annotated[int, Field(ge=1, le=10_000)]


def _six_places(value: Decimal) -> Decimal:
    # Numeric(9, 6). A maps app hands out more digits than that; a pasted value
    # is rounded rather than refused. The range is checked first, so rounding
    # cannot carry a value past it.
    return value.quantize(Decimal("0.000001"))


Latitude = Annotated[Decimal, Field(ge=-90, le=90), AfterValidator(_six_places)]
Longitude = Annotated[Decimal, Field(ge=-180, le=180), AfterValidator(_six_places)]
# A purchase copies the hours into a Numeric(5, 2) column, which tops out at 999.99.
PackageHours = Annotated[int, Field(ge=1, le=999)]
ValidityDays = Annotated[int, Field(ge=1, le=3650)]
Weekday = Annotated[int, Field(ge=0, le=6)]

# Far enough to never bother anyone, near enough that date arithmetic on it
# cannot overflow the way year 9999 did.
LATEST_INSTANT = datetime(2100, 1, 1, tzinfo=UTC)
LATEST_DATE = LATEST_INSTANT.date()


def before_latest_instant(value: datetime) -> datetime:
    comparable = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if comparable >= LATEST_INSTANT:
        raise ValueError("must be before the year 2100")
    return value


def before_latest_date(value: date | None) -> date | None:
    if value is not None and value >= LATEST_DATE:
        raise ValueError("must be before the year 2100")
    return value


class RejectExplicitNull(BaseModel):
    """Base for PATCH-style bodies where an omitted field means "leave as is".

    An explicit `null` for a column that cannot be null used to reach the
    database and come back as a NOT NULL violation. Fields listed in
    `nullable_fields` may still be cleared with `null`.
    """

    nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null(cls, data):
        if isinstance(data, dict):
            offending = sorted(
                key
                for key, value in data.items()
                if value is None and key in cls.model_fields and key not in cls.nullable_fields
            )
            if offending:
                raise ValueError(f"{', '.join(offending)} cannot be null")
        return data
