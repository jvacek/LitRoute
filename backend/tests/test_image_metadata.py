"""CheckInImage strips ALL metadata from uploads, not just EXIF.

The frontend re-encodes photos through a canvas before upload, which drops
metadata — but it falls back to the raw original if that conversion fails, so
the server has to be the guarantee. ``StrippedResizedImageField`` (see
``backend/models/fields.py``) re-encodes every upload to WEBP and forwards no
metadata to the encoder.

Why not lean on django-resized' ``keep_meta=False``? That only pops the ``exif``
key; it still forwards ``xmp`` (and ``icc_profile``) to the WEBP encoder, and
XMP can carry GPS coordinates and author identity — the same data EXIF stripping
is meant to remove. This test guards against a regression to that behaviour.

Request-layer counterpart: api/test_pending_uploads.py (upload endpoint).
"""

from __future__ import annotations

from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from backend.models import CheckInImage

# EXIF tags we set on the source so we can prove they don't survive.
_EXIF_ORIENTATION = 0x0112
_EXIF_IMAGE_DESCRIPTION = 0x010E
# Orientation 6 = "rotate 90° CW on display"; normalisation bakes it into pixels.
_ORIENTATION_ROTATE_90 = 6


def _jpeg_with_metadata() -> bytes:
    """A 100x60 JPEG carrying EXIF (orientation + description) and an XMP packet."""
    exif = Image.Exif()
    exif[_EXIF_ORIENTATION] = _ORIENTATION_ROTATE_90
    exif[_EXIF_IMAGE_DESCRIPTION] = "secret description"
    buf = BytesIO()
    Image.new("RGB", (100, 60), (10, 20, 30)).save(
        buf,
        format="JPEG",
        exif=exif.tobytes(),
        xmp=b"<?xpacket?><x:xmpmeta><gps>51.5,0.0</gps></x:xmpmeta>",
    )
    return buf.getvalue()


@pytest.mark.django_db
class TestCheckInImageMetadataStripping:
    def test_source_actually_carries_metadata(self):
        # Guards the test itself: if Pillow ever stops embedding this metadata,
        # the stripping assertions below would pass vacuously.
        src = Image.open(BytesIO(_jpeg_with_metadata()))
        assert "exif" in src.info
        assert "xmp" in src.info
        assert src.getexif().get(_EXIF_ORIENTATION) == _ORIENTATION_ROTATE_90

    def test_stored_image_has_no_metadata(self):
        obj = CheckInImage.objects.create(
            checkin=None,
            image=SimpleUploadedFile("p.jpg", _jpeg_with_metadata(), content_type="image/jpeg"),
            attach_token="meta-strip-test",  # noqa: S106  (token, not a secret)
        )

        obj.image.open("rb")
        stored = Image.open(BytesIO(obj.image.read()))

        assert stored.format == "WEBP"
        assert "exif" not in stored.info
        assert "xmp" not in stored.info
        assert dict(stored.getexif()) == {}

    def test_orientation_is_baked_into_pixels_before_exif_is_dropped(self):
        # Stripping EXIF must not lose the orientation the camera recorded:
        # rotation is normalised into the pixels first. A 100x60 image with
        # EXIF orientation 6 (rotate 90°) becomes 60x100 once applied.
        obj = CheckInImage.objects.create(
            checkin=None,
            image=SimpleUploadedFile("o.jpg", _jpeg_with_metadata(), content_type="image/jpeg"),
            attach_token="meta-orient-test",  # noqa: S106  (token, not a secret)
        )

        obj.image.open("rb")
        stored = Image.open(BytesIO(obj.image.read()))

        assert stored.size == (60, 100)
