"""Logic-layer tests for `send_thank_you_email_task` opt-out behavior."""

from __future__ import annotations

import pytest
from django.contrib.gis.geos import Point
from django.contrib.sites.models import Site

from backend.factories import CheckInFactory, UnitFactory
from backend.services import send_thank_you_email_task
from flamerelay.users.tests.factories import UserFactory


@pytest.fixture(autouse=True)
def _site(db):
    site, _ = Site.objects.get_or_create(id=1, defaults={"domain": "litroute.test", "name": "LitRoute"})
    site.domain = "litroute.test"
    site.save()
    return site


def _make_checkin(*, opted_in: bool):
    creator = UserFactory.create(receive_ty_emails=opted_in)
    return CheckInFactory.create(
        unit=UnitFactory.create(),
        created_by=creator,
        location=Point(0.0, 0.0),
    )


@pytest.mark.django_db
class TestThankYouTaskOptOut:
    def test_sends_when_opted_in(self, mailoutbox):
        checkin = _make_checkin(opted_in=True)
        send_thank_you_email_task(checkin.pk)
        assert len(mailoutbox) == 1
        assert mailoutbox[0].to == [checkin.created_by.email]

    def test_skipped_when_opted_out(self, mailoutbox):
        checkin = _make_checkin(opted_in=False)
        send_thank_you_email_task(checkin.pk)
        assert mailoutbox == []
