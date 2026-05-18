from django.conf import settings

from .preload import get_preload_hints


def environment(request):
    return {
        "IS_LOCAL": settings.DEBUG,
        "SENTRY_DSN_FRONTEND": getattr(settings, "SENTRY_DSN_FRONTEND", ""),
        "SENTRY_ENVIRONMENT": getattr(settings, "SENTRY_ENVIRONMENT", ""),
    }


def preload(request):
    return get_preload_hints(request.path)
