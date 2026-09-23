"""C14 — room and space photos: upload, process, order, delete.

Uploads are attacker-controlled bytes written to disk and served back, so these
tests care about what is refused (by content, not by name), about what never
survives processing (metadata, the client's filename) and about tenancy.
"""

import io
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.config import settings
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.space import Room, Space
from app.models.user import User
from PIL import Image
from sqlalchemy import select

API = "/api/v1"
MEDIA_ROOT = Path(settings.MEDIA_ROOT)


def _image_bytes(
    fmt: str = "JPEG", size: tuple[int, int] = (800, 600), *, exif: Image.Exif | None = None
) -> bytes:
    image = Image.new("RGB", size, (61, 122, 94))
    # One corner in another colour, so orientation can be told from pixels.
    image.paste((200, 30, 30), (0, 0, size[0] // 4, size[1] // 4))
    out = io.BytesIO()
    image.save(out, format=fmt, **({"exif": exif} if exif is not None else {}))
    return out.getvalue()


def _upload(client, url, headers, org, data: bytes, filename="foto.jpg", content_type="image/jpeg"):
    return client.post(
        url,
        params={"org_id": str(org.id)},
        files={"file": (filename, data, content_type)},
        headers=headers,
    )


def _room_url(room) -> str:
    return f"{API}/admin/rooms/{room.id}/images"


def _file_for(url: str) -> Path:
    assert url.startswith(settings.MEDIA_BASE_URL + "/"), url
    return MEDIA_ROOT / url[len(settings.MEDIA_BASE_URL) + 1 :]


@pytest_asyncio.fixture
async def other_org_admin(db_session) -> tuple[Organization, dict]:
    org = Organization(name="Other Org", slug="other-org", plan=OrgPlan.starter, settings={})
    user = User(email="other-op@test.com", name="Other", password_hash=hash_password("x" * 12))
    db_session.add_all([org, user])
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=user.id, role=MemberRole.owner))
    await db_session.commit()
    token = create_access_token({"sub": str(user.id), "email": user.email, "name": user.name})
    return org, {"Authorization": f"Bearer {token}"}


