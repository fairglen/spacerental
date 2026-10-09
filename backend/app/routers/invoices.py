"""The customer's invoices (I05/I07): the records of faturas issued to them,
and each one's PDF. Ownership is the only check — an invoice that is not the
caller's is a 404, like one that does not exist."""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.media import MediaStorage, get_media_storage
from app.models.invoice import Invoice
from app.models.user import User
from app.schemas.invoice import MyInvoiceOut

router = APIRouter(prefix="/invoices", tags=["invoices"])

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


async def pdf_response(storage: MediaStorage, invoice: Invoice) -> Response:
    """The invoice's PDF as a download, never inline and never sniffed; the
    public `/media` mount refuses the same key (`app.main.PublicMediaFiles`).
    The caller has already decided this person may see the invoice."""
    if invoice.pdf_key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Esta fatura não tem PDF")
    try:
        data = await storage.read(invoice.pdf_key)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Esta fatura não tem PDF"
        ) from None
    safe = _UNSAFE.sub("-", invoice.number).strip("-") or "fatura"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="fatura-{safe}.pdf"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/me")
async def my_invoices(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Every invoice issued to the caller, newest first, across organisations
    (the way `/packages/me` spans them)."""
    rows = await db.scalars(
        select(Invoice)
        .where(Invoice.user_id == user.id)
        .order_by(Invoice.issued_at.desc(), Invoice.created_at.desc())
    )
    return {"invoices": [MyInvoiceOut.model_validate(row) for row in rows]}


@router.get("/{invoice_id}/pdf")
async def my_invoice_pdf(
    invoice_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    invoice = await db.scalar(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.user_id == user.id)
    )
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return await pdf_response(storage, invoice)
