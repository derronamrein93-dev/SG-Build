"""Domain model behaviour: validation, defaults, and copy-on-change."""

from __future__ import annotations

import pytest

from resorsa.models import Build, LifecycleStage, ValidationError


def test_all_eight_lifecycle_stages_exist():
    assert [stage.value for stage in LifecycleStage] == [
        "DEFINE",
        "CONSTRAIN",
        "RESOURCE",
        "VALIDATE",
        "BUILD",
        "TEST",
        "IMPROVE",
        "SCALE",
    ]


def test_create_sets_id_timestamps_and_default_stage():
    build = Build.create("Kiosk rollout")
    assert build.id
    assert build.lifecycle_stage is LifecycleStage.DEFINE
    assert build.created_at == build.updated_at
    assert build.created_at.tzinfo is not None


def test_create_gives_each_build_a_distinct_id():
    assert Build.create("one").id != Build.create("two").id


@pytest.mark.parametrize("given", ["build", "Build", " build "])
def test_lifecycle_stage_accepts_case_and_whitespace_variants(given):
    assert Build.create("Kiosk", lifecycle_stage=given).lifecycle_stage is LifecycleStage.BUILD


@pytest.mark.parametrize("given", ["SHIPPED", "", "define_", None, 3, "DEFINE,BUILD"])
def test_invalid_lifecycle_stage_is_rejected(given):
    with pytest.raises(ValidationError):
        Build.create("Kiosk", lifecycle_stage=given)


def test_blank_name_is_rejected():
    with pytest.raises(ValidationError):
        Build.create("   ")


def test_unknown_field_is_rejected():
    with pytest.raises(ValidationError):
        Build.create("Kiosk", owner="nobody")


def test_with_changes_preserves_id_and_created_at():
    build = Build.create("Kiosk", target="ten kiosks")
    changed = build.with_changes({"lifecycle_stage": "BUILD"})
    assert changed.id == build.id
    assert changed.created_at == build.created_at
    assert changed.target == "ten kiosks"
    assert changed.lifecycle_stage is LifecycleStage.BUILD


def test_with_changes_rejects_an_invalid_stage_and_leaves_the_original_alone():
    build = Build.create("Kiosk")
    with pytest.raises(ValidationError):
        build.with_changes({"lifecycle_stage": "SHIPPED"})
    assert build.lifecycle_stage is LifecycleStage.DEFINE


def test_to_dict_is_json_friendly():
    data = Build.create("Kiosk", lifecycle_stage="TEST").to_dict()
    assert data["lifecycle_stage"] == "TEST"
    assert isinstance(data["created_at"], str)
    assert set(data) == {
        "id", "name", "description", "target", "current_state", "customer",
        "problem", "constraints", "resources", "lifecycle_stage",
        "created_at", "updated_at",
    }
