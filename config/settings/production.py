import logging

import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from sentry_sdk.integrations.redis import RedisIntegration

from config.whitenoise_immutable import immutable_file_test as _whitenoise_immutable_file_test

from .base import *  # noqa: F403
from .base import DATABASES, GIT_HASH, INSTALLED_APPS, REDIS_URL, SPECTACULAR_SETTINGS, env

# GENERAL
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#secret-key
SECRET_KEY = env("DJANGO_SECRET_KEY")
# https://docs.djangoproject.com/en/dev/ref/settings/#allowed-hosts
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["litroute.com"])

# DATABASES
# ------------------------------------------------------------------------------
DATABASES["default"]["CONN_MAX_AGE"] = env.int("CONN_MAX_AGE", default=60)

# CACHES
# ------------------------------------------------------------------------------
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            # Mimicking memcache behavior.
            # https://github.com/jazzband/django-redis#memcached-exceptions-behavior
            "IGNORE_EXCEPTIONS": True,
        },
    },
}
# Without this, IGNORE_EXCEPTIONS=True silently swallows Redis errors and
# Sentry never sees them. With it, every ignored exception is logged via the
# `django_redis.cache` logger configured below, which routes to Sentry via
# the LoggingIntegration.
DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS = True
DJANGO_REDIS_LOGGER = "django_redis.cache"

# SECURITY
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#secure-proxy-ssl-header
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# https://docs.djangoproject.com/en/dev/ref/settings/#secure-ssl-redirect
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
# https://docs.djangoproject.com/en/dev/ref/settings/#session-cookie-secure
SESSION_COOKIE_SECURE = True
# https://docs.djangoproject.com/en/dev/ref/settings/#session-cookie-name
SESSION_COOKIE_NAME = "__Secure-sessionid"
# https://docs.djangoproject.com/en/dev/ref/settings/#csrf-cookie-secure
CSRF_COOKIE_SECURE = True
# https://docs.djangoproject.com/en/dev/ref/settings/#csrf-cookie-name
CSRF_COOKIE_NAME = "__Secure-csrftoken"
# https://docs.djangoproject.com/en/dev/topics/security/#ssl-https
# https://docs.djangoproject.com/en/dev/ref/settings/#secure-hsts-seconds
# TODO: set this to 60 seconds first and then to 518400 once you prove the former works
SECURE_HSTS_SECONDS = 518400
# https://docs.djangoproject.com/en/dev/ref/settings/#secure-hsts-include-subdomains
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
# https://docs.djangoproject.com/en/dev/ref/settings/#secure-hsts-preload
SECURE_HSTS_PRELOAD = env.bool("DJANGO_SECURE_HSTS_PRELOAD", default=True)
# https://docs.djangoproject.com/en/dev/ref/middleware/#x-content-type-options-nosniff
SECURE_CONTENT_TYPE_NOSNIFF = env.bool("DJANGO_SECURE_CONTENT_TYPE_NOSNIFF", default=True)


# GS_BUCKET_NAME = env("DJANGO_GCP_STORAGE_BUCKET_NAME")
# GS_DEFAULT_ACL = "publicRead"
# STATIC & MEDIA
# ------------------------
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "config.whitenoise_forgiving.ErrorSquashingStorage",
    },
}

# WhiteNoise treats this as a regex pattern if it's a string, so we pass the
# callable directly. See config/whitenoise_immutable.py for the rationale.
WHITENOISE_IMMUTABLE_FILE_TEST = _whitenoise_immutable_file_test

# STORAGES = {
#     "default": {
#         "BACKEND": "storages.backends.gcloud.GoogleCloudStorage",
#         "OPTIONS": {
#             "location": "media",
#             "file_overwrite": False,
#         },
#     },
#     "staticfiles": {
#         "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
#     },
# }
# MEDIA_URL = f"https://storage.googleapis.com/{GS_BUCKET_NAME}/media/"

# ADMIN
# ------------------------------------------------------------------------------
# Django Admin URL regex.
ADMIN_URL = env("DJANGO_ADMIN_URL")