class TestUpload:
    async def test_a_photo_is_processed_stored_and_returned_on_the_entity(
        self, client, admin_headers, test_org, test_room
    ):
        resp = await _upload(
            client, _room_url(test_room), admin_headers, test_org, _image_bytes(size=(3200, 2400))
        )
        assert resp.status_code == 201, resp.text
        room = resp.json()["room"]
        assert room["id"] == str(test_room.id)
        [photo] = room["photos"]
        assert set(photo) == {"id", "url", "thumb_url", "width", "height"}
        uuid.UUID(photo["id"])
        # Long edge capped at 1600, aspect kept.
        assert (photo["width"], photo["height"]) == (1600, 1200)

        with Image.open(_file_for(photo["url"])) as main:
            assert main.format == "WEBP"
            assert main.size == (1600, 1200)
        with Image.open(_file_for(photo["thumb_url"])) as thumb:
            assert thumb.format == "WEBP"
            assert max(thumb.size) == 480

    async def test_the_clients_filename_never_reaches_the_disk_or_the_url(
        self, client, admin_headers, test_org, test_room
    ):
        resp = await _upload(
            client, _room_url(test_room), admin_headers, test_org, _image_bytes(),
            filename="../../etc/cron.d/evil.jpg",
        )  # fmt: skip
        assert resp.status_code == 201, resp.text
        [photo] = resp.json()["room"]["photos"]
        assert "evil" not in photo["url"] and ".." not in photo["url"]
        assert _file_for(photo["url"]).resolve().is_relative_to(MEDIA_ROOT.resolve())
        assert not any("evil" in p.name for p in MEDIA_ROOT.rglob("*"))

    @pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
    async def test_jpeg_png_and_webp_are_accepted_whatever_the_name_says(
        self, client, admin_headers, test_org, test_room, fmt
    ):
        resp = await _upload(
            client, _room_url(test_room), admin_headers, test_org, _image_bytes(fmt),
            filename="no-extension", content_type="application/octet-stream",
        )  # fmt: skip
        assert resp.status_code == 201, resp.text

    @pytest.mark.parametrize(
        "data",
        [
            b"<?php system($_GET['c']); ?>",
            b"%PDF-1.7 not an image",
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
            b"",
        ],
    )
    async def test_anything_that_is_not_really_an_image_is_415_even_named_jpg(
        self, client, admin_headers, test_org, test_room, data
    ):
        resp = await _upload(client, _room_url(test_room), admin_headers, test_org, data)
        assert resp.status_code == 415, resp.text
        assert not list(MEDIA_ROOT.rglob(f"*{test_room.id}*/*"))

    async def test_a_real_image_in_an_unsupported_format_is_415(
        self, client, admin_headers, test_org, test_room
    ):
        resp = await _upload(
            client, _room_url(test_room), admin_headers, test_org, _image_bytes("GIF")
        )
        assert resp.status_code == 415, resp.text

    async def test_more_than_8_mb_is_413(self, client, admin_headers, test_org, test_room):
        too_big = _image_bytes() + b"\0" * (8 * 1024 * 1024)
        resp = await _upload(client, _room_url(test_room), admin_headers, test_org, too_big)
        assert resp.status_code == 413, resp.text

    async def test_the_eleventh_photo_is_409(
        self, client, admin_headers, test_org, test_room, db_session
    ):
        small = _image_bytes(size=(40, 30))
        for _ in range(10):
            ok = await _upload(client, _room_url(test_room), admin_headers, test_org, small)
            assert ok.status_code == 201, ok.text
        resp = await _upload(client, _room_url(test_room), admin_headers, test_org, small)
        assert resp.status_code == 409, resp.text
        stored = await db_session.scalar(select(Room.photos).where(Room.id == test_room.id))
        assert len(stored) == 10

    async def test_metadata_is_stripped(self, client, admin_headers, test_org, test_room):
        exif = Image.Exif()
        exif[0x010F] = "SecretCameraMaker"  # Make
        exif[0x8825] = {1: "N", 2: (38.0, 45.0, 20.6)}  # GPS IFD: where the photo was taken
        resp = await _upload(
            client, _room_url(test_room), admin_headers, test_org, _image_bytes(exif=exif)
        )
        assert resp.status_code == 201, resp.text
        [photo] = resp.json()["room"]["photos"]
        for url in (photo["url"], photo["thumb_url"]):
            raw = _file_for(url).read_bytes()
            assert b"SecretCameraMaker" not in raw
            with Image.open(io.BytesIO(raw)) as stored:
                assert not dict(stored.getexif())
                assert "exif" not in stored.info and "icc_profile" not in stored.info

    async def test_exif_orientation_is_applied_before_it_is_stripped(
        self, client, admin_headers, test_org, test_room
    ):
        exif = Image.Exif()
        exif[0x0112] = 6  # "rotate 90° clockwise to display": a phone held upright
        resp = await _upload(
            client, _room_url(test_room), admin_headers, test_org,
            _image_bytes(size=(800, 600), exif=exif),
        )  # fmt: skip
        assert resp.status_code == 201, resp.text
        [photo] = resp.json()["room"]["photos"]
        # Landscape pixels, portrait picture.
        assert (photo["width"], photo["height"]) == (600, 800)
        with Image.open(_file_for(photo["url"])) as stored:
            assert stored.size == (600, 800)
            # The marked corner was top-left; turned clockwise it is top-right.
            r, g, _b = stored.convert("RGB").getpixel((590, 10))
            assert r > 150 and g < 90

    async def test_spaces_take_photos_too(self, client, admin_headers, test_org, test_space):
        resp = await _upload(
            client, f"{API}/admin/spaces/{test_space.id}/images", admin_headers, test_org,
            _image_bytes(),
        )  # fmt: skip
        assert resp.status_code == 201, resp.text
        space = resp.json()["space"]
        assert space["id"] == str(test_space.id)
        assert len(space["photos"]) == 1

    async def test_the_public_api_shows_the_photos_and_serves_the_files(
        self, client, admin_headers, test_org, test_space, test_room
    ):
        await _upload(client, _room_url(test_room), admin_headers, test_org, _image_bytes())
        detail = (await client.get(f"{API}/spaces/{test_space.id}")).json()
        [photo] = detail["rooms"][0]["photos"]
        # `images` is the older, separate field and is left exactly as it was.
        assert detail["rooms"][0]["images"] == []

        path = photo["thumb_url"][len(settings.MEDIA_BASE_URL) - len("/media") :]
        served = await client.get(path)
        assert served.status_code == 200, served.text
        assert served.headers["content-type"] == "image/webp"
        # Read-only: the mount serves files, nothing else.
        assert (await client.put(path, content=b"x")).status_code == 405
        assert (await client.get("/media/../app/config.py")).status_code == 404


