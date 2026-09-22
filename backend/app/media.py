"""Uploaded photos: validate, process, store (C14).

Same shape as `app.payments`, `app.email` and `app.locks`: a small gateway
interface, a local implementation that needs no account, and an explicit
`MEDIA_STORAGE` switch that fails loudly for anything not built yet. Nothing
else in the codebase touches the filesystem or, later, a cloud SDK.

Uploads are attacker-controlled bytes that get written to disk and served back
to every visitor, so nothing of the original file survives: it is decoded,
re-encoded as WebP, and named by us.
"""

import io
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PHOTOS_PER_ENTITY = 10
MAX_LONG_EDGE = 1600
THUMB_LONG_EDGE = 480
WEBP_QUALITY = 82
# What Pillow actually decoded — never the filename or the Content-Type header,
# both of which are whatever the client says they are.
ACCEPTED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
# A decompression-bomb bound: 8 MB of PNG can declare far more pixels than any
# room photo has. 50 MP is beyond every phone camera we would plausibly see.
MAX_PIXELS = 50_000_000


class UnsupportedImageError(Exception):
    """Not a JPEG, PNG or WebP image (judged by content)."""


class ImageTooLargeError(Exception):
    """More bytes or more pixels than we accept."""


@dataclass(frozen=True)
class ProcessedImage:
    main: bytes
    thumb: bytes
    width: int
    height: int


def _encode(image: Image.Image) -> bytes:
    out = io.BytesIO()
    # `exif`/`icc_profile` are passed explicitly so nothing in `image.info`
    # can ride along: camera model, GPS position, editing software, profile.
    image.save(out, format="WEBP", quality=WEBP_QUALITY, method=4, exif=b"", icc_profile=None)
    return out.getvalue()


def process_image(data: bytes) -> ProcessedImage:
    """Decode, orient, strip, resize and re-encode. CPU-bound: call in a thread."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageTooLargeError
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ACCEPTED_FORMATS:
                raise UnsupportedImageError
            if probe.width * probe.height > MAX_PIXELS:
                raise ImageTooLargeError
            probe.verify()
        # `verify()` leaves the object unusable; decode for real from the start.
        with Image.open(io.BytesIO(data)) as source:
            # Orientation lives in the metadata about to be dropped, so apply
            # it to the pixels first or every phone photo ends up sideways.
            image = ImageOps.exif_transpose(source)
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        if isinstance(exc, Image.DecompressionBombError):
            raise ImageTooLargeError from exc
        raise UnsupportedImageError from exc

    image.info.clear()
    image.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE), Image.Resampling.LANCZOS)
    thumb = image.copy()
    thumb.thumbnail((THUMB_LONG_EDGE, THUMB_LONG_EDGE), Image.Resampling.LANCZOS)
    return ProcessedImage(
        main=_encode(image), thumb=_encode(thumb), width=image.width, height=image.height
    )


def new_photo_keys(kind: str, entity_id: uuid.UUID) -> tuple[str, str, str]:
    """(photo id, main key, thumbnail key). Random names: never the client's."""
    photo_id = uuid.uuid4()
    base = f"{kind}/{entity_id}/{photo_id.hex}"
    return str(photo_id), f"{base}.webp", f"{base}_thumb.webp"


def public_url(key: str) -> str:
    return f"{settings.MEDIA_BASE_URL.rstrip('/')}/{key}"


class MediaStorage(ABC):
    """Where processed photos live. Keys are relative paths we generate."""

    @abstractmethod
    async def save(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Remove `key`; a key that is already gone is not an error."""


class LocalMediaStorage(MediaStorage):
    """Files under `MEDIA_ROOT`, served read-only by the API at `/media`."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        # Keys are ours, but a traversal must be impossible by construction,
        # not by trusting every future caller.
        if not path.is_relative_to(self.root):
            raise ValueError(f"media key escapes the media root: {key!r}")
        return path

    async def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    async def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


def build_media_storage() -> MediaStorage:
    mode = settings.MEDIA_STORAGE
    if mode == "local":
        return LocalMediaStorage(settings.MEDIA_ROOT)
    # ── Seam for object storage (S3 / Cloudflare R2) ──────────────────────
    # Implement `MediaStorage` with the vendor SDK HERE, in this module only,
    # require its credentials at startup the way `validate_payment_settings`
    # does, and point MEDIA_BASE_URL at the bucket's public origin. Until then
    # an unknown mode stops the app rather than quietly writing to local disk.
    raise RuntimeError(
        f"MEDIA_STORAGE={mode!r} is not implemented; the only storage today is 'local'"
    )


@lru_cache(maxsize=1)
def get_media_storage() -> MediaStorage:
    return build_media_storage()
