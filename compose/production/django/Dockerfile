FROM docker.io/node:24.14-bookworm-slim AS client-builder

ARG APP_HOME=/app
WORKDIR ${APP_HOME}

COPY ./package.json ./package-lock.json ${APP_HOME}/
RUN --mount=type=cache,target=/root/.npm npm ci

# Only copy what webpack needs — Python/template changes won't invalidate this layer
COPY ./tsconfig.json ${APP_HOME}/
COPY ./webpack ${APP_HOME}/webpack
COPY ./flamerelay/static ${APP_HOME}/flamerelay/static
# CHANGELOG.md is parsed at build time by webpack/loaders/changelog-loader.js
# and rendered on /changelog/, so the client-builder stage needs it.
COPY ./CHANGELOG.md ${APP_HOME}/CHANGELOG.md

# Build-time secrets for Sentry source map upload. ARG-only (no ENV) keeps the
# auth token out of the final image's layer history. The trailing inline env
# assignments scope them to this single RUN command. SENTRY_PROJECT_FRONTEND
# is renamed to SENTRY_PROJECT for the plugin (which reads it by default).
ARG GIT_HASH=""
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT_FRONTEND=""
RUN --mount=type=cache,target=/app/.webpack_cache \
    GIT_HASH="$GIT_HASH" \
    SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN" \
    SENTRY_ORG="$SENTRY_ORG" \
    SENTRY_PROJECT="$SENTRY_PROJECT_FRONTEND" \
    npm run build

# define an alias for the specific python version used in this file.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS python-build-stage

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0

ARG APP_HOME=/app

WORKDIR ${APP_HOME}

# Install apt packages
RUN apt-get update && apt-get install --no-install-recommends -y \
  # dependencies for building Python packages
  build-essential \
  # psycopg dependencies
  libpq-dev

# Install deps without the project — cached as long as uv.lock/pyproject.toml don't change
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

# Copy Python source
COPY . ${APP_HOME}

# Copy only the webpack output from client-builder — avoids pulling in node_modules
COPY --from=client-builder ${APP_HOME}/flamerelay/static/webpack_bundles ${APP_HOME}/flamerelay/static/webpack_bundles
COPY --from=client-builder ${APP_HOME}/webpack-stats.json ${APP_HOME}/webpack-stats.json

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev

# Python 'run' stage
FROM python:3.14-slim-bookworm AS python-run-stage

ARG APP_HOME=/app

WORKDIR ${APP_HOME}

RUN addgroup --system --gid 10001 django \
  && adduser --system --uid 10001 --ingroup django django


# Install required system dependencies
RUN apt-get update && apt-get install --no-install-recommends -y \
  # psycopg dependencies
  libpq-dev \
  # django.contrib.gis dependencies
  libgdal-dev \
  gdal-bin \
  libgeos-dev \
  # Translations dependencies
  gettext \
  # entrypoint
  wait-for-it \
  # cleaning up unused files
  && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
  && rm -rf /var/lib/apt/lists/*


COPY --chown=django:django ./compose/production/django/entrypoint /entrypoint
RUN sed -i 's/\r$//g' /entrypoint
RUN chmod +x /entrypoint


COPY --chown=django:django ./compose/production/django/start /start
RUN sed -i 's/\r$//g' /start
RUN chmod +x /start
COPY --chown=django:django ./compose/production/django/celery/worker/start /start-celeryworker
RUN sed -i 's/\r$//g' /start-celeryworker
RUN chmod +x /start-celeryworker


COPY --chown=django:django ./compose/production/django/celery/beat/start /start-celerybeat
RUN sed -i 's/\r$//g' /start-celerybeat
RUN chmod +x /start-celerybeat


COPY --chown=django:django ./compose/production/django/celery/flower/start /start-flower
RUN sed -i 's/\r$//g' /start-flower
RUN chmod +x /start-flower

# Copy the application from the builder
COPY --from=python-build-stage --chown=django:django ${APP_HOME} ${APP_HOME}

# make django owner of the WORKDIR directory as well.
RUN chown django:django ${APP_HOME}

RUN mkdir -p ${APP_HOME}/flamerelay/media && chown django:django ${APP_HOME}/flamerelay/media

# Place executables in the environment at the front of the path
ENV PATH="/app/.venv/bin:$PATH"

USER django

ARG GIT_HASH=""
ENV GIT_HASH=${GIT_HASH}

RUN DATABASE_URL="sqlite:///tmp/noop.db" \
  DJANGO_SETTINGS_MODULE="config.settings.base" \
  python manage.py compilemessages

ENTRYPOINT ["/entrypoint"]
