"""The production interlock (E02, S17): with APP_ENV=production every
development default that would otherwise work silently is refused, all at
once, before the app is built. Settings are built from explicit values —
no `.env`, no network; the media rule uses a temporary directory."""

import logging

import pytest
from app.config import (
    DEV_SECRET_KEY,
    PRODUCTION,
    Settings,
    enforce_production_settings,
    production_problems,
)


@pytest.fixture(autouse=True)
def no_mode_env(monkeypatch):
    """The "set explicitly" rule reads what was provided; the shell must not provide it."""
    for name in ("EMAIL_MODE", "STRIPE_MODE"):
        monkeypatch.delenv(name, raising=False)


def production(tmp_path, **overrides) -> Settings:
    values = {
        "APP_ENV": PRODUCTION,
        "SECRET_KEY": "a-generated-value-with-at-least-32-characters",
        "TEST_HOOKS_ENABLED": False,
        "FRONTEND_URL": "https://app.example.com",
        "CORS_ORIGINS": "https://app.example.com",
        "EMAIL_MODE": "stub",
        "STRIPE_MODE": "stub",
        "DATABASE_URL": "postgresql+asyncpg://spacerental:x@db.internal:5432/spacerental",
        "MEDIA_ROOT": str(tmp_path),
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class TestEachRule:
    def test_a_complete_production_configuration_has_no_problem(self, tmp_path):
        assert production_problems(production(tmp_path)) == []

    def test_the_development_secret_key_is_refused(self, tmp_path):
        [problem] = production_problems(production(tmp_path, SECRET_KEY=DEV_SECRET_KEY))
        assert problem.startswith("SECRET_KEY must be a generated value of at least 32")

    def test_a_short_secret_key_is_refused(self, tmp_path):
        [problem] = production_problems(production(tmp_path, SECRET_KEY="x" * 31))
        assert "SECRET_KEY" in problem

    def test_test_hooks_must_be_off(self, tmp_path):
        assert production_problems(production(tmp_path, TEST_HOOKS_ENABLED=True)) == [
            "TEST_HOOKS_ENABLED must be false"
        ]

    def test_frontend_url_must_be_https(self, tmp_path):
        [problem] = production_problems(production(tmp_path, FRONTEND_URL="http://app.example.com"))
        assert problem.startswith("FRONTEND_URL must be an https:// address")

    def test_every_cors_origin_must_be_https(self, tmp_path):
        [problem] = production_problems(
            production(tmp_path, CORS_ORIGINS="https://app.example.com, http://localhost:3000")
        )
        assert problem == "every CORS_ORIGINS entry must be https://, got 'http://localhost:3000'"

    @pytest.mark.parametrize("name", ["EMAIL_MODE", "STRIPE_MODE"])
    def test_a_gateway_mode_left_to_its_default_is_refused(self, tmp_path, name):
        # The same complete configuration with one mode not provided: its
        # value is still "stub" — the default — but nobody chose it.
        values = {k: v for k, v in production(tmp_path).model_dump().items() if k != name}
        current = Settings(_env_file=None, **values)
        assert getattr(current, name) == "stub"
        assert production_problems(current) == [
            f"{name} must be set explicitly (stub or live), not left to its default"
        ]

    def test_an_explicit_stub_mode_is_allowed(self, tmp_path):
        assert (
            production_problems(production(tmp_path, EMAIL_MODE="stub", STRIPE_MODE="stub")) == []
        )

    @pytest.mark.parametrize(
        "url",
        [
            "postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental",
            "postgresql+asyncpg://spacerental:spacerental@127.0.0.1:5432/spacerental",
            "postgresql+asyncpg://spacerental:spacerental@[::1]:5432/spacerental",
        ],
    )
    def test_a_localhost_database_is_refused(self, tmp_path, url):
        assert production_problems(production(tmp_path, DATABASE_URL=url)) == [
            "DATABASE_URL must not point at localhost"
        ]

    def test_a_missing_media_root_is_refused(self, tmp_path):
        [problem] = production_problems(production(tmp_path, MEDIA_ROOT=str(tmp_path / "absent")))
        assert problem.endswith("must be an existing, writable directory")

    def test_a_read_only_media_root_is_refused(self, tmp_path):
        root = tmp_path / "ro"
        root.mkdir()
        root.chmod(0o500)
        try:
            problems = production_problems(production(tmp_path, MEDIA_ROOT=str(root)))
        finally:
            root.chmod(0o700)
        if problems == []:
            pytest.skip("the test runs as a user the directory mode does not bind (root)")
        assert problems[0].endswith("must be an existing, writable directory")

    def test_every_problem_is_reported_at_once(self, tmp_path):
        problems = production_problems(
            production(
                tmp_path,
                SECRET_KEY=DEV_SECRET_KEY,
                TEST_HOOKS_ENABLED=True,
                FRONTEND_URL="http://localhost:3000",
                CORS_ORIGINS="http://localhost:3000",
                DATABASE_URL="postgresql+asyncpg://u:p@localhost/x",
                MEDIA_ROOT=str(tmp_path / "absent"),
            )
        )
        assert len(problems) == 6


class TestEnforcement:
    def test_development_is_never_checked(self, tmp_path):
        current = production(tmp_path, APP_ENV="development", SECRET_KEY=DEV_SECRET_KEY)
        enforce_production_settings(current)  # no exception

    def test_production_refuses_to_start_with_the_whole_list(self, tmp_path):
        current = production(tmp_path, SECRET_KEY=DEV_SECRET_KEY, TEST_HOOKS_ENABLED=True)
        with pytest.raises(RuntimeError) as excinfo:
            enforce_production_settings(current)
        message = str(excinfo.value)
        assert message.startswith("APP_ENV=production refuses to start:")
        assert "- SECRET_KEY must be" in message
        assert "- TEST_HOOKS_ENABLED must be false" in message

    def test_explicit_stub_modes_are_logged_at_warning(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING, logger="app"):
            enforce_production_settings(production(tmp_path))
        warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
        assert any(w.startswith("EMAIL_MODE=stub under APP_ENV=production") for w in warnings)
        assert any(w.startswith("STRIPE_MODE=stub under APP_ENV=production") for w in warnings)

    def test_live_modes_are_not_warned_about(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING, logger="app"):
            enforce_production_settings(production(tmp_path, EMAIL_MODE="live", STRIPE_MODE="live"))
        assert [r for r in caplog.records if r.levelno == logging.WARNING] == []
