"""SPA catch-all routing — the Django shell delegates every non-API path
to a single React shell view named `spa`. CLAUDE.md calls this out as a
project invariant."""

from __future__ import annotations

import pytest
from django.urls import resolve


@pytest.mark.parametrize("path", ["/profile/", "/profile/settings/", "/profile/update/"])
def test_profile_paths_serve_spa(path):
    assert resolve(path).view_name == "spa"
