"""Email template assertions for project-specific conventions.

We don't re-test Django's template engine itself — only the
project-specific invariants that the new-checkin template carries an
unfollow link and the thank-you template doesn't.
"""

from __future__ import annotations

import pytest
from django.contrib.gis.geos import Point
from django.contrib.sites.models import Site
from django.template.loader import render_to_string

from backend.factories import CheckInFactory, UnitFactory
from backend.services import render_thank_you_email
from flamerelay.users.tests.factories import UserFactory

NEW_CHECKIN_TEMPLATE = "backend/email_new_checkin.html"


@pytest.fixture
def site(db):
    site, _ = Site.objects.get_or_create(id=1, defaults={"domain": "litroute.test", "name": "LitRoute"})
    site.domain = "litroute.test"
    site.save()
    return site


@pytest.fixture
def follower(db):
    return UserFactory.create()


@pytest.fixture
def checkin(db, follower):
    unit = UnitFactory.create()
    unit.followers.add(follower)
    return CheckInFactory.create(
        unit=unit,
        message="Just arrived in Paris!",
        place="Paris, France",
        location=Point(2.3522, 48.8566),
    )


def _render_new_checkin(checkin, user, site):
    return render_to_string(NEW_CHECKIN_TEMPLATE, {"instance": checkin, "user": user, "site": site})


class TestNewCheckinEmail:
    def test_unfollow_link_present(self, checkin, follower, site):
        assert "action=unfollow" in _render_new_checkin(checkin, follower, site)

    def test_no_img_tag_when_checkin_has_no_image(self, checkin, follower, site):
        assert "<img" not in _render_new_checkin(checkin, follower, site)


class TestThankYouEmail:
    def test_no_unfollow_link(self, checkin, site):
        assert "action=unfollow" not in render_thank_you_email(checkin, site)

    def test_no_img_tag_when_checkin_has_no_image(self, checkin, site):
        assert "<img" not in render_thank_you_email(checkin, site)
