# syntax=docker/dockerfile:1
# Two stages (Q53): `builder` resolves the wheels, `runtime` carries only the
# interpreter, the installed packages and the application, and runs as a
# non-root user with a health check. docker-compose.yml bind-mounts ./backend
# over /app and runs uvicorn --reload for development; the image's own CMD is
# the production server. Base pinned by digest (python:3.12-slim).
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# The media volume (docker-compose.yml) takes this directory's ownership when
# it is first created, so photo uploads work without root. A volume created by
# an earlier, root-running image is fixed once, in place, keeping the database:
#   docker compose run --rm --user root backend chown -R app:app /var/lib/spacerental/media
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /var/lib/spacerental/media && chown app:app /var/lib/spacerental/media
COPY --from=builder /install /usr/local
COPY --chown=app:app . .
RUN chmod +x docker-entrypoint.sh
USER app
EXPOSE 8000
# No curl in slim: the interpreter asks /health itself.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
# ENTRYPOINT (not CMD) so `alembic upgrade head` runs even when docker-compose
# overrides the command with the --reload dev server.
ENTRYPOINT ["./docker-entrypoint.sh"]
# P2.3: the production server. WEB_CONCURRENCY workers (default 1; with
# RATE_LIMIT_STORE=postgres the limits are shared and one hold sweeper runs
# per deployment — N01/N02 — so more workers only add capacity), proxy
# headers honoured (the client address behind the TLS terminator),
# keep-alive 15 s.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1} --proxy-headers --timeout-keep-alive 15"]
