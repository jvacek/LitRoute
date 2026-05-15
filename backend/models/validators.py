import os
import re
import unicodedata
from uuid import uuid4

from django.core.exceptions import ValidationError

from config.constants import CHECKIN_IMAGE_MAX_UPLOAD_BYTES

_OBFUSCATED_DOT_RE = re.compile(r"[\(\[\{]\s*\.\s*[\)\]\}]")
_URL_RE = re.compile(r"(?:https?://|www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/)\S*", re.IGNORECASE)


def _normalize_for_url_check(value: str) -> str:
    stripped = "".join(c for c in value if c in "\t\n\r" or unicodedata.category(c) not in ("Cc", "Cf"))
    return _OBFUSCATED_DOT_RE.sub(".", stripped)


def path_and_rename(instance, filename):
    # This omne is in the migrations so keep that in mind pls
    upload_to = "checkins/"
    ext = filename.split(".")[-1]
    filename = f"{uuid4().hex}.{ext}"
    return os.path.join(upload_to, filename)  # noqa: PTH118


def validate_image_size(value):
    if value and value.size > CHECKIN_IMAGE_MAX_UPLOAD_BYTES:
        mb = CHECKIN_IMAGE_MAX_UPLOAD_BYTES // (1024 * 1024)
        msg = f"Image file too large. Maximum size is {mb} MB."
        raise ValidationError(msg)


def validate_no_urls(value: str) -> None:
    normalized = _normalize_for_url_check(value)
    match = _URL_RE.search(normalized)
    if match:
        msg = f"Links and URLs are not allowed in messages (found: '{match.group()}')."
        raise ValidationError(msg)
