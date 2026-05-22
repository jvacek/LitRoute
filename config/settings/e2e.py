"""Settings for the Playwright e2e suite.

Inherits everything from `local`, then pins Cloudflare's documented
"always-passes" Turnstile test keys so anonymous check-ins from the e2e
specs verify successfully without depending on whatever the .django
env file does (or doesn't) set.

Activated via `docker-compose.e2e.yml`, which sets
`DJANGO_SETTINGS_MODULE=config.settings.e2e` on the django service.

Keys reference:
https://developers.cloudflare.com/turnstile/troubleshooting/testing/
"""

from .local import *  # noqa: F403

CLOUDFLARE_TURNSTILE_SITE_KEY = "1x00000000000000000000AA"  # always-passes (visible)
CLOUDFLARE_TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA"  # noqa: S105  # always-passes
