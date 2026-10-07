"""The billing statement (I02): what money was received in a period, from whom.

Pure functions over the ledger. `load_transactions` reads the rows that
received money (`paid_at`, I01) inside a period of Lisbon calendar days;
`summarise` and `statement` fold them; `statement_csv` writes the operator's
export. `Decimal` throughout — nothing here touches a float.

A transaction is one of: a bought pack (`pack`: the purchase's `amount_paid`
and `hours_total`), an hourly booking (`hourly`: `total_amount`,
`duration_hours`), a mixed one (`mixed`: the card part in `total_amount`,
the hours it paid for — `duration_hours - package_hours_used`) or an
operator-recorded booking with an amount (`manual`, the same hours rule).
Complimentary hours and cancellation credits moved no money and are not
transactions; a booking paid by pack hours was paid when the pack was.
"""

from __future__ import annotations

import csv
import io
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from enum import StrEnum
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.booking import Booking, PaymentMethod
from app.models.package import PurchaseSource, UserPackagePurchase
from app.models.user import User

LISBON = ZoneInfo("Europe/Lisbon")
CENT = Decimal("0.01")
ZERO = Decimal("0.00")
# A statement is read a month at a time; a year bounds the query a custom
# range can ask for.
MAX_PERIOD_DAYS = 366

CSV_COLUMNS = (
    "cliente",
    "email",
    "NIF",
    "transações",
    "horas",
    "valor",
    "faturado",
    "por faturar",
)


class Kind(StrEnum):
    pack = "pack"
    hourly = "hourly"
    mixed = "mixed"
    manual = "manual"


class Channel(StrEnum):
    online = "online"
    manual = "manual"


class InvoicedFilter(StrEnum):
    all = "all"
    pending = "pending"
    done = "done"


class InvalidPeriodError(ValueError):
    pass


@dataclass(frozen=True)
class Period:
    """Lisbon calendar days `[date_from, date_to]`, and the UTC instants
    `[start, end)` the ledger is read with."""

    date_from: date
    date_to: date
    start: datetime
    end: datetime


def period(date_from: date, date_to: date) -> Period:
    if date_to < date_from:
        raise InvalidPeriodError("O fim do período é anterior ao início")
    if (date_to - date_from).days >= MAX_PERIOD_DAYS:
        raise InvalidPeriodError(f"O período não pode exceder {MAX_PERIOD_DAYS} dias")
    start = datetime.combine(date_from, time.min, tzinfo=LISBON).astimezone(UTC)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=LISBON).astimezone(UTC)
    return Period(date_from, date_to, start, end)


def month_of(instant: datetime) -> Period:
    """The Lisbon calendar month the instant falls in."""
    local = instant.astimezone(LISBON).date()
    first = local.replace(day=1)
    next_first = (first + timedelta(days=32)).replace(day=1)
    return period(first, next_first - timedelta(days=1))


@dataclass(frozen=True)
class Transaction:
    kind: Kind
    id: uuid.UUID
    user_id: uuid.UUID
    paid_at: datetime
    label: str
    amount: Decimal
    hours: Decimal
    channel: Channel
    package_id: uuid.UUID | None = None
    package_name: str | None = None
    invoice_id: uuid.UUID | None = None


def _quantised(value: Decimal) -> Decimal:
    return Decimal(value).quantize(CENT)


def _booking_label(booking: Booking) -> str:
    start = booking.start_time.astimezone(LISBON)
    end = booking.end_time.astimezone(LISBON)
    room = booking.room.name if booking.room is not None else "Sala"
    return f"{room} · {start:%d/%m/%Y %H:%M}–{end:%H:%M}"  # noqa: RUF001


def _booking_transaction(booking: Booking) -> Transaction:
    if booking.payment_method is PaymentMethod.hourly:
        kind, hours = Kind.hourly, booking.duration_hours
    else:
        hours = booking.duration_hours - (booking.package_hours_used or ZERO)
        kind = Kind.mixed if booking.payment_method is PaymentMethod.mixed else Kind.manual
    return Transaction(
        kind=kind,
        id=booking.id,
        user_id=booking.user_id,
        paid_at=booking.paid_at,
        label=_booking_label(booking),
        amount=_quantised(booking.total_amount),
        hours=_quantised(hours),
        channel=Channel.manual if kind is Kind.manual else Channel.online,
    )


def _purchase_transaction(purchase: UserPackagePurchase) -> Transaction:
    name = purchase.package.name if purchase.package is not None else "Pack"
    return Transaction(
        kind=Kind.pack,
        id=purchase.id,
        user_id=purchase.user_id,
        paid_at=purchase.paid_at,
        label=name,
        amount=_quantised(purchase.amount_paid),
        hours=_quantised(purchase.hours_total),
        channel=Channel.online,
        package_id=purchase.package_id,
        package_name=name,
    )


async def load_transactions(
    db: AsyncSession, org_id: uuid.UUID, within: Period
) -> list[Transaction]:
    """Every transaction of the org paid inside the period, oldest first.

    `paid_at` alone decides membership: a booking cancelled after it was
    paid still received the money (K01 credits hours, it never refunds)."""
    bookings = await db.scalars(
        select(Booking)
        .options(selectinload(Booking.room))
        .where(
            Booking.org_id == org_id,
            Booking.paid_at >= within.start,
            Booking.paid_at < within.end,
            Booking.payment_method.in_(
                (PaymentMethod.hourly, PaymentMethod.mixed, PaymentMethod.manual)
            ),
            Booking.total_amount > 0,
        )
    )
    purchases = await db.scalars(
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package))
        .where(
            UserPackagePurchase.org_id == org_id,
            UserPackagePurchase.paid_at >= within.start,
            UserPackagePurchase.paid_at < within.end,
            UserPackagePurchase.source == PurchaseSource.purchase,
        )
    )
    transactions = [_booking_transaction(b) for b in bookings] + [
        _purchase_transaction(p) for p in purchases
    ]
    transactions.sort(key=lambda t: (t.paid_at, t.id))
    return transactions


