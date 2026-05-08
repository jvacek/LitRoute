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

# specs: Generate and validate the OpenAPI schema.
specs:
    @docker compose run --rm django python ./manage.py spectacular --file /app/openapi.yaml --validate

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

# node-reinstall: Drop and recreate the node container + node_modules volume (use after adding npm packages).
node-reinstall:
    @echo "Reinstalling node_modules..."
    @docker compose rm -f -s -v node
    @docker compose up -d node

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
