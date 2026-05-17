import os

from django.apps import AppConfig


class BackendConfig(AppConfig):
    name = "backend"

    def ready(self):
        import sentry_sdk  # noqa: PLC0415
        from django.conf import settings  # noqa: PLC0415

        if not getattr(settings, "SENTRY_DSN", None):
            return

        media_root = settings.MEDIA_ROOT
        if not os.access(media_root, os.W_OK):
            sentry_sdk.capture_message(
                f"Media directory {media_root} is not writable (uid={os.getuid()}). "
                f"On the host, run: chown -R {os.getuid()}:{os.getgid()} /srv/flamerelay/media",
                level="error",
            )
