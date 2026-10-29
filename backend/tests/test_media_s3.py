"""E18 — photos and private PDFs in S3: `app.media.S3MediaStorage` against an
in-process S3 (moto), and the configuration that selects it.

No bucket, no credentials, no network: moto answers every boto3 call in the
process. What is proved here is the storage's contract (keys, content types,
cache headers, the OSError family on failure) and that the upload routes and
the invoice PDF route work unchanged on top of it. CloudFront in front of
the bucket is Terraform's (infra/prod/media.tf) and is not simulated.
"""

import asyncio
import io
import uuid

import boto3
import pytest
from app import media
from app.config import Settings, settings
from app.media import (
    PRIVATE_CACHE_CONTROL,
    PUBLIC_CACHE_CONTROL,
    MediaNotConfiguredError,
    S3MediaStorage,
    get_media_storage,
    invoice_pdf_key,
)
from app.models.invoice import Invoice
from app.routers.invoices import pdf_response
from fastapi import HTTPException
from moto import mock_aws
from PIL import Image

API = "/api/v1"
BUCKET = "spacerental-media-test"
REGION = "eu-west-1"
BASE_URL = "https://media.test"


@pytest.fixture
def s3(monkeypatch):
    """A fresh in-process bucket for each test; boto3 sees fake credentials."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        yield client


@pytest.fixture
def storage(s3) -> S3MediaStorage:
    return S3MediaStorage(BUCKET, prefix="media/", region=REGION)


def _keys(s3) -> list[str]:
    listing = s3.list_objects_v2(Bucket=BUCKET)
    return sorted(o["Key"] for o in listing.get("Contents", []))


def _head(s3, key: str) -> dict:
    return s3.head_object(Bucket=BUCKET, Key=key)


class TestS3MediaStorage:
    async def test_a_public_photo_lands_under_the_prefix_as_immutable_webp(self, s3, storage):
        await storage.save("rooms/abc/def.webp", b"RIFF-webp-bytes")
        assert _keys(s3) == ["media/rooms/abc/def.webp"]
        head = _head(s3, "media/rooms/abc/def.webp")
        assert head["ContentType"] == "image/webp"
        assert head["CacheControl"] == PUBLIC_CACHE_CONTROL

    async def test_a_private_pdf_is_never_cacheable(self, s3, storage):
        key = invoice_pdf_key(uuid.uuid4(), uuid.uuid4())
        await storage.save(key, b"%PDF-1.4\n%%EOF\n")
        head = _head(s3, f"media/{key}")
        assert head["ContentType"] == "application/pdf"
        assert head["CacheControl"] == PRIVATE_CACHE_CONTROL

    async def test_read_returns_what_was_saved(self, storage):
        await storage.save("spaces/x/y.webp", b"\x00\x01\x02")
        assert await storage.read("spaces/x/y.webp") == b"\x00\x01\x02"

    async def test_a_missing_key_is_a_file_not_found_error(self, storage):
        with pytest.raises(FileNotFoundError):
            await storage.read("private/invoices/nope.pdf")

    async def test_delete_removes_the_object_and_is_idempotent(self, s3, storage):
        await storage.save("rooms/a/b.webp", b"x")
        await storage.delete("rooms/a/b.webp")
        assert _keys(s3) == []
        await storage.delete("rooms/a/b.webp")

    async def test_an_empty_prefix_and_an_odd_one_are_normalised(self, s3):
        bare = S3MediaStorage(BUCKET, prefix="", region=REGION)
        await bare.save("rooms/a/b.webp", b"x")
        nested = S3MediaStorage(BUCKET, prefix="/photos/v2/", region=REGION)
        await nested.save("rooms/a/b.webp", b"y")
        assert _keys(s3) == ["photos/v2/rooms/a/b.webp", "rooms/a/b.webp"]

    @pytest.mark.parametrize("key", ["/etc/passwd", "../x.webp", "rooms/../../x.webp", "a//b"])
    async def test_a_key_that_escapes_the_prefix_is_refused_before_any_call(self, storage, key):
        with pytest.raises(ValueError):
            await storage.save(key, b"x")

    async def test_other_s3_failures_are_os_errors(self, s3):
        """The routes handle storage failure as OSError (CLAUDE.md §10.3: the
        SDK's own exception types never leak out of app/media.py)."""
        elsewhere = S3MediaStorage("no-such-bucket-" + uuid.uuid4().hex, region=REGION)
        with pytest.raises(OSError):
            await elsewhere.save("rooms/a/b.webp", b"x")

    async def test_the_blocking_sdk_runs_off_the_event_loop(self, storage):
        """Ten concurrent saves finish together, not one after another."""
        await asyncio.gather(*(storage.save(f"rooms/a/{i}.webp", b"x") for i in range(10)))
        assert len({await storage.read(f"rooms/a/{i}.webp") for i in range(10)}) == 1


class TestConfiguration:
    def test_s3_without_a_bucket_stops_the_app(self, monkeypatch):
        monkeypatch.setattr(settings, "MEDIA_STORAGE", "s3")
        monkeypatch.setattr(settings, "MEDIA_S3_BUCKET", None)
        with pytest.raises(MediaNotConfiguredError, match="MEDIA_S3_BUCKET"):
            media.build_media_storage()

    def test_s3_with_the_derived_media_url_stops_the_app(self, monkeypatch):
        """The derived default points at the API's /media, which s3 mode does
        not mount: silently serving 404s is exactly the fallback we refuse."""
        monkeypatch.setattr(settings, "MEDIA_STORAGE", "s3")
        monkeypatch.setattr(settings, "MEDIA_S3_BUCKET", BUCKET)
        monkeypatch.setattr(settings, "MEDIA_BASE_URL", "")
        with pytest.raises(MediaNotConfiguredError, match="MEDIA_BASE_URL"):
            media.validate_media_settings()

    def test_s3_mode_derives_no_media_url(self):
        """Local mode derives <FRONTEND_URL>/backend/media (D20); s3 mode
        must not, or a forgotten MEDIA_BASE_URL would point at nothing."""
        assert Settings(MEDIA_STORAGE="local").MEDIA_BASE_URL.endswith("/backend/media")
        assert Settings(MEDIA_STORAGE="s3", MEDIA_S3_BUCKET=BUCKET).MEDIA_BASE_URL == ""
        assert Settings(MEDIA_STORAGE="s3", MEDIA_BASE_URL=BASE_URL).MEDIA_BASE_URL == BASE_URL

    def test_s3_fully_configured_builds_the_s3_storage(self, s3, monkeypatch):
        monkeypatch.setattr(settings, "MEDIA_STORAGE", "s3")
        monkeypatch.setattr(settings, "MEDIA_S3_BUCKET", BUCKET)
        monkeypatch.setattr(settings, "MEDIA_S3_PREFIX", "media/")
        monkeypatch.setattr(settings, "MEDIA_BASE_URL", BASE_URL)
        monkeypatch.setattr(settings, "AWS_REGION", REGION)
        built = media.build_media_storage()
        assert isinstance(built, S3MediaStorage)
        assert (built.bucket, built.prefix) == (BUCKET, "media/")

    def test_an_unknown_storage_fails_loudly_instead_of_falling_back(self, monkeypatch):
        monkeypatch.setattr(settings, "MEDIA_STORAGE", "r2")
        with pytest.raises(MediaNotConfiguredError, match="not implemented"):
            media.build_media_storage()

    def test_production_lists_the_s3_problems_with_the_rest(self):
        from app.config import production_problems

        current = Settings(
            APP_ENV="production",
            SECRET_KEY="x" * 40,
            FRONTEND_URL="https://app.example",
            CORS_ORIGINS="https://app.example",
            STRIPE_MODE="stub",
            EMAIL_MODE="stub",
            DATABASE_URL="postgresql+asyncpg://u:p@db.example:5432/d",
            MEDIA_STORAGE="s3",
        )
        problems = production_problems(current)
        assert any("MEDIA_S3_BUCKET" in p for p in problems)
        assert any("MEDIA_BASE_URL" in p for p in problems)
        assert not any("MEDIA_ROOT" in p for p in problems)


def _jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (640, 480), (61, 122, 94)).save(out, format="JPEG")
    return out.getvalue()


