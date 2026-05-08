"""Tests for project-specific Django admin configuration.

Generic admin CRUD/search/changelist behaviour is provided by Django and
not re-tested here. The only project-owned wiring is the optional
`DJANGO_ADMIN_FORCE_ALLAUTH=True` mode that swaps the admin login flow
for the allauth one.
"""

from __future__ import annotations

import contextlib
from importlib import reload

import pytest
from django.contrib import admin
from django.contrib.auth.models import AnonymousUser
from django.urls import reverse
from pytest_django.asserts import assertRedirects


@pytest.fixture
def _force_allauth(settings):
    settings.DJANGO_ADMIN_FORCE_ALLAUTH = True
    import flamerelay.users.admin as users_admin  # noqa: PLC0415

    with contextlib.suppress(admin.sites.AlreadyRegistered):  # type: ignore[attr-defined]
        reload(users_admin)


@pytest.mark.django_db
@pytest.mark.usefixtures("_force_allauth")
def test_allauth_login_redirects_admin_to_allauth(rf, settings):
    request = rf.get("/fake-url")
    request.user = AnonymousUser()
    response = admin.site.login(request)

    target_url = reverse(settings.LOGIN_URL) + "?next=" + request.path
    assertRedirects(response, target_url, fetch_redirect_response=False)
