"""The billing statement's shapes (I02)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app import billing
from app.models.user import User


class BillingUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: billing.Kind
    id: uuid.UUID
    paid_at: datetime
    label: str
    amount: Decimal
    hours: Decimal
    channel: billing.Channel
    invoice_id: uuid.UUID | None = None


class KindTotalsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    count: int
    amount: Decimal
    hours: Decimal


class PackSalesOut(KindTotalsOut):
    package_id: uuid.UUID | None
    name: str


class ByChannelOut(BaseModel):
    online: Decimal
    manual: Decimal


class PeriodOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date_from: date = Field(serialization_alias="from")
    date_to: date = Field(serialization_alias="to")


class BillingSummaryOut(PeriodOut):
    received_total: Decimal
    by_channel: ByChannelOut
    pack_sales: list[PackSalesOut]
    hourly: KindTotalsOut
    mixed: KindTotalsOut
    manual: KindTotalsOut
    transactions_count: int
    invoiced_amount: Decimal
    pending_amount: Decimal

    @classmethod
    def build(cls, within: billing.Period, summary: billing.Summary) -> BillingSummaryOut:
        return cls(
            date_from=within.date_from,
            date_to=within.date_to,
            received_total=summary.received_total,
            by_channel=ByChannelOut(
                online=summary.by_channel[billing.Channel.online],
                manual=summary.by_channel[billing.Channel.manual],
            ),
            pack_sales=[PackSalesOut.model_validate(s) for s in summary.pack_sales],
            hourly=KindTotalsOut.model_validate(summary.hourly),
            mixed=KindTotalsOut.model_validate(summary.mixed),
            manual=KindTotalsOut.model_validate(summary.manual),
            transactions_count=summary.transactions_count,
            invoiced_amount=summary.invoiced_amount,
            pending_amount=summary.pending_amount,
        )


class PackCountOut(BaseModel):
    name: str
    count: int


class BreakdownOut(BaseModel):
    packs: list[PackCountOut]
    hourly_hours: Decimal
    mixed_hours: Decimal
    manual_hours: Decimal


class StatementLineOut(BaseModel):
    user: BillingUserOut
    amount: Decimal
    hours: Decimal
    transactions_count: int
    breakdown: BreakdownOut
    invoiced_amount: Decimal
    pending_amount: Decimal
    transactions: list[TransactionOut]

    @classmethod
    def build(cls, line: billing.Line) -> StatementLineOut:
        return cls(
            user=billing_user_out(line.user),
            amount=line.amount,
            hours=line.hours,
            transactions_count=line.transactions_count,
            breakdown=BreakdownOut(
                packs=[PackCountOut(name=name, count=count) for name, count in line.packs],
                hourly_hours=line.hourly_hours,
                mixed_hours=line.mixed_hours,
                manual_hours=line.manual_hours,
            ),
            invoiced_amount=line.invoiced_amount,
            pending_amount=line.pending_amount,
            transactions=[TransactionOut.model_validate(t) for t in line.transactions],
        )


class StatementOut(PeriodOut):
    invoiced: billing.InvoicedFilter
    lines: list[StatementLineOut]


def billing_user_out(user: User) -> BillingUserOut:
    return BillingUserOut.model_validate(user)
