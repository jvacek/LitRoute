"""Same-origin proxy for Sentry envelope POSTs.

Some browsers (Safari ITP) and ad blockers refuse direct requests to
`*.ingest.sentry.io`. The frontend SDK is configured with `tunnel: "/api/sentry/envelope/"`
so all envelopes hit this endpoint instead. We validate the envelope's
embedded DSN against the configured `SENTRY_DSN_FRONTEND` (so the tunnel
can't be abused as an open relay for arbitrary Sentry projects) and forward
the raw body to Sentry.
"""

from __future__ import annotations

import json
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from config.constants import SENTRY_TUNNEL_FORWARD_TIMEOUT_SECONDS


def _parse_dsn(dsn: str) -> tuple[str | None, str]:
    parsed = urlparse(dsn)
    return parsed.hostname, parsed.path.strip("/")


@csrf_exempt
@require_POST
@transaction.non_atomic_requests
def sentry_tunnel(request) -> HttpResponse:
    dsn = getattr(settings, "SENTRY_DSN_FRONTEND", "")
    if not dsn:
        return HttpResponse(status=204)
    expected_host, expected_project_id = _parse_dsn(dsn)

    body = request.body
    header_end = body.find(b"\n")
    if header_end == -1:
        return HttpResponseBadRequest("invalid envelope")
    try:
        header = json.loads(body[:header_end])
    except json.JSONDecodeError:
        return HttpResponseBadRequest("invalid envelope header")

    envelope_dsn = header.get("dsn")
    if not envelope_dsn:
        return HttpResponseBadRequest("missing dsn")
    host, project_id = _parse_dsn(envelope_dsn)
    if host != expected_host or project_id != expected_project_id:
        return HttpResponseBadRequest("dsn mismatch")

    upstream = Request(
        f"https://{host}/api/{project_id}/envelope/",
        data=body,
        headers={"Content-Type": "application/x-sentry-envelope"},
        method="POST",
    )
    with urlopen(upstream, timeout=SENTRY_TUNNEL_FORWARD_TIMEOUT_SECONDS) as resp:  # noqa: S310
        return HttpResponse(
            resp.read(),
            status=resp.status,
            content_type=resp.headers.get("Content-Type", "application/json"),
        )
