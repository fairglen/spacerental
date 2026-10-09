"""Invoice records, for the operator (I05).

Portuguese faturas come out of AT-certified software; what the operator
does HERE is register one they issued elsewhere — number, date, amount,
hours, the PDF — against the transactions it covers, so the statement can
say what is still to invoice and the customer can download theirs. The
amount and hours must equal the statement's own sums for the selected
transactions (the statement is the source of truth), a transaction is on at
most one invoice, and the PDF lives under the media root's private prefix
that the public `/media` mount never serves.
"""

import logging
import uuid
from datetime import date
from decimal import Decimal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, billing, media
from app.auth import require_admin
from app.database import get_db
from app.media import MediaStorage, get_media_storage
from app.models.booking import Booking, PaymentMethod
from app.models.invoice import Invoice, InvoiceItem
from app.models.package import PurchaseSource, UserPackagePurchase
from app.models.user import User
from app.ratelimit import UPLOAD_TIER, rate_limit
from app.routers.invoices import pdf_response
from app.schemas.invoice import InvoiceDetailOut, InvoiceItemOut, InvoiceOut, InvoiceUserOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

_READ_CHUNK = 1024 * 1024
ALREADY_INVOICED = "A transação já está faturada"
NUMBER_TAKEN = "Já existe uma fatura com este número"


async def _read_pdf(file: UploadFile) -> bytes:
    """The upload's bytes: 413 past the cap, 415 unless it starts like a PDF."""
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_READ_CHUNK):
        size += len(chunk)
        if size > media.MAX_INVOICE_PDF_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="O PDF excede 10 MB",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    if not media.is_pdf(data):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="O ficheiro não é um PDF"
        )
    return data


def _parse_transaction_ids(raw: list[str]) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """`kind:id` as the statement lists them (`pack` is a purchase, the rest
    are bookings); `booking:`/`purchase:` are accepted too."""
    bookings: set[uuid.UUID] = set()
    purchases: set[uuid.UUID] = set()
    for item in raw:
        kind, _, ident = item.partition(":")
        try:
            ref = uuid.UUID(ident)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Transação inválida: {item}",
            ) from None
        if kind in ("pack", "purchase"):
            purchases.add(ref)
        elif kind in ("hourly", "mixed", "manual", "booking"):
            bookings.add(ref)
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Transação inválida: {item}",
            )
    if not bookings and not purchases:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Selecione pelo menos uma transação",
        )
    return bookings, purchases


async def _selected_transactions(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    booking_ids: set[uuid.UUID],
    purchase_ids: set[uuid.UUID],
) -> list[billing.Transaction]:
    """The selected transactions, as the statement computes them. Anything
    that is not this customer's paid transaction in this org is a 404 — the
    same answer for another tenant's row and for a row that does not exist."""
    bookings = (
        await db.scalars(
            select(Booking)
            .options(selectinload(Booking.room))
            .where(
                Booking.id.in_(booking_ids),
                Booking.org_id == org_id,
                Booking.user_id == user_id,
                Booking.paid_at.is_not(None),
                Booking.payment_method.in_(
                    (PaymentMethod.hourly, PaymentMethod.mixed, PaymentMethod.manual)
                ),
                Booking.total_amount > 0,
            )
        )
    ).all()
    purchases = (
        await db.scalars(
            select(UserPackagePurchase)
            .options(selectinload(UserPackagePurchase.package))
            .where(
                UserPackagePurchase.id.in_(purchase_ids),
                UserPackagePurchase.org_id == org_id,
                UserPackagePurchase.user_id == user_id,
                UserPackagePurchase.paid_at.is_not(None),
                UserPackagePurchase.source == PurchaseSource.purchase,
            )
        )
    ).all()
    if len(bookings) != len(booking_ids) or len(purchases) != len(purchase_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    taken = await db.scalar(
        select(func.count())
        .select_from(InvoiceItem)
        .where(
            or_(
                InvoiceItem.booking_id.in_(booking_ids),
                InvoiceItem.purchase_id.in_(purchase_ids),
            )
        )
    )
    if taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ALREADY_INVOICED)
    return [billing.booking_transaction(b) for b in bookings] + [
        billing.purchase_transaction(p) for p in purchases
    ]


async def _invoice(
    db: AsyncSession, invoice_id: uuid.UUID, org_id: uuid.UUID, *, for_update: bool = False
) -> Invoice:
    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.items), selectinload(Invoice.user))
        .where(Invoice.id == invoice_id, Invoice.org_id == org_id)
        .execution_options(populate_existing=True)
    )
    if for_update:
        stmt = stmt.with_for_update(of=Invoice)
    invoice = await db.scalar(stmt)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return invoice


def _detail(invoice: Invoice) -> InvoiceDetailOut:
    return InvoiceDetailOut(
        **InvoiceOut.model_validate(invoice).model_dump(),
        user=InvoiceUserOut.model_validate(invoice.user),
        items=[
            InvoiceItemOut(
                kind="booking" if item.booking_id is not None else "purchase",
                id=item.booking_id or item.purchase_id,
            )
            for item in invoice.items
        ],
    )


def _conflict(exc: IntegrityError) -> HTTPException:
    detail = NUMBER_TAKEN if "uq_invoices_org_id_number" in str(exc.orig) else ALREADY_INVOICED
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


