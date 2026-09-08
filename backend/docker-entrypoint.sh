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
    # Duplicate objects can indicate a legacy unversioned schema, but also
    # migration drift in an already-versioned database. Do not infer either
    # diagnosis from the exception name alone.
    if grep -qE "DuplicateObjectError|DuplicateTableError" "$LOG_FILE"; then
        echo "" >&2
        echo "============================================================" >&2
        echo "Migration failed because a schema object already exists." >&2
        echo "Inspect the failed migration and database version first:" >&2
        echo "    docker-compose run --rm --entrypoint alembic backend current" >&2
        echo "A legacy volume without an Alembic revision is one possible" >&2
        echo "cause; a versioned database can also have migration drift." >&2
        echo "" >&2
        echo "For disposable local data ONLY (deletes Compose volumes):" >&2
        echo "    docker-compose down -v" >&2
        echo "    docker-compose up --build" >&2
        echo "    docker-compose exec backend python -m app.seed" >&2
        echo "" >&2
        echo "To preserve data, back it up and reconcile the schema first." >&2
        echo "Only if you have verified it matches migration head exactly:" >&2
        echo "    docker-compose run --rm --entrypoint alembic backend stamp head" >&2
        echo "Stamping records a revision; it does not apply migrations." >&2
        echo "============================================================" >&2
    fi
    rm -f "$LOG_FILE"
    exit 1
fi

exec "$@"
