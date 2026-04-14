from eikon.states import STATES, ALL_STATES


def test_six_states():
    assert len(STATES) == 6
    assert len(ALL_STATES) == 6


def test_expected_states():
    expected = {"idle", "listening", "thinking", "speaking", "working", "error"}
    assert set(ALL_STATES) == expected


def test_all_have_directions():
    for state, direction in STATES.items():
        assert len(direction) > 20, f"{state} direction too short"
