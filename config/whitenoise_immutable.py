"""Custom WHITENOISE_IMMUTABLE_FILE_TEST.

WhiteNoise's default test expects Django's '.HASH.ext' manifest format with
exactly 12 hex chars. Webpack emits three other patterns, none of which match
(see webpack/common.config.js):

    - 'js/[name]-[fullhash].js'      → 'project-27f3a342c7bafea8ec6d.js'
    - 'css/[name].[contenthash].css' → 'project.7a4f92af81014070c44f.css'
    - asset/resource '[hash].ext'    → '97def203da337e26d827.woff2'

Without this override, every webpack asset gets max-age=60 instead of the
year-long 'immutable' header. Cloudflare hides the issue on most traffic, but
cold loads and non-CF paths revalidate on every reload.
"""

import re

# Matches a hex hash of 8+ chars preceded by '-', '.', or '/', followed by an
# extension. Covers all three webpack patterns and Django's 12-char manifest
# format (where the preceding char is always '.').
_WEBPACK_HASH_RE = re.compile(r"(?:[-.]|/)[a-f0-9]{8,}\.[a-z0-9]+$")


def immutable_file_test(path: str, url: str) -> bool:
    return bool(_WEBPACK_HASH_RE.search(url))
