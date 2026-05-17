#!/usr/bin/env bash
# Triggers a fresh production database backup and verifies it can be decrypted
# and decompressed locally using the operator's GPG private key.
#
# Steps:
#   1. SSH to prod and run the in-container `backup` script (pg_dump | gzip | gpg).
#   2. Identify the newest backup file in the postgres `/backups` volume.
#   3. Stream it down via `docker exec ... cat` over SSH.
#   4. Decrypt with local GPG, gunzip-test, and peek the SQL header.
#
# Usage: ./scripts/verify-prod-backup.sh [--keep-decrypted]
#
# Requires the GPG private key for `gnupg@litroute.com` in the local keyring.

set -euo pipefail

SERVER="litroute.com"
PROD_POSTGRES="flamerelay-postgres-1"
PROD_BACKUP_DIR="/backups"
GPG_RECIPIENT="gnupg@litroute.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/.verify-prod-backup"

# --- Functions ---

setup_ssh_agent() {
    eval "$(ssh-agent -s)" >/dev/null
    local key
    key=$(ssh -G "$SERVER" | awk '/^identityfile/ { print $2; exit }')
    key="${key/#\~/$HOME}"
    ssh-add "$key"
    trap 'ssh-agent -k >/dev/null' EXIT
}

check_local_gpg_key() {
    if ! gpg --list-secret-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
        echo "ERROR: No local GPG secret key for '$GPG_RECIPIENT'." >&2
        echo "       Without it, the backup cannot be decrypted — verification is pointless." >&2
        exit 1
    fi
}

trigger_backup() {
    echo "==> Triggering backup on $SERVER ($PROD_POSTGRES)..."
    ssh "$SERVER" "docker exec $PROD_POSTGRES backup" >&2
}

latest_backup_filename() {
    ssh "$SERVER" \
        "docker exec $PROD_POSTGRES sh -c 'ls -1t $PROD_BACKUP_DIR/backup_*.sql.gz.gpg | head -n1'"
}

download_backup() {
    local remote_path="$1"
    local local_path="$2"
    echo "==> Streaming $remote_path -> $local_path..."
    ssh "$SERVER" "docker exec $PROD_POSTGRES cat '$remote_path'" >"$local_path"
    local size
    size=$(stat -f %z "$local_path")
    echo "    Downloaded $size bytes."
}

verify_backup() {
    local encrypted="$1"
    local decrypted_gz="$2"

    echo "==> Decrypting with local GPG key..."
    gpg --batch --yes --quiet --decrypt --output "$decrypted_gz" "$encrypted"

    echo "==> Testing gzip integrity..."
    gunzip -t "$decrypted_gz"

    # Subshells disable pipefail locally: head/grep -q close stdin early,
    # which SIGPIPEs gunzip and would otherwise abort the script (exit 141).
    echo "==> SQL header (first 5 lines):"
    ( set +o pipefail; gunzip -c "$decrypted_gz" | head -n 5 | sed 's/^/    /' )

    if ! ( set +o pipefail; gunzip -c "$decrypted_gz" | grep -q "PostgreSQL database dump" ); then
        echo "ERROR: Decrypted content does not look like a pg_dump output." >&2
        exit 1
    fi

    local row_markers
    row_markers=$(gunzip -c "$decrypted_gz" | grep -c "^CREATE TABLE " || true)
    echo "    Found $row_markers CREATE TABLE statements."
}

# --- Main ---

main() {
    local keep_decrypted=false
    for arg in "$@"; do
        case "$arg" in
        --keep-decrypted) keep_decrypted=true ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
        esac
    done

    check_local_gpg_key
    setup_ssh_agent

    mkdir -p "$OUT_DIR"

    trigger_backup

    local remote_path
    remote_path=$(latest_backup_filename)
    if [[ -z "$remote_path" ]]; then
        echo "ERROR: No backup file found in $PROD_BACKUP_DIR after running backup." >&2
        exit 1
    fi
    local basename
    basename=$(basename "$remote_path")
    echo "==> Latest backup: $basename"

    local encrypted="$OUT_DIR/$basename"
    local decrypted_gz="${encrypted%.gpg}"

    download_backup "$remote_path" "$encrypted"
    verify_backup "$encrypted" "$decrypted_gz"

    echo ""
    echo "==> SUCCESS: backup '$basename' decrypts and decompresses cleanly."
    echo "    Encrypted copy:  $encrypted"
    if $keep_decrypted; then
        echo "    Decrypted dump:  $decrypted_gz  (kept; contains production data — handle with care)"
    else
        rm -f "$decrypted_gz"
        echo "    Decrypted dump:  removed (pass --keep-decrypted to retain)"
    fi
}

main "$@"
