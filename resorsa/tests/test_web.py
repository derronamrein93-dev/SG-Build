"""The four web journeys: create, list, open, edit."""

from __future__ import annotations

from conftest import sample_fields
from resorsa.db import BuildStore


def test_index_shows_an_empty_state(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"No builds yet" in response.data


def test_create_a_build_through_the_form(client, db_path):
    response = client.post("/builds", data=sample_fields(), follow_redirects=True)

    assert response.status_code == 200
    assert b"Kiosk rollout" in response.data

    stored = BuildStore(db_path).list()
    assert len(stored) == 1
    assert stored[0].problem == "Check-in queues run past twenty minutes"


def test_list_shows_created_builds(client):
    client.post("/builds", data=sample_fields(name="First"))
    client.post("/builds", data=sample_fields(name="Second"))

    response = client.get("/")

    assert b"First" in response.data
    assert b"Second" in response.data


def test_open_a_build_shows_its_fields(client, db_path):
    client.post("/builds", data=sample_fields())
    build = BuildStore(db_path).list()[0]

    response = client.get(f"/builds/{build.id}")

    assert response.status_code == 200
    assert b"Ten kiosks live by Q3" in response.data
    assert b"Front-desk staff" in response.data


def test_edit_a_build_through_the_form(client, db_path):
    client.post("/builds", data=sample_fields())
    build = BuildStore(db_path).list()[0]

    response = client.post(
        f"/builds/{build.id}",
        data=sample_fields(lifecycle_stage="BUILD", current_state="Two on site"),
        follow_redirects=True,
    )

    assert response.status_code == 200
    stored = BuildStore(db_path).get(build.id)
    assert stored.lifecycle_stage.value == "BUILD"
    assert stored.current_state == "Two on site"
    assert stored.customer == "Front-desk staff"


def test_edit_form_is_prefilled(client, db_path):
    client.post("/builds", data=sample_fields())
    build = BuildStore(db_path).list()[0]

    response = client.get(f"/builds/{build.id}/edit")

    assert response.status_code == 200
    assert b"Kiosk rollout" in response.data


def test_creating_without_a_name_is_rejected(client, db_path):
    response = client.post("/builds", data=sample_fields(name="  "))

    assert response.status_code == 400
    assert BuildStore(db_path).list() == []


def test_creating_with_an_invalid_stage_is_rejected(client, db_path):
    response = client.post("/builds", data=sample_fields(lifecycle_stage="SHIPPED"))

    assert response.status_code == 400
    assert BuildStore(db_path).list() == []


def test_unknown_build_id_returns_404(client):
    for path in ("/builds/does-not-exist", "/builds/does-not-exist/edit"):
        assert client.get(path).status_code == 404
    assert client.post("/builds/does-not-exist", data=sample_fields()).status_code == 404