@pytest.fixture
def api_on_s3(s3, storage, monkeypatch):
    """The real routes, the real database, the storage swapped for S3."""
    from app.main import app

    monkeypatch.setattr(settings, "MEDIA_BASE_URL", BASE_URL)
    app.dependency_overrides[get_media_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_media_storage, None)


class TestRoutesOnS3:
    async def test_upload_delete_and_the_public_url_through_the_routes(
        self, client, admin_headers, test_org, test_room, s3, api_on_s3
    ):
        resp = await client.post(
            f"{API}/admin/rooms/{test_room.id}/images",
            params={"org_id": str(test_org.id)},
            files={"file": ("foto.jpg", _jpeg(), "image/jpeg")},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        photo = resp.json()["room"]["photos"][0]
        assert photo["url"].startswith(f"{BASE_URL}/rooms/{test_room.id}/")
        assert photo["thumb_url"].endswith("_thumb.webp")
        # The URL's path is the key under the prefix: CloudFront's origin
        # path (infra/prod/media.tf) is what joins the two.
        key = photo["url"][len(BASE_URL) + 1 :]
        assert _keys(s3) == sorted([f"media/{key}", f"media/{key[:-5]}_thumb.webp"])
        assert _head(s3, f"media/{key}")["ContentType"] == "image/webp"

        resp = await client.delete(
            f"{API}/admin/rooms/{test_room.id}/images/{photo['id']}",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["room"]["photos"] == []
        assert _keys(s3) == []

    async def test_a_private_pdf_is_streamed_by_the_api_from_the_bucket(self, storage):
        invoice = Invoice(
            id=uuid.uuid4(),
            org_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            number="FT 2026/7",
            pdf_key=invoice_pdf_key(uuid.uuid4(), uuid.uuid4()),
        )
        await storage.save(invoice.pdf_key, b"%PDF-1.4\n%%EOF\n")
        response = await pdf_response(storage, invoice)
        assert response.media_type == "application/pdf"
        assert response.body == b"%PDF-1.4\n%%EOF\n"
        assert response.headers["cache-control"] == "private, no-store"
        await storage.delete(invoice.pdf_key)
        with pytest.raises(HTTPException) as gone:
            await pdf_response(storage, invoice)
        assert gone.value.status_code == 404
