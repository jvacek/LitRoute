import os
from logging import getLogger

from django.apps import AppConfig

logger = getLogger(__name__)


class BackendConfig(AppConfig):
    name = "backend"

    def ready(self):
        import sentry_sdk  # noqa: PLC0415
        from django.conf import settings  # noqa: PLC0415

        # Wipe the cache on every autoreloader-triggered restart in local dev so
        # code changes don't get masked by stale cached values. Django's StatReloader
        # sets RUN_MAIN=true and Werkzeug's reloader (runserver_plus) sets
        # WERKZEUG_RUN_MAIN=true in the child process — never in production.
        if settings.DEBUG and (os.environ.get("RUN_MAIN") == "true" or os.environ.get("WERKZEUG_RUN_MAIN") == "true"):
            from django.core.cache import cache  # noqa: PLC0415

            logger.info("Clearing cache on autoreloader restart")
            cache.clear()

        if not getattr(settings, "SENTRY_DSN", None):
            return

        media_root = settings.MEDIA_ROOT
        if not os.access(media_root, os.W_OK):
            sentry_sdk.capture_message(
                f"Media directory {media_root} is not writable (uid={os.getuid()}). "
                f"On the host, run: chown -R {os.getuid()}:{os.getgid()} /srv/flamerelay/media",
                level="error",
            )
