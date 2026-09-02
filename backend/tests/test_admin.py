import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import Package
from app.models.user import User


class TestAdminDashboard:
    async def test_admin_dashboard_requires_admin_role(
        self, client, auth_headers, test_org, test_user
    ):
        # test_user has no membership in test_org → 403
        resp = await client.get(
            "/api/v1/admin/dashboard",
            params={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 403

    async def test_admin_dashboard_returns_stats_shape(
        self, client, admin_headers, test_org
    ):
        resp = await client.get(
            "/api/v1/admin/dashboard",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        for key in ("total_bookings", "total_revenue", "occupancy_rate", "active_users"):
            assert key in body
        assert body["total_bookings"] == 0
        assert body["total_revenue"] == 0
        assert body["active_users"] == 0


class TestAdminSpaces:
    async def test_admin_create_space(self, client, admin_headers, test_org):
        resp = await client.post(
            "/api/v1/admin/spaces",
            params={"org_id": str(test_org.id)},
            json={
                "name": "New Space",
                "description": "A nice place",
                "address": "Rua A, 1",
                "city": "Porto",
                "images": [],
                "amenities": ["wifi"],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["space"]["name"] == "New Space"
        assert body["space"]["org_id"] == str(test_org.id)


class TestAdminRooms:
    async def test_admin_create_room_in_space(
        self, client, admin_headers, test_org, test_space
    ):
        resp = await client.post(
            f"/api/v1/admin/spaces/{test_space.id}/rooms",
            params={"org_id": str(test_org.id)},
            json={
                "name": "Sala B",
                "description": "second room",
                "capacity": 2,
                "hourly_rate": "15.00",
                "color": "#ff8800",
                "amenities": [],
                "images": [],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        room = resp.json()["room"]
        assert room["name"] == "Sala B"
        assert room["space_id"] == str(test_space.id)
        assert Decimal(room["hourly_rate"]) == Decimal("15.00")


class TestAdminBookings:
    async def test_admin_list_bookings(
        self,
        client,
        admin_headers,
        db_session,
        test_org,
        test_room,
        admin_user,
    ):
        # Insert a booking directly
        start = datetime.now(tz=UTC) + timedelta(days=2)
        end = start + timedelta(hours=2)
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=admin_user.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("2.00"),
            total_amount=Decimal("22.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await db_session.commit()

        resp = await client.get(
            "/api/v1/admin/bookings",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["bookings"]) == 1
        assert body["bookings"][0]["room_id"] == str(test_room.id)

    async def test_admin_update_booking_status(
        self,
        client,
        admin_headers,
        db_session,
        test_org,
        test_room,
        admin_user,
    ):
        start = datetime.now(tz=UTC) + timedelta(days=2)
        end = start + timedelta(hours=2)
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=admin_user.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("2.00"),
            total_amount=Decimal("22.00"),
            status=BookingStatus.pending,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await db_session.commit()
        await db_session.refresh(booking)

        resp = await client.put(
            f"/api/v1/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["status"] == "confirmed"


class TestAdminPackages:
    async def test_admin_create_package(self, client, admin_headers, test_org):
        resp = await client.post(
            "/api/v1/admin/packages",
            params={"org_id": str(test_org.id)},
            json={
                "name": "10-hour pack",
                "hours": 10,
                "price": "99.00",
                "validity_days": 180,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["package"]["name"] == "10-hour pack"
        assert body["package"]["hours"] == 10
        assert body["package"]["validity_days"] == 180

    async def test_admin_update_package(self, client, admin_headers, db_session, test_org):
        package = Package(
            org_id=test_org.id,
            name="5-hour pack",
            hours=5,
            price=Decimal("50.00"),
            validity_days=90,
        )
        db_session.add(package)
        await db_session.commit()
        await db_session.refresh(package)

        resp = await client.put(
            f"/api/v1/admin/packages/{package.id}",
            params={"org_id": str(test_org.id)},
            json={"price": "45.00", "is_active": False},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()["package"]
        assert Decimal(body["price"]) == Decimal("45.00")
        assert body["is_active"] is False
        # Untouched fields survive a partial update.
        assert body["hours"] == 5
        assert body["name"] == "5-hour pack"

    async def test_admin_update_package_not_found(self, client, admin_headers, test_org):
        resp = await client.put(
            f"/api/v1/admin/packages/{uuid.uuid4()}",
            params={"org_id": str(test_org.id)},
            json={"is_active": False},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    async def test_admin_update_package_requires_admin_role(
        self, client, auth_headers, db_session, test_org
    ):
        package = Package(
            org_id=test_org.id,
            name="5-hour pack",
            hours=5,
            price=Decimal("50.00"),
            validity_days=90,
        )
        db_session.add(package)
        await db_session.commit()
        await db_session.refresh(package)

        resp = await client.put(
            f"/api/v1/admin/packages/{package.id}",
            params={"org_id": str(test_org.id)},
            json={"is_active": False},
            headers=auth_headers,
        )
        assert resp.status_code == 403


class TestAdminAvailability:
    async def test_admin_get_availability_rules(
        self, client, admin_headers, test_org, test_room
    ):
        # test_room fixture seeds Mon-Sat 08:00-20:00 (6 rules, Sunday closed).
        resp = await client.get(
            f"/api/v1/admin/rooms/{test_room.id}/availability",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        rules = resp.json()["rules"]
        assert len(rules) == 6
        assert {r["day_of_week"] for r in rules} == set(range(6))
        assert all(r["open_time"] == "08:00:00" for r in rules)

    async def test_admin_get_availability_rules_room_not_found(
        self, client, admin_headers, test_org
    ):
        resp = await client.get(
            f"/api/v1/admin/rooms/{uuid.uuid4()}/availability",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    async def test_admin_set_availability_replaces_all_rules(
        self, client, admin_headers, test_org, test_room
    ):
        resp = await client.post(
            f"/api/v1/admin/rooms/{test_room.id}/availability",
            params={"org_id": str(test_org.id)},
            json={"rules": [{"day_of_week": 0, "open_time": "09:00:00", "close_time": "18:00:00"}]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        rules = resp.json()["rules"]
        assert len(rules) == 1
        assert rules[0]["day_of_week"] == 0
        assert rules[0]["open_time"] == "09:00:00"

        # The replace-all semantics: the previously-seeded Tue-Sat rules are gone.
        follow_up = await client.get(
            f"/api/v1/admin/rooms/{test_room.id}/availability",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert len(follow_up.json()["rules"]) == 1

    async def test_admin_set_availability_requires_admin_role(
        self, client, auth_headers, test_org, test_room
    ):
        resp = await client.post(
            f"/api/v1/admin/rooms/{test_room.id}/availability",
            params={"org_id": str(test_org.id)},
            json={"rules": []},
            headers=auth_headers,
        )
        assert resp.status_code == 403


class TestAdminAccessControl:
    async def test_member_role_forbidden_on_admin_dashboard(
        self, client, db_session, test_org
    ):
        # test_member fixture grants member-role; build inline to avoid coupling.
        member = User(
            email="plain-member@test.com",
            name="Plain Member",
            password_hash=hash_password("password123"),
        )
        db_session.add(member)
        await db_session.flush()
        db_session.add(
            OrganizationMember(
                org_id=test_org.id, user_id=member.id, role=MemberRole.member
            )
        )
        await db_session.commit()
        await db_session.refresh(member)

        token = create_access_token(
            {
                "sub": str(member.id),
                "email": member.email,
                "name": member.name,
                "role": "member",
            }
        )
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(
            "/api/v1/admin/dashboard",
            params={"org_id": str(test_org.id)},
            headers=headers,
        )
        assert resp.status_code == 403
