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
alembic upgrade head

exec "$@"
