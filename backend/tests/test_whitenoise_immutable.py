"""Test the custom WHITENOISE_IMMUTABLE_FILE_TEST callable.

Pinned because the failure modes are silent: a false negative ships every
webpack asset with max-age=60, a false positive pins an unhashed asset in
browser caches for a year with no way to bust it. Both keep working in dev.

If webpack's output filename pattern in `webpack/common.config.js` changes
(currently `js/[name]-[fullhash].js`, `css/[name].[contenthash].css`, and
asset/resource `[hash].ext`), the matrix below must keep matching — otherwise
the regex in `config/whitenoise_immutable.py` needs to be updated.
"""

import pytest

from config.whitenoise_immutable import immutable_file_test


class TestImmutableFileTest:
    @pytest.mark.parametrize(
        "url",
        [
            # webpack 'js/[name]-[fullhash].js' (20 hex chars after dash)
            "/static/webpack_bundles/js/project-27f3a342c7bafea8ec6d.js",
            "/static/webpack_bundles/js/vendor-react-27f3a342c7bafea8ec6d.js",
            "/static/webpack_bundles/js/vendor-sentry-27f3a342c7bafea8ec6d.js",
            "/static/webpack_bundles/js/vendor-i18n-27f3a342c7bafea8ec6d.js",
            "/static/webpack_bundles/js/vendors-27f3a342c7bafea8ec6d.js",
            # webpack 'css/[name].[contenthash].css' (20 hex chars after dot)
            "/static/webpack_bundles/css/project.7a4f92af81014070c44f.css",
            "/static/webpack_bundles/css/vendor-maplibre.20682d1662f421139373.css",
            # webpack asset/resource '[hash].ext' (hash directly after slash)
            "/static/webpack_bundles/97def203da337e26d827.woff2",
            "/static/webpack_bundles/82030a1890bed4343989.svg",
            "/static/webpack_bundles/5c2fc3604542bbe56c82.webp",
            # Django manifest format ('.HASH.ext' with 12 hex chars) — covers
            # collectstatic output for any non-webpack staticfile.
            "/static/admin/css/base.abc123def456.css",
        ],
    )
    def test_hashed_assets_are_immutable(self, url):
        assert immutable_file_test(path="", url=url) is True

    @pytest.mark.parametrize(
        "url",
        [
            # Static assets without a hash (favicons, manifest, robots, etc.)
            "/static/images/favicons/litroute.svg",
            "/static/images/favicons/local-litroute.svg",
            "/static/images/favicons/site.webmanifest",
            "/static/images/favicons/favicon-32x32.png",
            # Project CSS source path (no hash) — never served in prod but
            # guards against regressions if the path appears in URLs.
            "/static/css/project.css",
            # Django admin assets (no manifest hash applied)
            "/static/admin/css/base.css",
            "/static/admin/js/core.js",
            # Django Debug Toolbar (dev only, never immutable)
            "/static/debug_toolbar/js/toolbar.js",
            "/static/debug_toolbar/css/print.css",
            # Hash too short to be a webpack hash (5 chars)
            "/static/foo-abc12.js",
            # Three-char names that look hex-ish but aren't 8+ chars
            "/static/cafe.svg",
        ],
    )
    def test_unhashed_assets_are_not_immutable(self, url):
        assert immutable_file_test(path="", url=url) is False

    def test_minimum_hash_length_boundary(self):
        # Exactly 8 hex chars after a separator should match. This is the
        # lower bound — shorter hashes are common enough in non-webpack names
        # (e.g. 'abc123.svg') that we don't want to treat them as immutable.
        assert immutable_file_test(path="", url="/static/foo-abcdef12.js") is True
        assert immutable_file_test(path="", url="/static/foo-abcdef1.js") is False
