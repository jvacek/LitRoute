"""Shared fixtures and constants for the backend test suite.

Logic-layer tests live directly in `backend/tests/`. Request-layer (HTTP)
tests live in `backend/tests/api/`. Both share the fixtures defined here.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from backend.factories import UnitFactory
from backend.models import CheckIn
from flamerelay.users.tests.factories import UserFactory

LONDON = Point(-0.1278, 51.5074)
PARIS = Point(2.3522, 48.8566)
LONDON_PAYLOAD = {"type": "Point", "coordinates": [-0.1278, 51.5074]}
PARIS_PAYLOAD = {"type": "Point", "coordinates": [2.3522, 48.8566]}


@contextmanager
def mute_checkin_emails():
    """Patch out the two Celery email tasks fired by CheckIn.save()."""
    with (
        patch("backend.models.send_email_to_subscribers_task.apply_async"),
        patch("backend.models.send_thank_you_email_task.apply_async"),
    ):
        yield


@pytest.fixture
def mute_emails():
    with mute_checkin_emails():
        yield


@pytest.fixture(autouse=True)
def _pass_turnstile():
    """Default every API call to a successful captcha. The test settings carry
    a real-looking Turnstile secret, so without this the verify call would hit
    Cloudflare for real. Tests that exercise captcha behavior open their own
    `with patch("backend.api.views._verify_turnstile", ...)`, which rebinds
    the attribute for the duration of the test body and shadows this fixture.
    """
    with patch("backend.api.views._verify_turnstile", return_value=True) as mock:
        yield mock


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def user(db):
    # Mirrors the `user` fixture in `flamerelay/conftest.py`; redefined here
    # because pytest does not propagate sibling-tree conftest fixtures.
    return UserFactory.create()


@pytest.fixture
def unit(db):
    return UnitFactory.create()


@pytest.fixture
def gps_unit(db):
    """Variant of `unit` attached to a GPS-enforced game (DISTANCE mode) so
    the check-in API's drift validator activates."""
    from backend.factories import GameFactory  # noqa: PLC0415
    from backend.models import Game  # noqa: PLC0415

    return UnitFactory.create(game=GameFactory.create(mode=Game.Modes.DISTANCE))


@pytest.fixture
def auth_client(client, user):
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def make_checkin(db):
    """Create a CheckIn directly in the DB, bypassing the API and email tasks.

    Use `hours_ago=N` to backdate the row for grace-period testing; the field
    is updated via QuerySet.update() to bypass auto_now_add.
    """

    def _make(unit, user=None, *, location=LONDON, hours_ago=0, anonymous=False, **kwargs):
        with mute_checkin_emails():
            checkin = CheckIn.objects.create(
                unit=unit,
                created_by=None if anonymous else user,
                location=location,
                edit_token=uuid.uuid4() if anonymous else None,
                **kwargs,
            )
        if hours_ago:
            CheckIn.objects.filter(pk=checkin.pk).update(date_created=timezone.now() - timedelta(hours=hours_ago))
            checkin.refresh_from_db()
        return checkin

    return _make


@pytest.fixture
def clear_cache():
    cache.clear()
    yield
    cache.clear()
