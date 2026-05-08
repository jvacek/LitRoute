"""Logic-layer tests for the feedback email task and signal."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core import mail

from backend.models import Feedback
from backend.services import send_feedback_emails_task
from flamerelay.users.tests.factories import UserFactory


@pytest.fixture
def mute_feedback_emails():
    with patch("backend.models.send_feedback_emails_task.apply_async") as mock:
        yield mock


@pytest.fixture
def admin_user(db):
    return UserFactory.create(is_superuser=True, email="admin@litroute.com")


class TestSendFeedbackEmailsTask:
    def test_sends_to_admin_and_submitter_when_email_present(self, admin_user):
        with patch("backend.models.send_feedback_emails_task.apply_async"):
            feedback = Feedback.objects.create(user=None, email="user@example.com", message="Hello there")
        send_feedback_emails_task(feedback.pk)

        assert len(mail.outbox) == 2  # noqa: PLR2004
        recipients = sorted(addr for msg in mail.outbox for addr in msg.to)
        assert recipients == ["admin@litroute.com", "user@example.com"]

        admin_email = next(m for m in mail.outbox if "admin@litroute.com" in m.to)
        assert "user@example.com" in admin_email.subject
        assert "Hello there" in admin_email.body

        submitter_email = next(m for m in mail.outbox if "user@example.com" in m.to)
        assert "Hello there" in submitter_email.body

    def test_admin_email_lists_all_active_superusers_in_one_send(self, db):
        UserFactory.create(is_superuser=True, email="admin1@example.com")
        UserFactory.create(is_superuser=True, email="admin2@example.com")
        UserFactory.create(is_superuser=False, email="not-an-admin@example.com")  # excluded
        UserFactory.create(is_superuser=True, is_active=False, email="inactive@example.com")  # excluded
        UserFactory.create(is_superuser=True, email="")  # blank email excluded

        with patch("backend.models.send_feedback_emails_task.apply_async"):
            feedback = Feedback.objects.create(user=None, email="", message="Hi all admins")
        send_feedback_emails_task(feedback.pk)

        assert len(mail.outbox) == 1
        assert sorted(mail.outbox[0].to) == ["admin1@example.com", "admin2@example.com"]
        assert "Hi all admins" in mail.outbox[0].body

    def test_sends_only_to_admin_when_email_blank(self, admin_user):
        with patch("backend.models.send_feedback_emails_task.apply_async"):
            feedback = Feedback.objects.create(user=None, email="", message="Anonymous note")
        send_feedback_emails_task(feedback.pk)

        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["admin@litroute.com"]
        assert "anonymous" in mail.outbox[0].subject.lower()
        assert "Anonymous note" in mail.outbox[0].body

    def test_skips_admin_send_when_no_superusers_exist(self, db):
        with patch("backend.models.send_feedback_emails_task.apply_async"):
            feedback = Feedback.objects.create(user=None, email="user@example.com", message="Hi")
        send_feedback_emails_task(feedback.pk)
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["user@example.com"]

    def test_missing_feedback_id_is_noop(self, admin_user):
        send_feedback_emails_task(99999)
        assert mail.outbox == []


class TestFeedbackSignal:
    def test_signal_triggers_task_on_create(self, db, mute_feedback_emails):
        feedback = Feedback.objects.create(user=None, email="x@example.com", message="hello")
        mute_feedback_emails.assert_called_once_with(args=[feedback.pk])

    def test_signal_does_not_trigger_on_update(self, db, mute_feedback_emails):
        feedback = Feedback.objects.create(user=None, email="x@example.com", message="hello")
        mute_feedback_emails.reset_mock()
        feedback.message = "updated"
        feedback.save()
        mute_feedback_emails.assert_not_called()
