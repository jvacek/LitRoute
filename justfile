export COMPOSE_FILE := "docker-compose.local.yml"

## Just does not yet manage signals for subprocesses reliably, which can lead to unexpected behavior.
## Exercise caution before expanding its usage in production environments.
## For more information, see https://github.com/casey/just/issues/2473 .

# Default command to list all available commands.
default:
    @just --list

# ── Lifecycle ──────────────────────────────────────────────────────────────────

# build: Build images and cap build cache at 5 GB.
build *args:
    @echo "Building images..."
    @docker compose build {{args}}
    @docker builder prune --reserved-space 5gb -f

# up: Start all containers.
up:
    @echo "Starting up containers..."
    @docker compose up -d --remove-orphans

# down: Stop containers and remove dangling images.
down:
    @echo "Stopping containers..."
    @docker compose down
    @docker image prune -f

# prune: Remove containers and their volumes.
prune *args:
    @echo "Killing containers and removing volumes..."
    @docker compose down -v {{args}}

# reload: Restart node, django, and celery containers (mailpit and redis stay alive).
reload:
    @docker compose restart node django celeryworker celerybeat

# rebuild: Rebuild changed images, restart affected containers, and cap build cache at 5 GB.
rebuild:
    @echo "Rebuilding changed images and restarting affected containers..."
    @docker compose up -d --build --remove-orphans
    @docker builder prune --reserved-space 5gb -f

# ── Development ────────────────────────────────────────────────────────────────

# logs: Stream container logs.
logs *args:
    @docker compose logs -f {{args}}

# manage: Run a manage.py command.
manage +args:
    @docker compose run --rm django python ./manage.py {{args}}

# test: Run pytest.
test *args:
    @docker compose run --rm django pytest {{args}}

# e2e [args]: Run the Playwright e2e suite in an isolated compose project
#             (flamerelay_e2e). Brings up its own django/node/postgres/redis on
#             ports 8010/3010, leaving your `just up` dev stack untouched. First
#             time: `npm i && npx playwright install chromium`.
e2e *args:
    @COMPOSE_PROJECT_NAME=flamerelay_e2e COMPOSE_FILE="docker-compose.local.yml:docker-compose.e2e.yml" \
        docker compose up -d django node
    @COMPOSE_PROJECT_NAME=flamerelay_e2e COMPOSE_FILE="docker-compose.local.yml:docker-compose.e2e.yml" \
        docker compose run --rm django sh -c "python manage.py migrate && python manage.py seed_e2e_units"
    @E2E_BASE_URL=http://localhost:3010 npx playwright test {{args}}

# e2e-down: Stop and remove the isolated e2e stack and its volumes (DB, redis cache).
e2e-down:
    @COMPOSE_PROJECT_NAME=flamerelay_e2e COMPOSE_FILE="docker-compose.local.yml:docker-compose.e2e.yml" \
        docker compose down -v

# specs: Regenerate the OpenAPI schema YAML and the matching TypeScript types.
#        YAML is produced in a one-shot django container (no `just up` required);
#        TS types are generated on the host via openapi-typescript. Both
#        artifacts are checked in — re-run after any serializer/viewset change
#        and commit the resulting openapi.yaml + flamerelay/static/js/api/schema.d.ts.
specs:
    @docker compose run --rm django python ./manage.py spectacular --file /app/openapi.yaml --validate
    @npm run gen:api

# ── Translations ───────────────────────────────────────────────────────────────

# i18n-unused: List keys in en/translation.json not referenced in any source file (informational — not a CI gate).
i18n-unused:
    @node scripts/unused-translations.mjs

# ── Assets ─────────────────────────────────────────────────────────────────────

# webpack-reset: Clear webpack filesystem cache and restart node (fixes blank page after major JS changes).
webpack-reset:
    @echo "Clearing webpack cache and restarting node..."
    @rm -rf .webpack_cache
    @docker compose restart node

# webpack-rebuild [file]: Force webpack to rebuild on macOS when host file events aren't reaching the node container (Rancher Desktop / Docker Desktop virtiofs). Defaults to the React entry — pass a relative project path to invalidate just that file.
webpack-rebuild file="flamerelay/static/js/project.tsx":
    @docker compose exec -T node touch /app/{{file}}

# node-reinstall: Rebuild the node image and recreate its container + node_modules volume (use after adding npm packages).
#                 The image bakes `npm install` into a layer from package.json, and the /app/node_modules anonymous volume
#                 is seeded from that layer on container start — so the image must be rebuilt, not just the volume recreated.
node-reinstall:
    @echo "Reinstalling node_modules..."
    @npm install
    @docker compose build node
    @docker compose rm -f -s -v node
    @docker compose up --force-recreate -d node

# generate-favicons: Render PNG/ICO variants from the SVG source, then collect into staticfiles.
generate-favicons:
    node scripts/generate-favicons.mjs
    just manage collectstatic --noinput

# ── Cleanup ────────────────────────────────────────────────────────────────────

# clean: Remove dangling images and stopped containers.
clean:
    @echo "Removing dangling images and stopped containers..."
    @docker image prune -f
    @docker container prune -f

# trim: Remove dangling images/containers and cap build cache at 5 GB. Safe to run
#       at any time — tagged project images are never touched, so `just up` keeps working.
trim: clean
    @echo "Capping build cache at 5 GB (evicts oldest entries)..."
    @docker builder prune --reserved-space 5gb -f

# clean-all: Remove all unused images, containers, networks, and build cache.
clean-all:
    @echo "Removing all unused Docker resources..."
    @docker system prune -af --volumes
