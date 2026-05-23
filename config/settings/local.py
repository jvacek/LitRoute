from .base import *  # noqa: F403
from .base import CONTENT_SECURITY_POLICY, INSTALLED_APPS, LOGGING, MIDDLEWARE, WEBPACK_LOADER, env

# GENERAL
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#debug
DEBUG = True
# https://docs.djangoproject.com/en/dev/ref/settings/#secret-key
SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    default="wmGlDTdzh8H7h2iVL4QIlc4jbMbS1o3E09g3P89sxHzepIAQ2AOHLjfo5WWH2n78",
)
# https://docs.djangoproject.com/en/dev/ref/settings/#allowed-hosts
ALLOWED_HOSTS = ["*"]
# Trust Tailscale Funnel / Serve hostnames so POSTs from a phone hitting the
# dev server through a tunnel aren't rejected by Django's CSRF origin check.
# https://docs.djangoproject.com/en/dev/ref/settings/#csrf-trusted-origins
CSRF_TRUSTED_ORIGINS = ["https://*.ts.net"]

# CACHES
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#caches
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "",
    },
}

# EMAIL
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#email-host
EMAIL_HOST = env("EMAIL_HOST", default="mailpit")
# https://docs.djangoproject.com/en/dev/ref/settings/#email-port
EMAIL_PORT = 1025

# WhiteNoise
# ------------------------------------------------------------------------------
# http://whitenoise.evans.io/en/latest/django.html#using-whitenoise-in-development
INSTALLED_APPS = ["whitenoise.runserver_nostatic", *INSTALLED_APPS]


# django-debug-toolbar
# ------------------------------------------------------------------------------
# https://django-debug-toolbar.readthedocs.io/en/latest/installation.html#prerequisites
INSTALLED_APPS += ["debug_toolbar"]
# https://django-debug-toolbar.readthedocs.io/en/latest/installation.html#middleware
MIDDLEWARE += ["debug_toolbar.middleware.DebugToolbarMiddleware"]


def _show_debug_toolbar(request) -> bool:
    """Skip toolbar injection on the SPA shell.

    The shell renders no SQL and no template context the panels can show, and
    its toolbar.js wraps window.fetch — which masks the real call site for
    every /api/* error. /admin/ and /__debug__/ pages still get the toolbar;
    tracked API requests are visible in the History view at /__debug__/.
    """
    if request.META.get("REMOTE_ADDR") not in INTERNAL_IPS:
        return False
    return request.path.startswith(("/__debug__/", "/admin/"))


# https://django-debug-toolbar.readthedocs.io/en/latest/configuration.html#debug-toolbar-config
DEBUG_TOOLBAR_CONFIG = {
    "DISABLE_PANELS": [
        "debug_toolbar.panels.redirects.RedirectsPanel",
        # Disable profiling panel due to an issue with Python 3.12+:
        # https://github.com/jazzband/django-debug-toolbar/issues/1875
        "debug_toolbar.panels.profiling.ProfilingPanel",
    ],
    "SHOW_TEMPLATE_CONTEXT": True,
    "SHOW_TOOLBAR_CALLBACK": "config.settings.local._show_debug_toolbar",
}
# https://django-debug-toolbar.readthedocs.io/en/latest/installation.html#internal-ips
INTERNAL_IPS = ["127.0.0.1", "10.0.2.2"]
if env("USE_DOCKER") == "yes":
    import socket

    hostname, _, ips = socket.gethostbyname_ex(socket.gethostname())
    INTERNAL_IPS += [".".join([*ip.split(".")[:-1], "1"]) for ip in ips]
    try:
        _, _, ips = socket.gethostbyname_ex("node")
        INTERNAL_IPS.extend(ips)
    except socket.gaierror:
        # The node container isn't started (yet?)
        pass

# django-extensions
# ------------------------------------------------------------------------------
# https://django-extensions.readthedocs.io/en/latest/installation_instructions.html#configuration
INSTALLED_APPS += [
    "django_extensions",
    # "django_fastdev",
    "django_migrations_ruff_formatter.apps.RuffFormatter",
]

# nplusone
# ------------------------------------------------------------------------------
# Flags N+1 query patterns by patching the ORM and logging when a queryset
# triggers per-row additional SELECTs. Local-only — patching every ORM call
# adds enough overhead that it would be a real prod hit.
# https://github.com/jmcarp/nplusone
INSTALLED_APPS += ["nplusone.ext.django"]
MIDDLEWARE = ["nplusone.ext.django.NPlusOneMiddleware", *MIDDLEWARE]
# Surface findings at WARNING so they show up in `just logs django` without
# also dumping every INFO line nplusone emits during init.
LOGGING["loggers"] = {**LOGGING.get("loggers", {}), "nplusone": {"handlers": ["console"], "level": "WARNING"}}
# Celery
# ------------------------------------------------------------------------------

# https://docs.celeryq.dev/en/stable/userguide/configuration.html#task-eager-propagates
CELERY_TASK_EAGER_PROPAGATES = True
# django-webpack-loader
# ------------------------------------------------------------------------------
WEBPACK_LOADER["DEFAULT"]["CACHE"] = not DEBUG
# Your stuff...
# ------------------------------------------------------------------------------
CRISPY_FAIL_SILENTLY = False
MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN = True

# Allow Swagger UI assets from jsdelivr (drf-spectacular loads them by default)
CONTENT_SECURITY_POLICY["DIRECTIVES"]["script-src"] = [
    "'self'",
    "'unsafe-inline'",
    "https://cdn.jsdelivr.net",
    "https://challenges.cloudflare.com",
]
CONTENT_SECURITY_POLICY["DIRECTIVES"]["style-src"] = [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.jsdelivr.net",
    "https://challenges.cloudflare.com",
]
CONTENT_SECURITY_POLICY["DIRECTIVES"]["img-src"] = [
    "'self'",
    "data:",
    "blob:",
    "https://api.maptiler.com",
    "https://cdn.jsdelivr.net",
    "https://*.vis.earthdata.nasa.gov",
    "https://gitc.earthdata.nasa.gov",
    "https://challenges.cloudflare.com",
]

# Allow webpack HMR websocket and dev server connections
CONTENT_SECURITY_POLICY["DIRECTIVES"]["connect-src"] = [
    "'self'",
    "ws://localhost:3000",
    "http://localhost:3000",
    "https://api.maptiler.com",
    "https://*.ingest.us.sentry.io",
]


STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "config.whitenoise_forgiving.ErrorSquashingStorage",
    },
}


CLOUDFLARE_TURNSTILE_SITE_KEY = env("CLOUDFLARE_TURNSTILE_SITE_KEY", default="1x00000000000000000000AA")
CLOUDFLARE_TURNSTILE_SECRET_KEY = env("CLOUDFLARE_TURNSTILE_SECRET_KEY", default="1x0000000000000000000000000000000AA")

SENTRY_ENVIRONMENT = "local"
