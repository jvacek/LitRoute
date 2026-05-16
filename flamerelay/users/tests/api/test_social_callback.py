"""Regression tests for the OAuth callback "lost state" path.

With HEADLESS_ONLY=True, allauth requires every URL name it tries to resolve
to be listed in HEADLESS_FRONTEND_URLS. If `socialaccount_login_error` is
missing, allauth raises ImproperlyConfigured (HTTP 500) instead of redirecting
the user to a recoverable page. This bit us in production when Android Chrome
dropped the OAuth state cookie on the cross-site callback redirect.

Sentry: 7484983207 — ImproperlyConfigured: settings.HEADLESS_FRONTEND_URLS['socialaccount_login_error']
"""

from __future__ import annotations

import pytest
from allauth.socialaccount.models import SocialApp
from django.contrib.sites.models import Site
from rest_framework import status


@pytest.mark.django_db
def test_google_callback_with_missing_state_redirects_to_login(client):
    app = SocialApp.objects.create(provider="google", name="Google", client_id="x", secret="y")  # noqa: S106
    app.sites.add(Site.objects.get_current())

    response = client.get(
        "/accounts/google/login/callback/",
        {"state": "nonexistent-state-id", "code": "irrelevant"},
    )

    assert response.status_code == status.HTTP_302_FOUND
    location = response["Location"]
    assert "/accounts/login/" in location
    assert "error=unknown" in location
    assert "error_process=login" in location
