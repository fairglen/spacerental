#!/bin/sh
# Bring the schema to head before starting whatever was asked for.
#
# The application no longer creates tables at startup (see app/database.py), so
# this is the only thing that builds a dev or production schema. Keeping it in
# the entrypoint rather than in FastAPI's lifespan means `docker-compose up`
# still works on a fresh clone with no extra step, while migrations stay a
# deploy-time concern (for multi-replica deployments, ensure only one instance
# applies migrations at a time).
set -e

echo "Running database migrations..."
# Note: capture via redirection, not a `cmd | tee` pipe — under `set -e` in
# POSIX sh (no `pipefail`), a pipeline's exit status is the last command's
# (tee, which always succeeds), so a piped form would never detect failure.
LOG_FILE="$(mktemp)"
if alembic upgrade head > "$LOG_FILE" 2>&1; then
    cat "$LOG_FILE"
    rm -f "$LOG_FILE"
else
    cat "$LOG_FILE" >&2
    # A stale volume from before Alembic became the sole schema owner (see
    # CLAUDE.md §6.5) has tables/types created the old way but no
    # `alembic_version` row. `alembic upgrade head` then tries to create
    # everything from scratch and collides with what's already there,
    # surfacing as a wall of asyncpg DuplicateObjectError/DuplicateTableError
    # traceback. Detect that specific shape and point at the documented fix
    # instead of letting the raw traceback be the only clue.
    if grep -qE "DuplicateObjectError|DuplicateTableError" "$LOG_FILE"; then
        echo "" >&2
        echo "============================================================" >&2
        echo "Migration failed: schema objects already exist, but this" >&2
        echo "database has no 'alembic_version' row." >&2
        echo "" >&2
        echo "This means the Postgres volume predates Alembic becoming the" >&2
        echo "sole schema owner (README.md 'Database migrations', CLAUDE.md" >&2
        echo "§6.5) — it has tables created the old way, and 'alembic" >&2
        echo "upgrade head' is trying to create them again from scratch." >&2
        echo "" >&2
        echo "Fix (drops local data — fine for dev/seeded data):" >&2
        echo "    docker-compose down -v" >&2
        echo "    docker-compose up --build" >&2
        echo "    docker-compose exec backend python -m app.seed" >&2
        echo "" >&2
        echo "To keep the data instead, only if the existing schema already" >&2
        echo "matches migration head:" >&2
        echo "    docker-compose exec backend alembic stamp head" >&2
        echo "============================================================" >&2
    fi
    rm -f "$LOG_FILE"
    exit 1
fi

exec "$@"
