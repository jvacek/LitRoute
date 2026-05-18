"""Resolve preload/modulepreload URLs from the webpack stats file.

Both lazy chunk filenames and font filenames are content-hashed at build time, so
they cannot be hardcoded in the SPA template. This module reads
``webpack-stats.json`` to map stable identifiers (chunk prefixes,
``sourceFilename`` substrings) to the current build's hashed ``publicPath``.

Used by ``flamerelay.utils.context_processors.preload`` to emit
``<link rel="preload">`` hints in ``spa.html`` based on ``request.path``.
"""

import json
import re
from functools import cache

from django.conf import settings

# Fonts shown above the fold on every page. Matched against ``sourceFilename``
# substrings (each must be unique enough to identify a single asset).
ABOVE_FOLD_FONT_PATTERNS = (
    "fraunces-latin-standard-normal.woff2",
    "dm-sans-latin-400-normal.woff2",
)

# Chunk prefixes that identify a lazy-loaded route or vendor split.
#
# Unit/Login use ``webpackChunkName`` magic comments in App.tsx so they emit
# stable filenames in prod (webpack's ``chunkIds: "deterministic"`` default
# would otherwise emit numeric IDs like ``940-<hash>.js`` that we can't
# preload reliably).
UNIT_CHUNK_PREFIX = "js/pages-Unit-"
LOGIN_CHUNK_PREFIX = "js/pages-Login-"

UNIT_PATH_RE = re.compile(r"^/unit/[^/]+/?$")


@cache
def _load_stats_cached(mtime_ns: int) -> dict:
    with settings.WEBPACK_LOADER["DEFAULT"]["STATS_FILE"].open() as f:
        return json.load(f)


def _load_stats() -> dict:
    """Read webpack-stats.json with caching keyed on file mtime.

    Why: in prod the file never changes between deploys; in dev the bundle
    rebuilds re-key the cache automatically.
    """
    try:
        mtime_ns = settings.WEBPACK_LOADER["DEFAULT"]["STATS_FILE"].stat().st_mtime_ns
    except FileNotFoundError:
        return {}
    return _load_stats_cached(mtime_ns)


def _find_chunk_by_prefix(prefix: str) -> str | None:
    """Return the ``publicPath`` of the first JS asset whose name starts with prefix."""
    assets = _load_stats().get("assets", {})
    for name, meta in assets.items():
        if not name.endswith(".js"):
            continue
        if name.startswith(prefix):
            return meta.get("publicPath")
    return None


def _find_font_by_source(pattern: str) -> str | None:
    """Return the ``publicPath`` of the woff2 whose source filename contains pattern."""
    assets = _load_stats().get("assets", {})
    for meta in assets.values():
        source = meta.get("sourceFilename") or ""
        public = meta.get("publicPath") or ""
        if public.endswith(".woff2") and pattern in source:
            return public
    return None


def get_preload_hints(path: str) -> dict:
    """Return preload-link inputs for the given request path.

    Returns a dict with:
    - ``preload_scripts``: list of script URLs to ``<link rel="preload" as="script">``
    - ``preload_fonts``: list of woff2 URLs to ``<link rel="preload" as="font">``
    """
    fonts = [url for p in ABOVE_FOLD_FONT_PATTERNS if (url := _find_font_by_source(p))]

    scripts: list[str] = []
    if path == "/" or UNIT_PATH_RE.match(path):
        # QR-landing fast path: most users land on /unit/:id/ from a sticker scan,
        # and most homepage clicks go to /unit/:id/. Preload the Unit chunk so
        # the lazy import doesn't serialise behind the entry script.
        #
        # maplibre is intentionally NOT preloaded — the Unit page defers its
        # interactive map to ``requestIdleCallback`` and renders a placeholder
        # until then (see ``flamerelay/static/js/pages/Unit.tsx``). Preloading
        # the 1 MiB vendor-maplibre chunk would defeat that optimisation.
        if unit := _find_chunk_by_prefix(UNIT_CHUNK_PREFIX):
            scripts.append(unit)
    elif path == "/accounts/login/":
        if login := _find_chunk_by_prefix(LOGIN_CHUNK_PREFIX):
            scripts.append(login)

    return {"preload_scripts": scripts, "preload_fonts": fonts}
