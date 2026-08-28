"""Shared fixtures: every test gets its own SQLite file in a temp directory."""

from __future__ import annotations

import pytest

from resorsa.db import BuildStore
from resorsa.web import create_app


@pytest.fixture()
def db_path(tmp_path):
    return tmp_path / "resorsa-test.db"


@pytest.fixture()
def store(db_path) -> BuildStore:
    return BuildStore(db_path)


@pytest.fixture()
def client(db_path):
    app = create_app(db_path)
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client


def sample_fields(**overrides):
    """A fully populated build payload, so tests can spot fields that get lost."""
    fields = {
        "name": "Kiosk rollout",
        "description": "Self-serve kiosk for the front desk",
        "target": "Ten kiosks live by Q3",
        "current_state": "One prototype on a bench",
        "customer": "Front-desk staff",
        "problem": "Check-in queues run past twenty minutes",
        "constraints": "No new headcount; existing tablets only",
        "resources": "Two engineers, existing tablet fleet",
        "lifecycle_stage": "DEFINE",
    }
    fields.update(overrides)
    return fields
