from eikon.pipeline.prompt import build, build_all
from eikon.states import ALL_STATES


def test_build_contains_subject():
    result = build("A girl with blue hair", "idle")
    assert "A girl with blue hair" in result


def test_build_contains_direction():
    result = build("subject", "thinking")
    assert "Contemplative" in result


def test_build_contains_frame_directive():
    result = build("subject", "idle")
    assert "Head and shoulders" in result


def test_build_all_returns_all_states():
    prompts = build_all("test subject")
    assert set(prompts.keys()) == set(ALL_STATES)
