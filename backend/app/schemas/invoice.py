"""Invoice records (I05): what the operator registers and what each side sees."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


class InvoiceOut(BaseModel):
    """An invoice as the operator lists it and as the audit trail snapshots
    it: the PDF is a flag, never a key or a URL."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    user_id: uuid.UUID
    number: str
    issued_at: date
    period_from: date
    period_to: date
    amount: Decimal
    hours: Decimal
    currency: str
    note: str | None
    has_pdf: bool
    created_by_admin_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class InvoiceItemOut(BaseModel):
    kind: Literal["booking", "purchase"]
    id: uuid.UUID


class InvoiceUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    email: str
    tax_id: str | None = None
    billing_name: str | None = None


class InvoiceDetailOut(InvoiceOut):
    user: InvoiceUserOut
    items: list[InvoiceItemOut]


class MyInvoiceOut(BaseModel):
    """The customer's view (I07): no operator ids, no note."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: str
    issued_at: date
    period_from: date
    period_to: date
    amount: Decimal
    hours: Decimal
    currency: str
    has_pdf: bool