@router.post("/billing/invoices", status_code=status.HTTP_201_CREATED)
@rate_limit(UPLOAD_TIER)
async def admin_create_invoice(
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    user_id: uuid.UUID = Form(...),
    number: str = Form(..., min_length=1, max_length=64),
    issued_at: date = Form(...),
    period_from: date = Form(...),
    period_to: date = Form(...),
    amount: Decimal = Form(...),
    hours: Decimal = Form(...),
    transaction_ids: list[str] = Form(...),
    note: str | None = Form(None, max_length=2000),
    notify: bool = Form(False),
    pdf: UploadFile | None = File(None),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    """Register an invoice issued elsewhere ("Registar fatura emitida").
    Multipart: the fields, `transaction_ids[]` as `kind:id`, an optional
    `pdf`, and `notify` to email the customer (I08)."""
    if period_to < period_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O fim do período é anterior ao início",
        )
    booking_ids, purchase_ids = _parse_transaction_ids(transaction_ids)
    transactions = await _selected_transactions(db, org_id, user_id, booking_ids, purchase_ids)
    expected_amount = sum((t.amount for t in transactions), billing.ZERO)
    expected_hours = sum((t.hours for t in transactions), billing.ZERO)
    if (
        amount.quantize(billing.CENT) != expected_amount
        or hours.quantize(billing.CENT) != expected_hours
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "O valor e as horas têm de ser iguais à soma das transações selecionadas "
                f"({expected_amount} €, {expected_hours} h)"
            ),
        )
    data = await _read_pdf(pdf) if pdf is not None and pdf.filename else None

    invoice = Invoice(
        org_id=org_id,
        user_id=user_id,
        number=number.strip(),
        issued_at=issued_at,
        period_from=period_from,
        period_to=period_to,
        amount=expected_amount,
        hours=expected_hours,
        note=(note or "").strip() or None,
        created_by_admin_id=admin.id,
    )
    invoice.items = [InvoiceItem(booking_id=b) for b in sorted(booking_ids)] + [
        InvoiceItem(purchase_id=p) for p in sorted(purchase_ids)
    ]
    db.add(invoice)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise _conflict(exc) from None
    if data is not None:
        # The key carries the id, so the row goes first; a failed save leaves
        # the row without a PDF rather than a file without a row.
        invoice.pdf_key = media.invoice_pdf_key(org_id, invoice.id)
        await storage.save(invoice.pdf_key, data)
        await db.flush()
    invoice = await _invoice(db, invoice.id, org_id)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=invoice,
        action="create",
        after=audit.snapshot(invoice),
    )
    return {"invoice": _detail(invoice)}


@router.get("/billing/invoices")
async def admin_list_invoices(
    org_id: uuid.UUID = Query(...),
    user_id: uuid.UUID | None = Query(None),
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The org's registered invoices, newest first; `from`/`to` filter on the
    issue date, `user_id` on the customer."""
    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.items), selectinload(Invoice.user))
        .where(Invoice.org_id == org_id)
        .order_by(Invoice.issued_at.desc(), Invoice.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(Invoice.user_id == user_id)
    if date_from is not None:
        stmt = stmt.where(Invoice.issued_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Invoice.issued_at <= date_to)
    rows = await db.scalars(stmt)
    return {"invoices": [_detail(row) for row in rows]}


@router.get("/billing/invoices/{invoice_id}")
async def admin_get_invoice(
    invoice_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return {"invoice": _detail(await _invoice(db, invoice_id, org_id))}


@router.put("/billing/invoices/{invoice_id}")
@rate_limit(UPLOAD_TIER)
async def admin_update_invoice(
    invoice_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    number: str | None = Form(None, min_length=1, max_length=64),
    issued_at: date | None = Form(None),
    note: str | None = Form(None, max_length=2000),
    pdf: UploadFile | None = File(None),
    remove_pdf: bool = Form(False),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    """Number, issue date, note, and the PDF (replace with `pdf`, drop with
    `remove_pdf`). The amount, hours and transactions are the statement's and
    do not change here: delete and register again."""
    invoice = await _invoice(db, invoice_id, org_id, for_update=True)
    before = audit.snapshot(invoice)
    if number is not None:
        invoice.number = number.strip()
    if issued_at is not None:
        invoice.issued_at = issued_at
    # FastAPI reads an empty form field as "not sent", so a blank `note`
    # would never clear anything; the parsed form (cached by Starlette)
    # says whether the field was there at all.
    if "note" in await request.form():
        invoice.note = (note or "").strip() or None
    data = await _read_pdf(pdf) if pdf is not None and pdf.filename else None
    if data is not None:
        invoice.pdf_key = media.invoice_pdf_key(org_id, invoice.id)
        await storage.save(invoice.pdf_key, data)
    elif remove_pdf and invoice.pdf_key is not None:
        background_tasks.add_task(storage.delete, invoice.pdf_key)
        invoice.pdf_key = None
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise _conflict(exc) from None
    invoice = await _invoice(db, invoice.id, org_id)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=invoice,
        action="update",
        before=before,
        after=audit.snapshot(invoice),
    )
    return {"invoice": _detail(invoice)}


@router.delete("/billing/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_invoice(
    invoice_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    """Forget the record: its transactions are "por faturar" again and the
    PDF file goes after the commit."""
    invoice = await _invoice(db, invoice_id, org_id, for_update=True)
    before = audit.snapshot(invoice)
    pdf_key = invoice.pdf_key
    await db.delete(invoice)
    await db.flush()
    await audit.record(
        db, actor=admin, org_id=org_id, entity=invoice, action="delete", before=before
    )
    if pdf_key is not None:
        background_tasks.add_task(storage.delete, pdf_key)
    return None


@router.get("/billing/invoices/{invoice_id}/pdf")
async def admin_invoice_pdf(
    invoice_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    return await pdf_response(storage, await _invoice(db, invoice_id, org_id))
