"""
With these settings, tests run faster.
"""

from .base import *  # noqa: F403
from .base import INSTALLED_APPS, TEMPLATES, env

# GENERAL
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#secret-key
SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    default="VuGmmYX2syyuC3p5gfghLHFm8uvp2TdRARgvwNfRJAqs8DZLvr6RydhjTBMFSX5M",
)
# https://docs.djangoproject.com/en/dev/ref/settings/#test-runner
TEST_RUNNER = "django.test.runner.DiscoverRunner"

# PASSWORDS
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#password-hashers
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# EMAIL
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#email-backend
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

INSTALLED_APPS = [*INSTALLED_APPS, "django_fastdev"]
FASTDEV_IGNORED_TEMPLATES = [r".*/rest_framework/", r".*/admin/", r".*/auth/"]

# DEBUGGING FOR TEMPLATES
# ------------------------------------------------------------------------------
TEMPLATES[0]["OPTIONS"]["debug"] = True  # type: ignore[index]

# MEDIA
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#media-url
MEDIA_URL = "http://media.testserver/"
# django-webpack-loader
# ------------------------------------------------------------------------------
# pyrefly: ignore [bad-typed-dict-key]
WEBPACK_LOADER["DEFAULT"]["LOADER_CLASS"] = "webpack_loader.loaders.FakeWebpackLoader"  # noqa: F405
# Your stuff...
# ------------------------------------------------------------------------------

CLOUDFLARE_TURNSTILE_SITE_KEY = "1x00000000000000000000AA"
CLOUDFLARE_TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA"  # noqa: S105
