from django.conf import settings


def environment(request):
    return {
        "IS_LOCAL": settings.DEBUG,
        "SENTRY_DSN_FRONTEND": getattr(settings, "SENTRY_DSN_FRONTEND", ""),
        "SENTRY_ENVIRONMENT": getattr(settings, "SENTRY_ENVIRONMENT", ""),
    }
