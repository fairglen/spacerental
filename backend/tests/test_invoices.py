"""I05: invoice records — the operator registers a fatura issued elsewhere
against the transactions it covers; the customer downloads it.

The September-2026 ledger (conftest) is the source: Ana's four transactions
add up to 88.00 € and 8.00 h, which is what her invoice must say.
"""

import os
import uuid
from pathlib import Path

from app.models.audit import AdminAction
from sqlalchemy import select

API = "/api/v1"
INVOICES = f"{API}/admin/billing/invoices"
STATEMENT = f"{API}/admin/billing/statement"
SUMMARY = f"{API}/admin/billing/summary"
MEDIA_ROOT = Path(os.environ["MEDIA_ROOT"])

PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def _ana_ids(ledger) -> list[str]:
    return [
        f"hourly:{ledger.edge_in_ana.id}",
        f"hourly:{ledger.hourly_ana.id}",
        f"mixed:{ledger.mixed_ana.id}",
        f"pack:{ledger.pack_ana.id}",
    ]


def _form(ledger, **overrides) -> dict:
    form = {
        "user_id": str(ledger.ana.id),
        "number": "FT 2026/12",
        "issued_at": "2026-10-02",
        "period_from": "2026-09-01",
        "period_to": "2026-09-30",
        "amount": "88.00",
        "hours": "8.00",
        "transaction_ids": _ana_ids(ledger),
        "note": "Enviada por email",
    }
    form.update(overrides)
    return form


async def _register(client, admin_headers, ledger, *, pdf=PDF, **overrides):
    files = {"pdf": ("fatura.pdf", pdf, "application/pdf")} if pdf is not None else None
    return await client.post(
        INVOICES,
        params={"org_id": str(ledger.org.id)},
        data=_form(ledger, **overrides),
        files=files,
        headers=admin_headers,
    )


def _pdf_path(org_id, invoice_id) -> Path:
    return MEDIA_ROOT / "private" / "invoices" / str(org_id) / f"{invoice_id}.pdf"


