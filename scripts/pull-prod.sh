#!/usr/bin/env bash
# Restores production database and media into the local Docker dev environment.
# Caches the DB dump locally; re-uses it if under CACHE_MAX_AGE_HOURS old.
# Usage: ./scripts/pull-prod.sh [--no-cache]

set -euo pipefail

SERVER="litroute.com"
PROD_POSTGRES="flamerelay-postgres-1"
PROD_MEDIA="/srv/flamerelay/media/"
CACHE_MAX_AGE_HOURS=24

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CACHE_FILE="$SCRIPT_DIR/.pull-prod-dump.sql.gz"
LOCAL_MEDIA="$REPO_ROOT/flamerelay/media/"

# shellcheck source=/dev/null
source "$REPO_ROOT/.envs/.local/.postgres"

# --- Functions ---

setup_ssh_agent() {
    eval "$(ssh-agent -s)" >/dev/null
    local key
    key=$(ssh -G "$SERVER" | awk '/^identityfile/ { print $2; exit }')
    key="${key/#\~/$HOME}"
    ssh-add "$key"
    trap 'ssh-agent -k >/dev/null' EXIT
}

get_local_postgres_container() {
    local id
    id=$(docker compose -f "$REPO_ROOT/docker-compose.local.yml" ps -q postgres 2>/dev/null || true)
    if [[ -z "$id" ]]; then
        echo "ERROR: Local postgres container is not running. Run: just up" >&2
        exit 1
    fi
    echo "$id"
}

cache_is_fresh() {
    [[ -f "$CACHE_FILE" ]] || return 1
    local age_seconds=$(($(date +%s) - $(stat -f %m "$CACHE_FILE")))
    [[ $age_seconds -lt $((CACHE_MAX_AGE_HOURS * 3600)) ]]
}

cache_age_hours() {
    echo $((($(date +%s) - $(stat -f %m "$CACHE_FILE")) / 3600))
}

download_dump() {
    echo "WARNING: This will replace your local database with production data."
    read -rp "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || {
        echo "Aborted."
        exit 0
    }

    echo "==> Downloading production database dump..."
    ssh "$SERVER" \
        "docker exec $PROD_POSTGRES sh -c 'PGPASSWORD=\$POSTGRES_PASSWORD pg_dump -U \$POSTGRES_USER -d \$POSTGRES_DB --no-owner --no-acl | gzip'" \
        >"$CACHE_FILE"
    echo "    Saved to $CACHE_FILE"
}

restore_db() {
    local container="$1"
    echo "==> Dropping and recreating local database..."
    docker exec "$container" dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
    docker exec "$container" createdb -U "$POSTGRES_USER" --owner="$POSTGRES_USER" "$POSTGRES_DB"

    echo "==> Restoring database..."
    gunzip -c "$CACHE_FILE" |
        docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$container" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q
}

sync_media() {
    echo "==> Syncing media files..."
    rsync -avz --delete "$SERVER:$PROD_MEDIA" "$LOCAL_MEDIA"
}

# --- Main ---

main() {
    local use_cache=true
    for arg in "$@"; do
        case "$arg" in
        --no-cache) use_cache=false ;;
        *)
            echo "Unknown argument: $arg"
            exit 1
            ;;
        esac
    done

    setup_ssh_agent

    local container
    container=$(get_local_postgres_container)

    if $use_cache && cache_is_fresh; then
        echo "==> Using cached dump ($(cache_age_hours)h old; pass --no-cache to force refresh)"
    else
        if $use_cache && [[ -f "$CACHE_FILE" ]]; then
            echo "==> Cache is $(cache_age_hours)h old (limit: ${CACHE_MAX_AGE_HOURS}h) — re-downloading..."
        fi
        download_dump
    fi

    restore_db "$container"
    sync_media

    echo ""
    echo "==> Done. Production data restored locally."
}

main "$@"
