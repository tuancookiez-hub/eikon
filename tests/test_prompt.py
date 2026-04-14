from eikon.pipeline.prompt import build, build_all
from eikon.states import ALL_STATES


def test_build_contains_direction():
    result = build("thinking")
    assert "Contemplative" in result


def test_build_contains_frame_directive():
    result = build("idle")
    assert "Head and shoulders" in result


def test_build_all_returns_all_states():
    prompts = build_all()
    assert set(prompts.keys()) == set(ALL_STATES)
