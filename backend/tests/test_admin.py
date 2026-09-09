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

    async def test_admin_dashboard_returns_stats_shape(self, client, admin_headers, test_org):
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
    async def test_admin_create_room_in_space(self, client, admin_headers, test_org, test_space):
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
    async def test_pagination_keeps_bookings_with_equal_start_times(
        self, client, admin_headers, db_session, test_org, test_room, admin_user
    ):
        start = datetime.now(tz=UTC) + timedelta(days=2)
        ids = [uuid.UUID(int=i) for i in (2, 5, 1, 4, 3)]
        for booking_id in ids:
            db_session.add(
                Booking(
                    id=booking_id,
                    org_id=test_org.id,
                    room_id=test_room.id,
                    user_id=admin_user.id,
                    start_time=start,
                    end_time=start + timedelta(hours=1),
                    duration_hours=Decimal("1.00"),
                    total_amount=Decimal("11.00"),
                    status=BookingStatus.cancelled,
                    payment_method=PaymentMethod.hourly,
                )
            )
        await db_session.commit()

        # Cancelled bookings can legitimately share both room and start time.
        observed = []
        for page in (1, 2, 3):
            response = await client.get(
                "/api/v1/admin/bookings",
                params={"org_id": str(test_org.id), "page": page, "page_size": 2},
                headers=admin_headers,
            )
            assert response.status_code == 200, response.text
            assert response.json()["total"] == len(ids)
            observed.extend(booking["id"] for booking in response.json()["bookings"])
        assert observed == [str(booking_id) for booking_id in sorted(ids, reverse=True)]

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

    async def test_admin_list_bookings_default_pagination_matches_unpaginated_behavior(
        self,
        client,
        admin_headers,
        db_session,
        test_org,
        test_room,
        admin_user,
    ):
        """No page/page_size params → page=1, page_size=20, all bookings still returned
        when there are fewer than a page's worth (today's behavior, unchanged)."""
        start = datetime.now(tz=UTC) + timedelta(days=2)
        for i in range(3):
            booking_start = start + timedelta(hours=i * 3)
            booking = Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=admin_user.id,
                start_time=booking_start,
                end_time=booking_start + timedelta(hours=2),
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
        assert len(body["bookings"]) == 3
        assert body["total"] == 3
        assert body["page"] == 1
        assert body["page_size"] == 20

    async def test_admin_list_bookings_paginates(
        self,
        client,
        admin_headers,
        db_session,
        test_org,
        test_room,
        admin_user,
    ):
        start = datetime.now(tz=UTC) + timedelta(days=2)
        for i in range(25):
            booking_start = start + timedelta(hours=i * 3)
            booking = Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=admin_user.id,
                start_time=booking_start,
                end_time=booking_start + timedelta(hours=2),
                duration_hours=Decimal("2.00"),
                total_amount=Decimal("22.00"),
                status=BookingStatus.confirmed,
                payment_method=PaymentMethod.hourly,
            )
            db_session.add(booking)
        await db_session.commit()

        page1 = await client.get(
            "/api/v1/admin/bookings",
            params={"org_id": str(test_org.id), "page": 1, "page_size": 20},
            headers=admin_headers,
        )
        assert page1.status_code == 200, page1.text
        page1_body = page1.json()
        assert len(page1_body["bookings"]) == 20
        assert page1_body["total"] == 25
        assert page1_body["page"] == 1
        assert page1_body["page_size"] == 20

        page2 = await client.get(
            "/api/v1/admin/bookings",
            params={"org_id": str(test_org.id), "page": 2, "page_size": 20},
            headers=admin_headers,
        )
        assert page2.status_code == 200, page2.text
        page2_body = page2.json()
        assert len(page2_body["bookings"]) == 5
        assert page2_body["total"] == 25
        assert page2_body["page"] == 2

        # No overlap between the two pages.
        page1_ids = {b["id"] for b in page1_body["bookings"]}
        page2_ids = {b["id"] for b in page2_body["bookings"]}
        assert page1_ids.isdisjoint(page2_ids)

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
    async def test_admin_get_availability_rules(self, client, admin_headers, test_org, test_room):
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
    async def test_member_role_forbidden_on_admin_dashboard(self, client, db_session, test_org):
        # test_member fixture grants member-role; build inline to avoid coupling.
        member = User(
            email="plain-member@test.com",
            name="Plain Member",
            password_hash=hash_password("password123"),
        )
        db_session.add(member)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=test_org.id, user_id=member.id, role=MemberRole.member)
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