@dataclass
class KindTotals:
    count: int = 0
    amount: Decimal = ZERO
    hours: Decimal = ZERO

    def add(self, transaction: Transaction) -> None:
        self.count += 1
        self.amount += transaction.amount
        self.hours += transaction.hours


@dataclass
class PackSales(KindTotals):
    package_id: uuid.UUID | None = None
    name: str = ""


@dataclass
class Summary:
    received_total: Decimal = ZERO
    by_channel: dict[Channel, Decimal] = field(
        default_factory=lambda: {Channel.online: ZERO, Channel.manual: ZERO}
    )
    pack_sales: list[PackSales] = field(default_factory=list)
    hourly: KindTotals = field(default_factory=KindTotals)
    mixed: KindTotals = field(default_factory=KindTotals)
    manual: KindTotals = field(default_factory=KindTotals)
    transactions_count: int = 0
    invoiced_amount: Decimal = ZERO
    pending_amount: Decimal = ZERO


def summarise(transactions: list[Transaction]) -> Summary:
    summary = Summary()
    packs: dict[uuid.UUID | None, PackSales] = {}
    for t in transactions:
        summary.received_total += t.amount
        summary.by_channel[t.channel] += t.amount
        summary.transactions_count += 1
        if t.invoice_id is None:
            summary.pending_amount += t.amount
        else:
            summary.invoiced_amount += t.amount
        if t.kind is Kind.pack:
            sales = packs.get(t.package_id)
            if sales is None:
                sales = packs[t.package_id] = PackSales(
                    package_id=t.package_id, name=t.package_name or "Pack"
                )
            sales.add(t)
        else:
            getattr(summary, t.kind.value).add(t)
    summary.pack_sales = sorted(packs.values(), key=lambda s: (-s.amount, s.name))
    return summary


@dataclass
class Line:
    user: User
    transactions: list[Transaction]
    amount: Decimal = ZERO
    hours: Decimal = ZERO
    invoiced_amount: Decimal = ZERO
    pending_amount: Decimal = ZERO
    packs: list[tuple[str, int]] = field(default_factory=list)
    hourly_hours: Decimal = ZERO
    mixed_hours: Decimal = ZERO
    manual_hours: Decimal = ZERO

    @property
    def transactions_count(self) -> int:
        return len(self.transactions)

    @property
    def pending_count(self) -> int:
        return sum(1 for t in self.transactions if t.invoice_id is None)


def _line(user: User, transactions: list[Transaction]) -> Line:
    line = Line(user=user, transactions=transactions)
    pack_counts: dict[str, int] = defaultdict(int)
    for t in transactions:
        line.amount += t.amount
        line.hours += t.hours
        if t.invoice_id is None:
            line.pending_amount += t.amount
        else:
            line.invoiced_amount += t.amount
        if t.kind is Kind.pack:
            pack_counts[t.package_name or "Pack"] += 1
        elif t.kind is Kind.hourly:
            line.hourly_hours += t.hours
        elif t.kind is Kind.mixed:
            line.mixed_hours += t.hours
        else:
            line.manual_hours += t.hours
    line.packs = sorted(pack_counts.items())
    return line


def _keep(line: Line, invoiced: InvoicedFilter) -> bool:
    if invoiced is InvoicedFilter.pending:
        return line.pending_count > 0
    if invoiced is InvoicedFilter.done:
        return line.pending_count == 0
    return True


async def statement(
    db: AsyncSession,
    transactions: list[Transaction],
    invoiced: InvoicedFilter = InvoicedFilter.all,
) -> list[Line]:
    """One line per customer, the biggest amount first."""
    by_user: dict[uuid.UUID, list[Transaction]] = defaultdict(list)
    for t in transactions:
        by_user[t.user_id].append(t)
    if not by_user:
        return []
    users = {u.id: u for u in await db.scalars(select(User).where(User.id.in_(list(by_user))))}
    lines = [_line(users[user_id], rows) for user_id, rows in by_user.items()]
    lines = [line for line in lines if _keep(line, invoiced)]
    lines.sort(key=lambda line: (-line.amount, line.user.name.lower(), line.user.id))
    return lines


def decimal_pt(value: Decimal) -> str:
    """`1234.50` → `1234,50`: what Excel PT reads as a number."""
    return str(_quantised(value)).replace(".", ",")


def statement_csv(lines: list[Line]) -> str:
    """UTF-8 with BOM, `;`-separated, decimal comma: opens in Excel PT as is."""
    out = io.StringIO()
    out.write("﻿")
    writer = csv.writer(out, delimiter=";", lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for line in lines:
        writer.writerow(
            (
                line.user.name,
                line.user.email,
                getattr(line.user, "tax_id", None) or "",
                line.transactions_count,
                decimal_pt(line.hours),
                decimal_pt(line.amount),
                decimal_pt(line.invoiced_amount),
                decimal_pt(line.pending_amount),
            )
        )
    return out.getvalue()
