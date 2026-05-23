"""Cloudflare Turnstile siteverify call, isolated so the rest of the views
package doesn't import urllib or know the endpoint URL.

The view layer treats verification as a single bool. Tests patch
`backend.api.views.turnstile.verify_turnstile`; the autouse
`_pass_turnstile` fixture in `backend/tests/conftest.py` defaults every
API call in the suite to True so individual tests only patch when they
need to exercise a failure path.
"""

import json
import logging
import urllib.parse
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)


def verify_turnstile(token: str, remote_ip: str = "") -> bool:
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