class TestTenancy:
    async def test_another_orgs_admin_gets_403_or_404_and_learns_nothing(
        self, client, other_org_admin, test_org, test_room
    ):
        other_org, headers = other_org_admin
        # Claiming our org: they are not an admin of it.
        claimed = await _upload(client, _room_url(test_room), headers, test_org, _image_bytes())
        assert claimed.status_code == 403, claimed.text
        # In their own org: our room is simply not there — the same answer an
        # id that does not exist gets, so nothing about our org leaks.
        own = await _upload(client, _room_url(test_room), headers, other_org, _image_bytes())
        missing = await _upload(
            client, f"{API}/admin/rooms/{uuid.uuid4()}/images", headers, other_org, _image_bytes()
        )
        assert own.status_code == missing.status_code == 404
        assert own.json() == missing.json()
        assert not list(MEDIA_ROOT.rglob(f"*{test_room.id}*/*"))

    async def test_a_member_cannot_upload(
        self, client, auth_headers, test_member, test_org, test_room
    ):
        resp = await _upload(client, _room_url(test_room), auth_headers, test_org, _image_bytes())
        assert resp.status_code == 403, resp.text

    async def test_anonymous_cannot_upload(self, client, test_org, test_room):
        resp = await _upload(client, _room_url(test_room), {}, test_org, _image_bytes())
        assert resp.status_code == 401, resp.text

    async def test_another_orgs_admin_cannot_delete_or_reorder_our_photos(
        self, client, admin_headers, other_org_admin, test_org, test_room
    ):
        other_org, headers = other_org_admin
        up = await _upload(client, _room_url(test_room), admin_headers, test_org, _image_bytes())
        [photo] = up.json()["room"]["photos"]
        for org, expected in ((test_org, 403), (other_org, 404)):
            params = {"org_id": str(org.id)}
            gone = await client.delete(
                f"{_room_url(test_room)}/{photo['id']}", params=params, headers=headers
            )
            moved = await client.put(
                f"{_room_url(test_room)}/order",
                params=params,
                json={"order": [photo["id"]]},
                headers=headers,
            )
            assert (gone.status_code, moved.status_code) == (expected, expected)
        assert _file_for(photo["url"]).exists()


