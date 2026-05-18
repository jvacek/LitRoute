"""Tests for `flamerelay.utils.preload.get_preload_hints` route routing.

Why this exists: the resolver fails silently — if a chunk prefix or font
sourceFilename stops matching, `get_preload_hints` returns empty lists and the
page still works, just slower. Without tests, a webpack rename or fontsource
update can erase the preload hints without anyone noticing until LCP regresses
in Sentry weeks later.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from flamerelay.utils import preload

# Synthetic webpack-stats.json. Mirrors the real structure: each asset has
# name/publicPath/sourceFilename. Hashes are stand-ins so tests don't break
# when the real bundle changes.
FAKE_STATS = {
    "assets": {
        "js/vendor-maplibre-deadbeef.js": {
            "name": "js/vendor-maplibre-deadbeef.js",
            "publicPath": "/static/webpack_bundles/js/vendor-maplibre-deadbeef.js",
            "sourceFilename": "",
        },
        "js/pages-Unit-cafef00d.js": {
            "name": "js/pages-Unit-cafef00d.js",
            "publicPath": "/static/webpack_bundles/js/pages-Unit-cafef00d.js",
            "sourceFilename": "",
        },
        "js/pages-Login-abc123.js": {
            "name": "js/pages-Login-abc123.js",
            "publicPath": "/static/webpack_bundles/js/pages-Login-abc123.js",
            "sourceFilename": "",
        },
        "1111.woff2": {
            "name": "1111.woff2",
            "publicPath": "/static/webpack_bundles/1111.woff2",
            "sourceFilename": ("node_modules/@fontsource-variable/fraunces/files/fraunces-latin-standard-normal.woff2"),
        },
        "2222.woff2": {
            "name": "2222.woff2",
            "publicPath": "/static/webpack_bundles/2222.woff2",
            "sourceFilename": ("node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2"),
        },
        # Decoys: must not match any prefix or font pattern.
        "3333.woff2": {
            "name": "3333.woff2",
            "publicPath": "/static/webpack_bundles/3333.woff2",
            "sourceFilename": ("node_modules/@fontsource/caveat/files/caveat-cyrillic-400-normal.woff2"),
        },
        "js/some-other-chunk-zzzz.js": {
            "name": "js/some-other-chunk-zzzz.js",
            "publicPath": "/static/webpack_bundles/js/some-other-chunk-zzzz.js",
            "sourceFilename": "",
        },
    }
}

UNIT_URL = "/static/webpack_bundles/js/pages-Unit-cafef00d.js"
MAPLIBRE_URL = "/static/webpack_bundles/js/vendor-maplibre-deadbeef.js"
LOGIN_URL = "/static/webpack_bundles/js/pages-Login-abc123.js"
FRAUNCES_URL = "/static/webpack_bundles/1111.woff2"
DM_SANS_URL = "/static/webpack_bundles/2222.woff2"


@pytest.fixture(autouse=True)
def stub_stats():
    """Replace `_load_stats` so tests don't touch the real webpack-stats.json.

    Patching the wrapper bypasses `functools.cache` on `_load_stats_cached`
    entirely — no cache-clearing needed between tests.
    """
    with patch.object(preload, "_load_stats", return_value=FAKE_STATS):
        yield


class TestGetPreloadHints:
    def test_homepage_preloads_unit_chunk_maplibre_and_fonts(self):
        hints = preload.get_preload_hints("/")
        assert hints["preload_scripts"] == [UNIT_URL, MAPLIBRE_URL]
        assert hints["preload_fonts"] == [FRAUNCES_URL, DM_SANS_URL]

    def test_unit_page_preloads_unit_chunk_maplibre_and_fonts(self):
        hints = preload.get_preload_hints("/unit/john-93/")
        assert hints["preload_scripts"] == [UNIT_URL, MAPLIBRE_URL]
        assert hints["preload_fonts"] == [FRAUNCES_URL, DM_SANS_URL]

    def test_unit_page_without_trailing_slash_still_matches(self):
        hints = preload.get_preload_hints("/unit/john-93")
        assert hints["preload_scripts"] == [UNIT_URL, MAPLIBRE_URL]

    def test_unit_subpath_does_not_match(self):
        # /unit/:id/checkin etc. shouldn't be classified as the QR-landing fast
        # path — the user is past the first paint there.
        hints = preload.get_preload_hints("/unit/john-93/checkin")
        assert hints["preload_scripts"] == []
        assert hints["preload_fonts"] == [FRAUNCES_URL, DM_SANS_URL]

    def test_login_page_preloads_login_chunk_and_fonts(self):
        hints = preload.get_preload_hints("/accounts/login/")
        assert hints["preload_scripts"] == [LOGIN_URL]
        assert hints["preload_fonts"] == [FRAUNCES_URL, DM_SANS_URL]

    def test_unrelated_page_preloads_only_fonts(self):
        hints = preload.get_preload_hints("/about/")
        assert hints["preload_scripts"] == []
        assert hints["preload_fonts"] == [FRAUNCES_URL, DM_SANS_URL]


class TestResolverHelpers:
    """Direct coverage of the lookup primitives.

    These guard against silent breakage when webpack renames a chunk or
    fontsource ships a new file layout — the resolver returning None should be
    a test failure, not an invisible perf regression.
    """

    def test_find_chunk_by_prefix_returns_matching_public_path(self):
        assert preload._find_chunk_by_prefix(preload.UNIT_CHUNK_PREFIX) == UNIT_URL

    def test_find_chunk_by_prefix_returns_none_when_missing(self):
        assert preload._find_chunk_by_prefix("js/nonexistent-prefix-") is None

    def test_find_font_by_source_matches_substring(self):
        assert preload._find_font_by_source("fraunces-latin-standard-normal.woff2") == FRAUNCES_URL

    def test_find_font_by_source_returns_none_when_missing(self):
        assert preload._find_font_by_source("nonexistent-font.woff2") is None
