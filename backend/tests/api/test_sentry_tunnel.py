"""POST /api/sentry/envelope/ — frontend Sentry envelope forwarder."""

from __future__ import annotations

import json
from unittest import mock

from django.test import override_settings
from rest_framework import status

VALID_DSN = "https://abc123@o4505142632513536.ingest.us.sentry.io/4511293331931136"


def _envelope(dsn: str) -> bytes:
    header = json.dumps({"event_id": "deadbeef", "dsn": dsn}).encode()
    body = b'{"type":"event"}\n{"message":"hi"}\n'
    return header + b"\n" + body


class TestSentryTunnel:
    @override_settings(SENTRY_DSN_FRONTEND="")
    def test_returns_204_when_dsn_not_configured(self, client):
        res = client.post(
            "/api/sentry/envelope/",
            data=_envelope(VALID_DSN),
            content_type="application/x-sentry-envelope",
        )
        assert res.status_code == status.HTTP_204_NO_CONTENT

    @override_settings(SENTRY_DSN_FRONTEND=VALID_DSN)
    def test_rejects_envelope_with_mismatched_dsn(self, client):
        bad = _envelope("https://x@other.ingest.us.sentry.io/9999")
        res = client.post(
            "/api/sentry/envelope/",
            data=bad,
            content_type="application/x-sentry-envelope",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    @override_settings(SENTRY_DSN_FRONTEND=VALID_DSN)
    def test_rejects_envelope_without_header(self, client):
        res = client.post(
            "/api/sentry/envelope/",
            data=b"not an envelope",
            content_type="application/x-sentry-envelope",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    @override_settings(SENTRY_DSN_FRONTEND=VALID_DSN)
    def test_forwards_matching_envelope_to_sentry(self, client):
        fake_response = mock.MagicMock()
        fake_response.read.return_value = b'{"id":"deadbeef"}'
        fake_response.status = 200
        fake_response.headers = {"Content-Type": "application/json"}
        fake_response.__enter__.return_value = fake_response
        fake_response.__exit__.return_value = False

        with mock.patch("backend.api.views.sentry_tunnel.urlopen", return_value=fake_response) as urlopen:
            res = client.post(
                "/api/sentry/envelope/",
                data=_envelope(VALID_DSN),
                content_type="application/x-sentry-envelope",
            )

        assert res.status_code == status.HTTP_200_OK
        upstream_req = urlopen.call_args.args[0]
        assert upstream_req.full_url == "https://o4505142632513536.ingest.us.sentry.io/api/4511293331931136/envelope/"

    def test_rejects_get(self, client):
        res = client.get("/api/sentry/envelope/")
        assert res.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