# Anymail
# ------------------------------------------------------------------------------
# https://anymail.readthedocs.io/en/stable/installation/#installing-anymail
INSTALLED_APPS += ["anymail"]
# https://docs.djangoproject.com/en/dev/ref/settings/#email-backend
# https://anymail.readthedocs.io/en/stable/installation/#anymail-settings-reference
# https://anymail.readthedocs.io/en/stable/esps/sendgrid
#
EMAIL_BACKEND = "anymail.backends.mailtrap.EmailBackend"
ANYMAIL = {
    "MAILTRAP_API_TOKEN": env("MAILTRAP_API_TOKEN"),
    # "MAILTRAP_SANDBOX_ID": env("MAILTRAP_SANDBOX_ID"),
}


# LOGGING
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#logging
# See https://docs.djangoproject.com/en/dev/topics/logging for
# more details on how to customize your logging configuration.

LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "formatters": {
        "verbose": {
            "format": "%(levelname)s %(asctime)s %(module)s %(process)d %(thread)d %(message)s",
        },
    },
    "handlers": {
        "console": {
            "level": "DEBUG",
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
        # Dedicated Sentry sink for `django_redis.cache`. Set at WARNING so any
        # level django-redis emits becomes a real Sentry event, not just a
        # breadcrumb. The global LoggingIntegration's event_level is ERROR,
        # which would miss WARNINGs.
        "sentry_redis_events": {
            "level": "WARNING",
            "class": "sentry_sdk.integrations.logging.EventHandler",
        },
    },
    "root": {"level": "INFO", "handlers": ["console"]},
    "loggers": {
        "django.db.backends": {
            "level": "ERROR",
            "handlers": ["console"],
            "propagate": False,
        },
        # Errors logged by the SDK itself
        "sentry_sdk": {"level": "ERROR", "handlers": ["console"], "propagate": False},
        "django.security.DisallowedHost": {
            "level": "ERROR",
            "handlers": ["console"],
            "propagate": False,
        },
        # `IGNORE_EXCEPTIONS=True` silences Redis errors at the cache layer.
        # `DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS=True` (above) re-emits them
        # via this logger; the dedicated `sentry_redis_events` handler
        # captures them as Sentry events. `propagate: False` + the matching
        # `ignore_logger("django_redis.cache")` call after `sentry_sdk.init`
        # below keeps the global LoggingIntegration from double-emitting
        # ERROR records.
        "django_redis.cache": {
            "level": "WARNING",
            "handlers": ["console", "sentry_redis_events"],
            "propagate": False,
        },
    },
}

# Sentry
# ------------------------------------------------------------------------------
SENTRY_DSN = env("SENTRY_DSN")
SENTRY_ENVIRONMENT = "production"
SENTRY_LOG_LEVEL = env.int("DJANGO_SENTRY_LOG_LEVEL", logging.INFO)

sentry_logging = LoggingIntegration(
    level=SENTRY_LOG_LEVEL,  # Capture info and above as breadcrumbs
    event_level=logging.ERROR,  # Send errors as events
)
integrations = [
    sentry_logging,
    DjangoIntegration(),
    CeleryIntegration(monitor_beat_tasks=True),
    RedisIntegration(),
]
sentry_sdk.init(
    dsn=SENTRY_DSN,
    integrations=integrations,
    environment=SENTRY_ENVIRONMENT,
    release=GIT_HASH or None,
    send_default_pii=True,
    traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.1),
)

# Capture django-redis cache exceptions via the dedicated `sentry_redis_events`
# handler in LOGGING above (level=WARNING). Pair with `ignore_logger` so the
# global LoggingIntegration's `callHandlers` patch doesn't ALSO emit an event
# for ERROR records — without this, every cache error would be sent twice.
ignore_logger("django_redis.cache")

# django-rest-framework
# -------------------------------------------------------------------------------
# Tools that generate code samples can use SERVERS to point to the correct domain
SPECTACULAR_SETTINGS["SERVERS"] = [  # pyrefly: ignore
    {"url": "https://litroute.com", "description": "Production server"},
]
# Your stuff...
# ------------------------------------------------------------------------------

CLOUDFLARE_TURNSTILE_SITE_KEY = env("CLOUDFLARE_TURNSTILE_SITE_KEY")
CLOUDFLARE_TURNSTILE_SECRET_KEY = env("CLOUDFLARE_TURNSTILE_SECRET_KEY")
