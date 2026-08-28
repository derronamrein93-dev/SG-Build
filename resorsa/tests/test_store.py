"""SQLite persistence: create, retrieve, list, update, and durability."""

from __future__ import annotations

import sqlite3

import pytest

from conftest import sample_fields
from resorsa.db import BuildStore
from resorsa.models import Build, LifecycleStage, ValidationError


def test_create_returns_the_stored_build(store):
    build = store.create(**sample_fields())
    assert build.id
    assert build.name == "Kiosk rollout"
    assert build.lifecycle_stage is LifecycleStage.DEFINE


def test_retrieve_round_trips_every_field(store):
    fields = sample_fields(lifecycle_stage="RESOURCE")
    created = store.create(**fields)

    fetched = store.get(created.id)

    assert fetched is not None
    for name, value in fields.items():
        expected = LifecycleStage.coerce(value) if name == "lifecycle_stage" else value
        assert getattr(fetched, name) == expected
    assert fetched.created_at == created.created_at
    assert fetched.updated_at == created.updated_at


def test_list_returns_every_build(store):
    names = {store.create(name=f"Build {n}").name for n in range(3)}
    assert {build.name for build in store.list()} == names


def test_list_is_empty_for_a_fresh_database(store):
    assert store.list() == []


def test_update_changes_the_named_field(store):
    created = store.create(**sample_fields())

    updated = store.update(created.id, {"lifecycle_stage": "BUILD", "current_state": "Two on site"})

    assert updated is not None
    assert updated.lifecycle_stage is LifecycleStage.BUILD
    assert updated.current_state == "Two on site"
    assert store.get(created.id).lifecycle_stage is LifecycleStage.BUILD


def test_partial_update_preserves_untouched_fields(store):
    fields = sample_fields()
    created = store.create(**fields)

    store.update(created.id, {"lifecycle_stage": "VALIDATE"})

    stored = store.get(created.id)
    untouched = {k: v for k, v in fields.items() if k != "lifecycle_stage"}
    for name, value in untouched.items():
        assert getattr(stored, name) == value, f"{name} was not preserved"
    assert stored.id == created.id
    assert stored.created_at == created.created_at
    assert stored.updated_at >= created.updated_at


def test_update_with_no_changes_is_a_no_op(store):
    created = store.create(**sample_fields())
    assert store.update(created.id, {}) == created


def test_update_rejects_an_invalid_lifecycle_stage(store):
    created = store.create(**sample_fields())

    with pytest.raises(ValidationError):
        store.update(created.id, {"lifecycle_stage": "SHIPPED"})

    assert store.get(created.id).lifecycle_stage is LifecycleStage.DEFINE


def test_update_rejects_an_unknown_field(store):
    created = store.create(**sample_fields())
    with pytest.raises(ValidationError):
        store.update(created.id, {"owner": "nobody"})


@pytest.mark.parametrize("unknown_id", ["does-not-exist", "", None, "'; DROP TABLE builds; --"])
def test_unknown_id_is_handled_safely(store, unknown_id):
    store.create(**sample_fields())

    assert store.get(unknown_id) is None
    assert store.update(unknown_id, {"name": "ignored"}) is None
    assert len(store.list()) == 1


def test_data_survives_across_separate_connections(db_path):
    first = BuildStore(db_path)
    created = first.create(**sample_fields())
    first.update(created.id, {"lifecycle_stage": "TEST", "resources": "Three engineers"})

    second = BuildStore(db_path)  # a brand-new store, so a brand-new connection
    reloaded = second.get(created.id)

    assert reloaded is not None
    assert reloaded.name == "Kiosk rollout"
    assert reloaded.lifecycle_stage is LifecycleStage.TEST
    assert reloaded.resources == "Three engineers"
    assert reloaded.customer == "Front-desk staff"
    assert [b.id for b in second.list()] == [created.id]


def test_schema_initialization_is_non_destructive(db_path):
    first = BuildStore(db_path)
    created = first.create(**sample_fields())

    BuildStore(db_path)          # re-initialising an existing database
    first.initialize_schema()    # and doing it again explicitly

    assert first.get(created.id) is not None
    assert len(first.list()) == 1


def test_stage_is_stored_as_its_string_name(db_path):
    store = BuildStore(db_path)
    created = store.create(**sample_fields(lifecycle_stage="IMPROVE"))

    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT lifecycle_stage FROM builds WHERE id = ?", (created.id,)
        ).fetchone()
    finally:
        conn.close()

    assert row[0] == "IMPROVE"


def test_add_stores_a_prebuilt_build(store):
    build = Build.create("Prebuilt", target="somewhere")
    store.add(build)
    assert store.get(build.id) == build
