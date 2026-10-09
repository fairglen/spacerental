"""The operator's billing statement (I02).

`GET /admin/billing/summary` totals what was received in a period;
`GET /admin/billing/statement` lists it per customer with every
transaction, so invoices can be issued from it; `statement.csv` is the same
lines for Excel. All three read the ledger by `paid_at` (I01) over Lisbon
calendar days, and nothing here writes.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import billing
from app.auth import require_admin
from app.database import get_db
from app.models.user import User
from app.schemas.billing import BillingSummaryOut, StatementLineOut, StatementOut

router = APIRouter(tags=["admin"])


def _period(date_from: date, date_to: date) -> billing.Period:
    try:
        return billing.period(date_from, date_to)
    except billing.InvalidPeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from None


@router.get("/billing/summary")
async def billing_summary(
    org_id: uuid.UUID = Query(...),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    within = _period(date_from, date_to)
    transactions = await billing.load_transactions(db, org_id, within)
    return {"summary": BillingSummaryOut.build(within, billing.summarise(transactions))}


@router.get("/billing/statement")
async def billing_statement(
    org_id: uuid.UUID = Query(...),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    invoiced: billing.InvoicedFilter = Query(billing.InvoicedFilter.all),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    within = _period(date_from, date_to)
    transactions = await billing.load_transactions(db, org_id, within)
    lines = await billing.statement(db, transactions, invoiced)
    return {
        "statement": StatementOut(
            date_from=within.date_from,
            date_to=within.date_to,
            invoiced=invoiced,
            lines=[StatementLineOut.build(line) for line in lines],
        )
    }


@router.get("/billing/statement.csv")
async def billing_statement_csv(
    org_id: uuid.UUID = Query(...),
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    invoiced: billing.InvoicedFilter = Query(billing.InvoicedFilter.all),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The statement as Excel PT opens it: UTF-8 with BOM, `;`, decimal comma."""
    within = _period(date_from, date_to)
    transactions = await billing.load_transactions(db, org_id, within)
    lines = await billing.statement(db, transactions, invoiced)
    filename = f"extrato-{within.date_from.isoformat()}_{within.date_to.isoformat()}.csv"
    return Response(
        content=billing.statement_csv(lines).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
