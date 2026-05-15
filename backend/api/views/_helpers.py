import json
import logging
import re
import urllib.parse
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)

# Unicode letters or digits, mirroring the frontend's /[\p{L}\p{N}]/gu.
# `[^\W_]` = word character that isn't underscore = letter or digit.
_LETTER_OR_DIGIT_RE = re.compile(r"[^\W_]")


def _verify_turnstile(token: str, remote_ip: str = "") -> bool:
    try:
        payload = urllib.parse.urlencode(
            {
                "secret": settings.CLOUDFLARE_TURNSTILE_SECRET_KEY,
                "response": token,
                "remoteip": remote_ip,
            }
        ).encode()
        req = urllib.request.Request(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data=payload,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
            return json.loads(resp.read()).get("success", False)
    except Exception:
        logger.exception("Turnstile verification error")
        return False
