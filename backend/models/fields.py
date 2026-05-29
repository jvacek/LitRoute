from io import BytesIO

from django.core.files.base import ContentFile
from django.db import models
from django_case_insensitive_field import CaseInsensitiveFieldMixin
from django_resized import ResizedImageField
from django_resized.forms import (
    DEFAULT_NORMALIZE_ROTATION,
    ResizedImageFieldFile,
    convert_mode_for_format,
    normalize_rotation,
)
from PIL import Image, ImageFile, ImageOps


class CaseInsensitiveCharField(CaseInsensitiveFieldMixin, models.CharField):
    # FYI this class is imported directly in the migration so keep that in mind pls
    def __init__(self, *args, **kwargs):
        super(CaseInsensitiveFieldMixin, self).__init__(*args, **kwargs)


class StrippedResizedImageFieldFile(ResizedImageFieldFile):
    """ResizedImageFieldFile that drops ALL image metadata, not just EXIF.

    django-resized' own ``save()`` only does ``img_info.pop('exif', None)`` when
    ``keep_meta=False``, then forwards the rest of ``img.info`` to
    ``Image.save(**img_info)``. For WEBP output that re-attaches any ``xmp`` and
    ``icc_profile`` blocks the source carried — and XMP can hold GPS coordinates
    and author identity, exactly the data we strip EXIF to remove. We don't trust
    the frontend canvas re-encode to be the only line of defence (it's skipped on
    its own conversion-failure fallback), so the server guarantees a clean file.

    This is a faithful copy of ``ResizedImageFieldFile.save`` with one change:
    the metadata block clears ``img_info`` entirely instead of only popping EXIF.
    Rotation normalisation still runs first, so orientation is baked into pixels
    before the metadata that described it is discarded.
    """

    def save(self, name, content, save=True):  # noqa: FBT002  (matches FieldFile.save signature)
        content.file.seek(0)
        img = Image.open(content.file)

        if DEFAULT_NORMALIZE_ROTATION:
            img = normalize_rotation(img)

        if self.field.force_format:
            img = convert_mode_for_format(self.field.force_format, img)

        resample = Image.Resampling.LANCZOS

        if self.field.size is None:
            self.field.size = img.size

        if self.field.crop:
            thumb = ImageOps.fit(img, self.field.size, resample, centering=self.get_centring())
        elif None in self.field.size:
            thumb = img
            if self.field.size[0] is None and self.field.size[1] is not None:
                self.field.scale = self.field.size[1] / img.size[1]
            elif self.field.size[1] is None and self.field.size[0] is not None:
                self.field.scale = self.field.size[0] / img.size[0]
        else:
            img.thumbnail(self.field.size, resample)
            thumb = img

        if self.field.scale is not None:
            thumb = ImageOps.scale(thumb, self.field.scale, resample)

        # The whole point of this subclass: forward NO metadata to the encoder.
        if not self.field.keep_meta:
            img.info.clear()

        ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, thumb.size[0] * thumb.size[1])
        new_content = BytesIO()
        img_format = img.format if self.field.force_format is None else self.field.force_format
        thumb.save(new_content, format=img_format, quality=self.field.quality, **img.info)
        new_content = ContentFile(new_content.getvalue())

        name = self.get_name(name, img_format)
        # Skip ResizedImageFieldFile.save (the logic we just reimplemented) and go
        # straight to Django's FieldFile.save with the already-processed bytes.
        super(ResizedImageFieldFile, self).save(name, new_content, save)


class StrippedResizedImageField(ResizedImageField):
    """ResizedImageField wired to strip every metadata block (see file class)."""

    attr_class = StrippedResizedImageFieldFile
