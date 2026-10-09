"""I04: the customer's billing details (NIF, billing name, address).

The NIF validator is a table; the routes prove who may read and write whose
details, that the operator's edit is audited, and that the statement and
its CSV carry the NIF.
"""

import uuid

import pytest
from app import nif
from app.models.audit import AdminAction
from sqlalchemy import select

API = "/api/v1"
MY_BILLING = f"{API}/auth/me/billing"

VALID = "123456789"
VALID_COMPANY = "501234560"
VALID_ALL_NINES = "999999990"


class TestNif:
    @pytest.mark.parametrize("value", [VALID, VALID_COMPANY, VALID_ALL_NINES])
    def test_a_correct_check_digit_passes(self, value):
        assert nif.is_valid(value)
        assert nif.validate(value) == value

    @pytest.mark.parametrize(
        "value",
        [
            "123456780",  # wrong check digit
            "12345678",  # eight digits
            "1234567890",  # ten digits
            "12345678a",  # not all digits
            "023456787",  # leading zero (the digits otherwise check out)
            "PT123456789",
        ],
    )
    def test_anything_else_is_refused(self, value):
        assert not nif.is_valid(value)
        with pytest.raises(ValueError, match="NIF inválido"):
            nif.validate(value)

    def test_spaces_are_tolerated_and_blank_means_none(self):
        assert nif.validate(" 123 456 789 ") == VALID
        assert nif.validate("") is None
        assert nif.validate("   ") is None
        assert nif.validate(None) is None


class TestMyBillingDetails:
    async def test_empty_until_set_then_read_back(self, client, auth_headers):
        resp = await client.get(MY_BILLING, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "billing": {"tax_id": None, "billing_name": None, "billing_address": None}
        }

        resp = await client.put(
            MY_BILLING,
            json={
                "tax_id": " 123 456 789",
                "billing_name": "  Ana Silva, Lda.  ",
                "billing_address": "Rua das Flores 1\n1200-001 Lisboa",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["billing"] == {
            "tax_id": VALID,
            "billing_name": "Ana Silva, Lda.",
            "billing_address": "Rua das Flores 1\n1200-001 Lisboa",
        }
        resp = await client.get(MY_BILLING, headers=auth_headers)
        assert resp.json()["billing"]["tax_id"] == VALID

    async def test_blank_clears_and_a_bad_nif_changes_nothing(self, client, auth_headers):
        await client.put(
            MY_BILLING,
            json={"tax_id": VALID, "billing_name": "Ana", "billing_address": "Rua 1"},
            headers=auth_headers,
        )
        resp = await client.put(
            MY_BILLING,
            json={"tax_id": "123456780", "billing_name": "", "billing_address": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "NIF inválido" in resp.text
        resp = await client.get(MY_BILLING, headers=auth_headers)
        assert resp.json()["billing"]["tax_id"] == VALID

        resp = await client.put(
            MY_BILLING,
            json={"tax_id": "", "billing_name": "", "billing_address": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["billing"] == {
            "tax_id": None,
            "billing_name": None,
            "billing_address": None,
        }

    async def test_requires_a_token(self, client):
        assert (await client.get(MY_BILLING)).status_code == 401
        assert (await client.put(MY_BILLING, json={"tax_id": VALID})).status_code == 401

    async def test_each_customer_sees_only_their_own(self, client, auth_headers, ledger):
        # The route has no user id to reach for: another customer's details
        # are simply not addressable. `ledger.bruno` has none; `ana` sets hers.
        await client.put(MY_BILLING, json={"tax_id": VALID}, headers=auth_headers)
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
        resp = await client.get(MY_BILLING, headers=bruno)
        assert resp.json()["billing"]["tax_id"] is None


class TestOperatorEdit:
    async def test_the_operator_sets_a_customers_nif_and_it_is_audited(
        self, client, admin_headers, admin_user, test_org, test_user, test_member, db_session
    ):
        url = f"{API}/admin/users/{test_user.id}"
        resp = await client.put(
            url,
            params={"org_id": str(test_org.id)},
            json={"tax_id": VALID_COMPANY, "billing_name": "Clínica X", "billing_address": "R. 2"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        user = resp.json()["user"]
        assert (user["tax_id"], user["billing_name"], user["billing_address"]) == (
            VALID_COMPANY,
            "Clínica X",
            "R. 2",
        )
        resp = await client.get(url, params={"org_id": str(test_org.id)}, headers=admin_headers)
        assert resp.json()["user"]["tax_id"] == VALID_COMPANY

        row = await db_session.scalar(
            select(AdminAction).where(
                AdminAction.entity_id == test_user.id, AdminAction.action == "update"
            )
        )
        assert row is not None
        assert row.actor_user_id == admin_user.id
        assert row.after["tax_id"] == VALID_COMPANY
        assert row.before["tax_id"] is None

    async def test_an_invalid_nif_is_refused(
        self, client, admin_headers, test_org, test_user, test_member
    ):
        resp = await client.put(
            f"{API}/admin/users/{test_user.id}",
            params={"org_id": str(test_org.id)},
            json={"tax_id": "123456780"},
            headers=admin_headers,
        )
        assert resp.status_code == 422, resp.text

    async def test_a_member_cannot_edit_anyone(
        self, client, auth_headers, test_org, test_member, ledger
    ):
        resp = await client.put(
            f"{API}/admin/users/{ledger.bruno.id}",
            params={"org_id": str(test_org.id)},
            json={"tax_id": VALID},
            headers=auth_headers,
        )
        assert resp.status_code == 403

    async def test_a_user_outside_the_org_is_404(self, client, admin_headers, test_org):
        resp = await client.put(
            f"{API}/admin/users/{uuid.uuid4()}",
            params={"org_id": str(test_org.id)},
            json={"tax_id": VALID},
            headers=admin_headers,
        )
        assert resp.status_code == 404


class TestOnTheStatement:
    async def test_the_nif_and_billing_name_reach_the_lines_and_the_csv(
        self, client, admin_headers, auth_headers, ledger
    ):
        await client.put(
            MY_BILLING,
            json={"tax_id": VALID, "billing_name": "Ana Silva, Lda.", "billing_address": "R. 1"},
            headers=auth_headers,
        )
        resp = await client.get(
            f"{API}/admin/billing/statement", params=ledger.params, headers=admin_headers
        )
        ana = resp.json()["statement"]["lines"][1]
        assert ana["user"] == {
            "id": str(ledger.ana.id),
            "name": "Test User",
            "email": "user@test.com",
            "tax_id": VALID,
            "billing_name": "Ana Silva, Lda.",
            "billing_address": "R. 1",
        }
        resp = await client.get(
            f"{API}/admin/billing/statement.csv", params=ledger.params, headers=admin_headers
        )
        rows = resp.content.decode("utf-8-sig").split("\r\n")
        assert rows[2] == "Ana Silva, Lda.;user@test.com;123456789;4;8,00;88,00;0,00;88,00"
