"""Feedback POST endpoint: anon vs authenticated, captcha gating, validation."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from rest_framework import status

from backend.models import Feedback
from config.constants import FEEDBACK_MESSAGE_MAX_LENGTH


@pytest.fixture
def mute_feedback_emails():
    with patch("backend.services.send_feedback_emails_task.apply_async") as mock:
        yield mock


class TestAnonFeedback:
    def test_anon_post_with_valid_captcha_returns_201_and_creates_row(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = "test-secret"  # noqa: S105
        with patch("backend.api.views.turnstile.verify_turnstile", return_value=True):
            res = client.post(
                "/api/feedback/",
                {"message": "Found a bug", "email": "anon@example.com", "turnstile_token": "ok"},
                format="json",
            )
        assert res.status_code == status.HTTP_201_CREATED
        feedback = Feedback.objects.get()
        assert feedback.user is None
        assert feedback.email == "anon@example.com"
        assert feedback.message == "Found a bug"
        mute_feedback_emails.assert_called_once_with(args=[feedback.pk])

    def test_anon_post_with_bad_captcha_returns_400(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = "test-secret"  # noqa: S105
        with patch("backend.api.views.turnstile.verify_turnstile", return_value=False):
            res = client.post(
                "/api/feedback/",
                {"message": "Found a bug", "email": "anon@example.com", "turnstile_token": "bad"},
                format="json",
            )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert Feedback.objects.count() == 0

    def test_anon_post_without_email_succeeds_with_blank_email(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = ""
        res = client.post(
            "/api/feedback/",
            {"message": "Found a bug"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        feedback = Feedback.objects.get()
        assert feedback.user is None
        assert feedback.email == ""
        assert feedback.message == "Found a bug"

    def test_anon_post_with_invalid_email_returns_400(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = ""
        res = client.post(
            "/api/feedback/",
            {"message": "Found a bug", "email": "not-an-email"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert Feedback.objects.count() == 0


class TestAuthenticatedFeedback:
    def test_auth_post_uses_account_email_and_creates_row(self, auth_client, user, mute_feedback_emails):
        user.email = "loggedin@example.com"
        user.save()
        res = auth_client.post(
            "/api/feedback/",
            {"message": "Love the app", "email": "ignored@example.com"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        feedback = Feedback.objects.get()
        assert feedback.user_id == user.pk
        assert feedback.email == "loggedin@example.com"  # body email is ignored
        assert feedback.message == "Love the app"
        mute_feedback_emails.assert_called_once_with(args=[feedback.pk])

    def test_auth_post_skips_turnstile(self, auth_client, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = "test-secret"  # noqa: S105
        with patch("backend.api.views.turnstile.verify_turnstile") as mock_verify:
            res = auth_client.post(
                "/api/feedback/",
                {"message": "Hi"},
                format="json",
            )
        assert res.status_code == status.HTTP_201_CREATED
        mock_verify.assert_not_called()


class TestFeedbackValidation:
    def test_empty_message_returns_400(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = ""
        res = client.post(
            "/api/feedback/",
            {"message": "", "email": "anon@example.com"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_whitespace_only_message_returns_400(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = ""
        res = client.post(
            "/api/feedback/",
            {"message": "   \n\t  ", "email": "anon@example.com"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_oversized_message_returns_400(self, client, db, settings, mute_feedback_emails):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = ""
        res = client.post(
            "/api/feedback/",
            {"message": "x" * (FEEDBACK_MESSAGE_MAX_LENGTH + 1), "email": "anon@example.com"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