class TestOrderAndDelete:
    async def _three(self, client, headers, org, room) -> list[dict]:
        photos: list[dict] = []
        for _ in range(3):
            resp = await _upload(client, _room_url(room), headers, org, _image_bytes(size=(40, 30)))
            photos = resp.json()["room"]["photos"]
        return photos

    async def test_reorder_takes_the_full_list_and_the_first_is_the_cover(
        self, client, admin_headers, test_org, test_room
    ):
        a, b, c = await self._three(client, admin_headers, test_org, test_room)
        resp = await client.put(
            f"{_room_url(test_room)}/order",
            params={"org_id": str(test_org.id)},
            json={"order": [c["id"], a["id"], b["id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert [p["id"] for p in resp.json()["room"]["photos"]] == [c["id"], a["id"], b["id"]]

    @pytest.mark.parametrize("mangle", ["missing", "unknown", "duplicate"])
    async def test_reorder_refuses_anything_but_a_permutation(
        self, client, admin_headers, test_org, test_room, mangle
    ):
        a, b, _c = await self._three(client, admin_headers, test_org, test_room)
        order = {
            "missing": [a["id"], b["id"]],
            "unknown": [a["id"], b["id"], str(uuid.uuid4())],
            "duplicate": [a["id"], a["id"], b["id"]],
        }[mangle]
        resp = await client.put(
            f"{_room_url(test_room)}/order",
            params={"org_id": str(test_org.id)},
            json={"order": order},
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text

    async def test_delete_removes_the_entry_and_both_files(
        self, client, admin_headers, test_org, test_room
    ):
        a, b, c = await self._three(client, admin_headers, test_org, test_room)
        resp = await client.delete(
            f"{_room_url(test_room)}/{b['id']}",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert [p["id"] for p in resp.json()["room"]["photos"]] == [a["id"], c["id"]]
        assert not _file_for(b["url"]).exists() and not _file_for(b["thumb_url"]).exists()
        assert _file_for(a["url"]).exists() and _file_for(c["thumb_url"]).exists()

        again = await client.delete(
            f"{_room_url(test_room)}/{b['id']}",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert again.status_code == 404, again.text

    async def test_a_photo_backfilled_from_an_old_external_url_can_be_removed(
        self, client, admin_headers, test_org, test_space, db_session
    ):
        external = {
            "id": str(uuid.uuid4()),
            "url": "https://images.example.com/sala.jpg",
            "thumb_url": "https://images.example.com/sala.jpg",
            "width": None,
            "height": None,
        }
        space = await db_session.get(Space, test_space.id)
        space.photos = [external]
        await db_session.commit()

        shown = (await client.get(f"{API}/spaces/{test_space.id}")).json()["space"]["photos"]
        assert shown == [external]
        resp = await client.delete(
            f"{API}/admin/spaces/{test_space.id}/images/{external['id']}",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["space"]["photos"] == []


class TestUploadRateLimit:
    async def test_uploads_are_throttled_by_the_existing_limiter(
        self, client, admin_headers, test_org, test_room, monkeypatch
    ):
        monkeypatch.setattr(settings, "RATE_LIMIT_UPLOAD_MAX_REQUESTS", 2)
        small = _image_bytes(size=(40, 30))
        codes = []
        for _ in range(3):
            resp = await _upload(client, _room_url(test_room), admin_headers, test_org, small)
            codes.append(resp.status_code)
        assert codes == [201, 201, 429]


class TestStorageSeam:
    def test_an_unimplemented_backend_fails_loudly_instead_of_falling_back(self, monkeypatch):
        from app import media

        monkeypatch.setattr(settings, "MEDIA_STORAGE", "s3")
        with pytest.raises(RuntimeError, match="not implemented"):
            media.build_media_storage()


class TestSeededPhotos:
    """The demo rooms get the four room illustrations (V01), so the mosaic and
    the carousel have data locally, through the same storage as uploads."""

    async def test_each_demo_room_gets_the_four_illustrations_in_order(self, db_session):
        from app.seed import SEED_PHOTO_NAMES, seed_demo_data, seed_photos_dir

        await seed_demo_data(db_session)
        await db_session.commit()
        rooms = (await db_session.execute(select(Room))).scalars().all()
        assert len(rooms) == 3
        source = seed_photos_dir()
        for room in rooms:
            assert [p["seed"] for p in room.photos] == list(SEED_PHOTO_NAMES)
            for photo in room.photos:
                # Stored like any upload: keys, real files, the public shape's
                # fields, plus the seed's own mark.
                assert set(photo) == {"id", "key", "thumb_key", "width", "height", "seed"}
                assert (photo["width"], photo["height"]) == (1600, 1200)
                # The very bytes the marketing site ships, main and thumbnail.
                assert (MEDIA_ROOT / photo["key"]).read_bytes() == (
                    source / f"{photo['seed']}.webp"
                ).read_bytes()
                assert (MEDIA_ROOT / photo["thumb_key"]).read_bytes() == (
                    source / f"{photo['seed']}-thumb.webp"
                ).read_bytes()
                with Image.open(MEDIA_ROOT / photo["key"]) as stored:
                    assert stored.format == "WEBP"
        # Each room has its own files: deleting one room's photos cannot blank another's.
        keys = [p["key"] for room in rooms for p in room.photos]
        assert len(set(keys)) == 12

    async def test_the_public_shape_carries_no_seed_mark(self, client, db_session):
        from app.seed import seed_demo_data

        await seed_demo_data(db_session)
        await db_session.commit()
        spaces = (await client.get("/api/v1/spaces")).json()["spaces"]
        detail = (await client.get(f"/api/v1/spaces/{spaces[0]['id']}")).json()
        for room in detail["rooms"]:
            assert len(room["photos"]) == 4
            assert all(
                set(p) == {"id", "url", "thumb_url", "width", "height"} for p in room["photos"]
            )

    async def test_reseeding_replaces_its_own_photos_and_keeps_an_operators(self, db_session):
        from app.seed import seed_demo_data

        await seed_demo_data(db_session)
        await db_session.commit()
        room = (await db_session.execute(select(Room).order_by(Room.name))).scalars().first()
        # The operator uploaded one of their own and dropped two of the seed's
        # (through the API those two files would be deleted too; here only the
        # rows go, so only the two the seed still finds are its to clean up).
        replaced = [room.photos[0]["key"], room.photos[3]["key"]]
        own = {"id": "op-1", "key": "rooms/x/op.webp", "thumb_key": "rooms/x/op_thumb.webp",
               "width": 800, "height": 600}  # fmt: skip
        room.photos = [own, room.photos[0], room.photos[3]]
        await db_session.commit()

        await seed_demo_data(db_session)
        await db_session.commit()
        await db_session.refresh(room)
        # Theirs first and untouched; then the four illustrations again — no
        # duplicates, and the files the earlier seed wrote are gone.
        assert room.photos[0] == own
        assert [p["seed"] for p in room.photos[1:]] == ["sala-01", "sala-02", "sala-03", "sala-04"]
        assert len(room.photos) == 5
        for key in replaced:
            assert not (MEDIA_ROOT / key).exists()
        for p in room.photos[1:]:
            assert (MEDIA_ROOT / p["key"]).exists()
        counts = (await db_session.execute(select(Room.photos))).scalars().all()
        assert sorted(len(c) for c in counts) == [4, 4, 5]

    async def test_the_gradients_an_earlier_seed_generated_are_replaced_too(self, db_session):
        """A database seeded before V01 holds C16's unmarked 960x720 gradients:
        they are the seed's, not an operator's, and go the same way."""
        from app.seed import seed_demo_data

        await seed_demo_data(db_session)
        await db_session.commit()
        room = (await db_session.execute(select(Room).order_by(Room.name))).scalars().first()
        legacy = []
        for i in range(3):
            key = f"rooms/{room.id}/legacy{i}.webp"
            (MEDIA_ROOT / key).parent.mkdir(parents=True, exist_ok=True)
            (MEDIA_ROOT / key).write_bytes(b"x")
            (MEDIA_ROOT / key.replace(".webp", "_thumb.webp")).write_bytes(b"x")
            thumb_key = key.replace(".webp", "_thumb.webp")
            legacy.append(
                {"id": f"l{i}", "key": key, "thumb_key": thumb_key, "width": 960, "height": 720}
            )
        room.photos = legacy
        await db_session.commit()

        await seed_demo_data(db_session)
        await db_session.commit()
        await db_session.refresh(room)
        assert [p["seed"] for p in room.photos] == ["sala-01", "sala-02", "sala-03", "sala-04"]
        assert not any((MEDIA_ROOT / p["key"]).exists() for p in legacy)

    async def test_a_second_seed_with_nothing_to_do_rewrites_nothing(self, db_session):
        from app.seed import seed_demo_data

        await seed_demo_data(db_session)
        await db_session.commit()
        keys = sorted(
            p["key"]
            for photos in (await db_session.execute(select(Room.photos))).scalars()
            for p in photos
        )
        await seed_demo_data(db_session)
        await db_session.commit()
        again = sorted(
            p["key"]
            for photos in (await db_session.execute(select(Room.photos))).scalars()
            for p in photos
        )
        assert again == keys

    async def test_a_missing_illustration_fails_loudly(self, db_session, monkeypatch, tmp_path):
        from app.seed import seed_demo_data

        monkeypatch.setattr(settings, "SEED_PHOTOS_DIR", str(tmp_path))
        with pytest.raises(FileNotFoundError, match="SEED_PHOTOS_DIR"):
            await seed_demo_data(db_session)

    def test_the_gradient_generator_is_gone(self):
        import app.seed as seed

        assert not hasattr(seed, "_placeholder_png")
        assert not hasattr(seed, "PLACEHOLDER_PHOTOS_PER_ROOM")
