from eikon.config import Config, load


def test_default_config():
    cfg = Config()
    assert cfg.veo.model == "veo-3.1-lite-generate-001"
    assert cfg.generation.duration == 4
    assert cfg.generation.audio is False
    assert cfg.crop.target_resolution == 720


def test_load_returns_config():
    cfg = load()
    assert isinstance(cfg, Config)