class TestRegister:
    async def test_the_statements_sums_with_a_pdf(
        self, client, admin_headers, admin_user, ledger, db_session
    ):
        resp = await _register(client, admin_headers, ledger)
        assert resp.status_code == 201, resp.text
        invoice = resp.json()["invoice"]
        assert invoice["number"] == "FT 2026/12"
        assert (invoice["amount"], invoice["hours"], invoice["currency"]) == (
            "88.00",
            "8.00",
            "EUR",
        )
        assert (invoice["period_from"], invoice["period_to"]) == ("2026-09-01", "2026-09-30")
        assert invoice["has_pdf"] is True
        assert invoice["note"] == "Enviada por email"
        assert invoice["created_by_admin_id"] == str(admin_user.id)
        assert invoice["user"]["email"] == "user@test.com"
        assert sorted(i["kind"] for i in invoice["items"]) == [
            "booking",
            "booking",
            "booking",
            "purchase",
        ]
        assert "pdf_key" not in invoice
        path = _pdf_path(ledger.org.id, invoice["id"])
        assert path.read_bytes() == PDF

        # The audit trail has the create, with the public snapshot only.
        row = await db_session.scalar(
            select(AdminAction).where(AdminAction.entity_id == uuid.UUID(invoice["id"]))
        )
        assert row is not None
        assert (row.entity_type, row.action, row.actor_user_id) == (
            "invoice",
            "create",
            admin_user.id,
        )
        assert row.after["number"] == "FT 2026/12" and "pdf_key" not in row.after

    async def test_the_statement_then_shows_what_is_invoiced(self, client, admin_headers, ledger):
        resp = await _register(client, admin_headers, ledger, pdf=None)
        assert resp.status_code == 201, resp.text
        invoice_id = resp.json()["invoice"]["id"]
        assert resp.json()["invoice"]["has_pdf"] is False

        resp = await client.get(STATEMENT, params=ledger.params, headers=admin_headers)
        bruno, ana = resp.json()["statement"]["lines"]
        assert (ana["invoiced_amount"], ana["pending_amount"]) == ("88.00", "0.00")
        assert {t["invoice_id"] for t in ana["transactions"]} == {invoice_id}
        assert (bruno["invoiced_amount"], bruno["pending_amount"]) == ("0.00", "133.00")
        assert all(t["invoice_id"] is None for t in bruno["transactions"])

        resp = await client.get(SUMMARY, params=ledger.params, headers=admin_headers)
        summary = resp.json()["summary"]
        assert (summary["invoiced_amount"], summary["pending_amount"]) == ("88.00", "133.00")

        for filter_, expected in (("done", ["user@test.com"]), ("pending", ["bruno@test.com"])):
            resp = await client.get(
                STATEMENT, params={**ledger.params, "invoiced": filter_}, headers=admin_headers
            )
            assert [line["user"]["email"] for line in resp.json()["statement"]["lines"]] == (
                expected
            ), filter_

        resp = await client.get(
            f"{API}/admin/billing/statement.csv", params=ledger.params, headers=admin_headers
        )
        rows = resp.content.decode("utf-8-sig").split("\r\n")
        assert rows[2] == "Test User;user@test.com;;4;8,00;88,00;88,00;0,00"

    async def test_the_amount_and_hours_must_be_the_statements(self, client, admin_headers, ledger):
        for bad in ({"amount": "88.01"}, {"hours": "7.00"}, {"amount": "87.99", "hours": "8.00"}):
            resp = await _register(client, admin_headers, ledger, pdf=None, **bad)
            assert resp.status_code == 422, (bad, resp.text)
            assert "88.00 €, 8.00 h" in resp.json()["detail"]

    async def test_a_transaction_is_invoiced_once(self, client, admin_headers, ledger):
        first = await _register(client, admin_headers, ledger, pdf=None)
        assert first.status_code == 201, first.text
        again = await _register(
            client,
            admin_headers,
            ledger,
            pdf=None,
            number="FT 2026/13",
            transaction_ids=[f"hourly:{ledger.hourly_ana.id}"],
            amount="11.00",
            hours="1.00",
        )
        assert again.status_code == 409, again.text
        assert again.json()["detail"] == "A transação já está faturada"

    async def test_the_number_is_unique_per_org(self, client, admin_headers, ledger):
        first = await _register(client, admin_headers, ledger, pdf=None)
        assert first.status_code == 201, first.text
        same_number = await _register(
            client,
            admin_headers,
            ledger,
            pdf=None,
            user_id=str(ledger.bruno.id),
            transaction_ids=[f"manual:{ledger.manual_bruno.id}"],
            amount="22.00",
            hours="2.00",
        )
        assert same_number.status_code == 409, same_number.text
        assert same_number.json()["detail"] == "Já existe uma fatura com este número"

    async def test_only_this_customers_paid_transactions_in_this_org(
        self, client, admin_headers, ledger
    ):
        cases = {
            "another customer's booking": [f"manual:{ledger.manual_bruno.id}"],
            "an unpaid hold": [f"hourly:{ledger.pending_ana.id}"],
            "a pack-paid booking": [f"hourly:{ledger.package_ana.id}"],
            "a complimentary grant": [f"pack:{ledger.gift_ana.id}"],
            "another org's purchase": [f"pack:{ledger.other_org_pack.id}"],
            "a random id": [f"hourly:{uuid.uuid4()}"],
        }
        for label, ids in cases.items():
            resp = await _register(
                client, admin_headers, ledger, pdf=None, transaction_ids=ids, amount="0", hours="0"
            )
            assert resp.status_code == 404, (label, resp.text)
        for bad in ([], ["hourly:not-a-uuid"], [f"gift:{ledger.hourly_ana.id}"]):
            resp = await _register(client, admin_headers, ledger, pdf=None, transaction_ids=bad)
            assert resp.status_code == 422, (bad, resp.text)
        resp = await _register(
            client,
            admin_headers,
            ledger,
            pdf=None,
            period_from="2026-09-30",
            period_to="2026-09-01",
        )
        assert resp.status_code == 422

    async def test_the_pdf_must_be_a_pdf_under_10_mb(self, client, admin_headers, ledger):
        resp = await _register(client, admin_headers, ledger, pdf=b"<html>not a pdf</html>")
        assert resp.status_code == 415, resp.text
        resp = await _register(
            client, admin_headers, ledger, pdf=b"%PDF-1.4\n" + b"0" * (10 * 1024 * 1024)
        )
        assert resp.status_code == 413, resp.text
        # Neither attempt left a row behind: the number is still free.
        resp = await _register(client, admin_headers, ledger)
        assert resp.status_code == 201, resp.text

    async def test_a_member_is_refused_and_another_org_too(
        self, client, auth_headers, admin_headers, ledger
    ):
        resp = await client.post(
            INVOICES,
            params={"org_id": str(ledger.org.id)},
            data=_form(ledger),
            headers=auth_headers,
        )
        assert resp.status_code == 403
        resp = await client.post(
            INVOICES,
            params={"org_id": str(ledger.other_org.id)},
            data=_form(ledger),
            headers=admin_headers,
        )
        assert resp.status_code == 403


