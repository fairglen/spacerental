"""I02: the billing statement — what was received in a period, per customer.

The ledger fixture (conftest) is September 2026 with hand-computed totals;
the period math is checked on its own because the Lisbon day boundary is
the one place an off-by-an-hour would silently move money between months.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from app import billing
from app.models.organization import Organization, OrgPlan

API = "/api/v1"
SUMMARY_URL = f"{API}/admin/billing/summary"
STATEMENT_URL = f"{API}/admin/billing/statement"
CSV_URL = f"{API}/admin/billing/statement.csv"


class TestPeriod:
    def test_lisbon_summer_days_start_an_hour_before_utc_midnight(self):
        within = billing.period(date(2026, 9, 1), date(2026, 9, 30))
        assert within.start == datetime(2026, 8, 31, 23, 0, tzinfo=UTC)
        assert within.end == datetime(2026, 9, 30, 23, 0, tzinfo=UTC)

    def test_lisbon_winter_days_are_utc_days(self):
        within = billing.period(date(2026, 12, 1), date(2026, 12, 31))
        assert within.start == datetime(2026, 12, 1, 0, 0, tzinfo=UTC)
        assert within.end == datetime(2027, 1, 1, 0, 0, tzinfo=UTC)

    def test_a_reversed_or_overlong_range_is_refused(self):
        with pytest.raises(billing.InvalidPeriodError):
            billing.period(date(2026, 9, 30), date(2026, 9, 1))
        with pytest.raises(billing.InvalidPeriodError):
            billing.period(date(2026, 1, 1), date(2027, 1, 2))
        assert billing.period(date(2026, 1, 1), date(2026, 12, 31)).date_to == date(2026, 12, 31)

    def test_the_month_of_an_instant_is_its_lisbon_month(self):
        # 31 July 23:30 UTC is already 1 August in Lisbon.
        within = billing.month_of(datetime(2026, 7, 31, 23, 30, tzinfo=UTC))
        assert (within.date_from, within.date_to) == (date(2026, 8, 1), date(2026, 8, 31))
        within = billing.month_of(datetime(2026, 12, 31, 23, 30, tzinfo=UTC))
        assert (within.date_from, within.date_to) == (date(2026, 12, 1), date(2026, 12, 31))

    def test_decimal_comma(self):
        assert billing.decimal_pt(Decimal("1234.5")) == "1234,50"
        assert billing.decimal_pt(Decimal(0)) == "0,00"


class TestSummary:
    async def test_september_adds_up_by_paid_at(self, client, admin_headers, ledger):
        resp = await client.get(SUMMARY_URL, params=ledger.params, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        summary = resp.json()["summary"]
        expected = ledger.expected
        assert summary["from"] == "2026-09-01" and summary["to"] == "2026-09-30"
        assert summary["received_total"] == expected["received_total"]
        assert summary["by_channel"] == expected["by_channel"]
        assert summary["pack_sales"] == expected["pack_sales"]
        assert summary["hourly"] == expected["hourly"]
        assert summary["mixed"] == expected["mixed"]
        assert summary["manual"] == expected["manual"]
        assert summary["transactions_count"] == expected["transactions_count"]
        assert summary["invoiced_amount"] == "0.00"
        assert summary["pending_amount"] == expected["received_total"]

    async def test_a_month_with_nothing_is_all_zeros(self, client, admin_headers, ledger):
        params = {**ledger.params, "from": "2026-11-01", "to": "2026-11-30"}
        resp = await client.get(SUMMARY_URL, params=params, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        summary = resp.json()["summary"]
        assert summary["received_total"] == "0.00"
        assert summary["transactions_count"] == 0
        assert summary["pack_sales"] == []
        assert summary["hourly"] == {"count": 0, "amount": "0.00", "hours": "0.00"}

    async def test_a_single_day_is_a_lisbon_day(self, client, admin_headers, ledger):
        # The booking paid at 31 Aug 23:30 UTC belongs to 1 September.
        params = {**ledger.params, "from": "2026-09-01", "to": "2026-09-01"}
        resp = await client.get(SUMMARY_URL, params=params, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["summary"]["hourly"] == {
            "count": 1,
            "amount": "11.00",
            "hours": "1.00",
        }
        params = {**ledger.params, "from": "2026-08-31", "to": "2026-08-31"}
        resp = await client.get(SUMMARY_URL, params=params, headers=admin_headers)
        assert resp.json()["summary"]["transactions_count"] == 0

    @pytest.mark.parametrize(
        "bad",
        [
            {"from": "2026-09-30", "to": "2026-09-01"},
            {"from": "2026-01-01", "to": "2027-01-02"},
            {"from": "2026-09-01"},
            {"from": "setembro", "to": "2026-09-30"},
        ],
    )
    async def test_a_bad_range_is_422(self, client, admin_headers, ledger, bad):
        params = {"org_id": str(ledger.org.id), **bad}
        resp = await client.get(SUMMARY_URL, params=params, headers=admin_headers)
        assert resp.status_code == 422, resp.text

    async def test_a_member_is_refused(self, client, auth_headers, ledger):
        resp = await client.get(SUMMARY_URL, params=ledger.params, headers=auth_headers)
        assert resp.status_code == 403

    async def test_another_organisations_books_are_refused(self, client, admin_headers, ledger):
        params = {**ledger.params, "org_id": str(ledger.other_org.id)}
        for url in (SUMMARY_URL, STATEMENT_URL, CSV_URL):
            resp = await client.get(url, params=params, headers=admin_headers)
            assert resp.status_code == 403, url


class TestStatement:
    async def test_one_line_per_customer_biggest_first(self, client, admin_headers, ledger):
        resp = await client.get(STATEMENT_URL, params=ledger.params, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        statement = resp.json()["statement"]
        assert statement["invoiced"] == "all"
        lines = statement["lines"]
        assert [line["user"]["email"] for line in lines] == ["bruno@test.com", "user@test.com"]
        bruno, ana = lines
        for line, key in ((bruno, "bruno"), (ana, "ana")):
            for field, value in ledger.expected[key].items():
                assert line[field] == value, (key, field)
            assert line["invoiced_amount"] == "0.00"
            assert line["pending_amount"] == line["amount"]
        assert ana["user"] == {
            "id": str(ledger.ana.id),
            "name": "Test User",
            "email": "user@test.com",
        }
        assert ana["breakdown"] == {
            "packs": [{"name": "Pack 5h", "count": 1}],
            "hourly_hours": "2.00",
            "mixed_hours": "1.00",
            "manual_hours": "0.00",
        }
        assert bruno["breakdown"] == {
            "packs": [{"name": "Pack 10h", "count": 1}],
            "hourly_hours": "1.00",
            "mixed_hours": "0.00",
            "manual_hours": "2.00",
        }

    async def test_transactions_are_dated_labelled_and_in_order(
        self, client, admin_headers, ledger
    ):
        resp = await client.get(STATEMENT_URL, params=ledger.params, headers=admin_headers)
        ana = resp.json()["statement"]["lines"][1]
        transactions = ana["transactions"]
        assert [t["id"] for t in transactions] == [
            str(ledger.edge_in_ana.id),
            str(ledger.hourly_ana.id),
            str(ledger.mixed_ana.id),
            str(ledger.pack_ana.id),
        ]
        assert [t["kind"] for t in transactions] == ["hourly", "hourly", "mixed", "pack"]
        assert transactions[0]["paid_at"].startswith("2026-08-31T23:30")
        label = f"{ledger.room.name} · 07/10/2026 10:00–11:00"  # noqa: RUF001
        assert transactions[0]["label"].startswith(label)
        assert transactions[2] | {"label": ""} == {
            "kind": "mixed",
            "id": str(ledger.mixed_ana.id),
            "paid_at": transactions[2]["paid_at"],
            "label": "",
            "amount": "11.00",
            "hours": "1.00",
            "channel": "online",
            "invoice_id": None,
        }
        assert transactions[3]["label"] == "Pack 5h"
        ids = {t["id"] for line in resp.json()["statement"]["lines"] for t in line["transactions"]}
        for excluded in (
            ledger.pending_ana,
            ledger.package_ana,
            ledger.edge_out_ana,
            ledger.gift_ana,
            ledger.credit_bruno,
            ledger.pending_pack_ana,
            ledger.other_org_pack,
        ):
            assert str(excluded.id) not in ids
        assert str(ledger.cancelled_paid_bruno.id) in ids

    async def test_the_invoiced_filter(self, client, admin_headers, ledger):
        params = {**ledger.params, "invoiced": "pending"}
        resp = await client.get(STATEMENT_URL, params=params, headers=admin_headers)
        assert len(resp.json()["statement"]["lines"]) == 2
        params = {**ledger.params, "invoiced": "done"}
        resp = await client.get(STATEMENT_URL, params=params, headers=admin_headers)
        assert resp.json()["statement"]["lines"] == []
        params = {**ledger.params, "invoiced": "maybe"}
        resp = await client.get(STATEMENT_URL, params=params, headers=admin_headers)
        assert resp.status_code == 422

    async def test_an_empty_month_has_no_lines(self, client, admin_headers, ledger):
        params = {**ledger.params, "from": "2026-11-01", "to": "2026-11-30"}
        resp = await client.get(STATEMENT_URL, params=params, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["statement"]["lines"] == []

    async def test_another_organisations_rows_never_appear(
        self, client, admin_headers, ledger, db_session
    ):
        # Belt and braces for the `other_org_pack` exclusion above: an org
        # with nothing of its own, read by an admin who is not its member.
        empty = Organization(name="Vazia", slug="vazia", plan=OrgPlan.starter, settings={})
        db_session.add(empty)
        await db_session.commit()
        params = {**ledger.params, "org_id": str(empty.id)}
        resp = await client.get(STATEMENT_URL, params=params, headers=admin_headers)
        assert resp.status_code == 403


class TestCsv:
    async def test_excel_pt_shape(self, client, admin_headers, ledger):
        resp = await client.get(CSV_URL, params=ledger.params, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/csv")
        assert (
            resp.headers["content-disposition"]
            == 'attachment; filename="extrato-2026-09-01_2026-09-30.csv"'
        )
        assert resp.content.startswith("﻿".encode())
        rows = resp.content.decode("utf-8-sig").split("\r\n")
        assert rows[0] == "cliente;email;NIF;transações;horas;valor;faturado;por faturar"
        assert rows[1] == "Bruno Costa;bruno@test.com;;3;13,00;133,00;0,00;133,00"
        assert rows[2] == "Test User;user@test.com;;4;8,00;88,00;0,00;88,00"
        assert rows[3:] == [""]

    async def test_the_filter_applies_to_the_export_too(self, client, admin_headers, ledger):
        params = {**ledger.params, "invoiced": "done"}
        resp = await client.get(CSV_URL, params=params, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.content.decode("utf-8-sig").split("\r\n") == [
            "cliente;email;NIF;transações;horas;valor;faturado;por faturar",
            "",
        ]
