"""Account API URL routing — verifies the `api:` namespace is wired up
and the canonical paths haven't drifted."""

from __future__ import annotations

import pytest
from django.urls import resolve, reverse


@pytest.mark.parametrize(
    ("name", "path"),
    [
        ("api:account", "/api/account/"),
        ("api:account-subscriptions", "/api/account/subscriptions/"),
    ],
)
def test_named_routes_resolve(name, path):
    assert reverse(name) == path
    assert resolve(path).view_name == name