class TestListGetUpdateDelete:
    async def test_list_filters_and_get(self, client, admin_headers, ledger):
        first = await _register(client, admin_headers, ledger, pdf=None)
        second = await _register(
            client,
            admin_headers,
            ledger,
            pdf=None,
            number="FT 2026/13",
            issued_at="2026-11-05",
            user_id=str(ledger.bruno.id),
            transaction_ids=[f"manual:{ledger.manual_bruno.id}", f"pack:{ledger.pack_bruno.id}"],
            amount="122.00",
            hours="12.00",
        )
        assert (first.status_code, second.status_code) == (201, 201), second.text
        params = {"org_id": str(ledger.org.id)}

        resp = await client.get(INVOICES, params=params, headers=admin_headers)
        assert [i["number"] for i in resp.json()["invoices"]] == ["FT 2026/13", "FT 2026/12"]
        resp = await client.get(
            INVOICES, params={**params, "user_id": str(ledger.bruno.id)}, headers=admin_headers
        )
        assert [i["number"] for i in resp.json()["invoices"]] == ["FT 2026/13"]
        resp = await client.get(
            INVOICES,
            params={**params, "from": "2026-10-01", "to": "2026-10-31"},
            headers=admin_headers,
        )
        assert [i["number"] for i in resp.json()["invoices"]] == ["FT 2026/12"]

        invoice_id = first.json()["invoice"]["id"]
        resp = await client.get(f"{INVOICES}/{invoice_id}", params=params, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["invoice"]["items"] == first.json()["invoice"]["items"]
        resp = await client.get(f"{INVOICES}/{uuid.uuid4()}", params=params, headers=admin_headers)
        assert resp.status_code == 404
        resp = await client.get(
            f"{INVOICES}/{invoice_id}",
            params={"org_id": str(ledger.other_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 403

    async def test_update_number_date_note_and_replace_the_pdf(
        self, client, admin_headers, ledger, db_session
    ):
        created = await _register(client, admin_headers, ledger)
        invoice_id = created.json()["invoice"]["id"]
        params = {"org_id": str(ledger.org.id)}
        new_pdf = b"%PDF-1.7\n%%EOF\n"
        resp = await client.put(
            f"{INVOICES}/{invoice_id}",
            params=params,
            data={"number": "FT 2026/14", "issued_at": "2026-10-03", "note": ""},
            files={"pdf": ("nova.pdf", new_pdf, "application/pdf")},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        invoice = resp.json()["invoice"]
        assert (invoice["number"], invoice["issued_at"], invoice["note"]) == (
            "FT 2026/14",
            "2026-10-03",
            None,
        )
        assert invoice["amount"] == "88.00"
        assert _pdf_path(ledger.org.id, invoice_id).read_bytes() == new_pdf

        rows = await db_session.scalars(
            select(AdminAction).where(AdminAction.entity_id == uuid.UUID(invoice_id))
        )
        actions = {row.action: row for row in rows}
        assert set(actions) == {"create", "update"}
        assert actions["update"].before["number"] == "FT 2026/12"
        assert actions["update"].after["number"] == "FT 2026/14"

        resp = await client.put(
            f"{INVOICES}/{invoice_id}",
            params=params,
            data={"remove_pdf": "true"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["invoice"]["has_pdf"] is False
        resp = await client.get(
            f"{INVOICES}/{invoice_id}/pdf", params=params, headers=admin_headers
        )
        assert resp.status_code == 404

    async def test_update_cannot_take_another_invoices_number(self, client, admin_headers, ledger):
        first = await _register(client, admin_headers, ledger, pdf=None)
        second = await _register(
            client,
            admin_headers,
            ledger,
            pdf=None,
            number="FT 2026/13",
            user_id=str(ledger.bruno.id),
            transaction_ids=[f"manual:{ledger.manual_bruno.id}"],
            amount="22.00",
            hours="2.00",
        )
        resp = await client.put(
            f"{INVOICES}/{second.json()['invoice']['id']}",
            params={"org_id": str(ledger.org.id)},
            data={"number": first.json()["invoice"]["number"]},
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text

    async def test_delete_unlinks_the_transactions_and_drops_the_file(
        self, client, admin_headers, ledger, db_session
    ):
        created = await _register(client, admin_headers, ledger)
        invoice_id = created.json()["invoice"]["id"]
        params = {"org_id": str(ledger.org.id)}
        path = _pdf_path(ledger.org.id, invoice_id)
        assert path.exists()

        resp = await client.delete(f"{INVOICES}/{invoice_id}", params=params, headers=admin_headers)
        assert resp.status_code == 204, resp.text
        assert not path.exists()
        resp = await client.get(f"{INVOICES}/{invoice_id}", params=params, headers=admin_headers)
        assert resp.status_code == 404
        resp = await client.get(STATEMENT, params=ledger.params, headers=admin_headers)
        ana = resp.json()["statement"]["lines"][1]
        assert (ana["invoiced_amount"], ana["pending_amount"]) == ("0.00", "88.00")
        row = await db_session.scalar(
            select(AdminAction).where(
                AdminAction.entity_id == uuid.UUID(invoice_id), AdminAction.action == "delete"
            )
        )
        assert row is not None and row.before["number"] == "FT 2026/12"
        # Registering again is possible: the transactions are free.
        resp = await _register(client, admin_headers, ledger, pdf=None)
        assert resp.status_code == 201, resp.text


class TestPdf:
    async def test_streamed_as_a_download_never_from_media(self, client, admin_headers, ledger):
        created = await _register(client, admin_headers, ledger)
        invoice_id = created.json()["invoice"]["id"]
        resp = await client.get(
            f"{INVOICES}/{invoice_id}/pdf",
            params={"org_id": str(ledger.org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.headers["content-disposition"] == 'attachment; filename="fatura-FT-2026-12.pdf"'
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.content == PDF

        # The file is under the media root, but the public mount refuses it.
        key = f"private/invoices/{ledger.org.id}/{invoice_id}.pdf"
        assert (MEDIA_ROOT / key).exists()
        resp = await client.get(f"/media/{key}")
        assert resp.status_code == 404
        resp = await client.get("/media/private")
        assert resp.status_code == 404

    async def test_the_customer_downloads_their_own_and_nobody_elses(
        self, client, admin_headers, auth_headers, ledger
    ):
        created = await _register(client, admin_headers, ledger)
        invoice_id = created.json()["invoice"]["id"]
        resp = await client.get(f"{API}/invoices/me", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "invoices": [
                {
                    "id": invoice_id,
                    "number": "FT 2026/12",
                    "issued_at": "2026-10-02",
                    "period_from": "2026-09-01",
                    "period_to": "2026-09-30",
                    "amount": "88.00",
                    "hours": "8.00",
                    "currency": "EUR",
                    "has_pdf": True,
                }
            ]
        }
        resp = await client.get(f"{API}/invoices/{invoice_id}/pdf", headers=auth_headers)
        assert resp.status_code == 200 and resp.content == PDF

        from app.auth import create_access_token

        bruno = {
            "Authorization": "Bearer "
            + create_access_token(
                {
                    "sub": str(ledger.bruno.id),
                    "email": ledger.bruno.email,
                    "name": ledger.bruno.name,
                    "role": "member",
                }
            )
        }
        assert (await client.get(f"{API}/invoices/me", headers=bruno)).json() == {"invoices": []}
        resp = await client.get(f"{API}/invoices/{invoice_id}/pdf", headers=bruno)
        assert resp.status_code == 404
        assert (await client.get(f"{API}/invoices/me")).status_code == 401

    async def test_a_member_cannot_use_the_operator_download(
        self, client, admin_headers, auth_headers, ledger
    ):
        created = await _register(client, admin_headers, ledger)
        resp = await client.get(
            f"{INVOICES}/{created.json()['invoice']['id']}/pdf",
            params={"org_id": str(ledger.org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 403


class TestNotify:
    """I08: "Fatura disponível" goes out when the operator asks, never otherwise."""

    async def test_notify_sends_the_customer_one_email_with_the_link(
        self, client, admin_headers, ledger, emails
    ):
        resp = await _register(client, admin_headers, ledger, notify="true")
        assert resp.status_code == 201, resp.text
        assert len(emails.sent) == 1
        message = emails.sent[0]
        assert message.to == "user@test.com"
        assert message.subject.startswith("Fatura FT 2026/12 disponível")
        assert "88,00 €" in message.text_body
        assert "02/10/2026" in message.text_body
        assert "/dashboard/billing" in message.text_body
        assert "transferir o PDF" in message.text_body
        assert "você" not in message.text_body.lower()

    async def test_without_notify_nothing_is_sent(self, client, admin_headers, ledger, emails):
        resp = await _register(client, admin_headers, ledger, pdf=None)
        assert resp.status_code == 201, resp.text
        assert emails.sent == []
        resp = await _register(
            client,
            admin_headers,
            ledger,
            pdf=None,
            notify="false",
            number="FT 2026/13",
            user_id=str(ledger.bruno.id),
            transaction_ids=[f"manual:{ledger.manual_bruno.id}"],
            amount="22.00",
            hours="2.00",
        )
        assert resp.status_code == 201, resp.text
        assert emails.sent == []

    async def test_a_refused_registration_sends_nothing(
        self, client, admin_headers, ledger, emails
    ):
        resp = await _register(
            client, admin_headers, ledger, pdf=None, notify="true", amount="1.00"
        )
        assert resp.status_code == 422
        assert emails.sent == []
