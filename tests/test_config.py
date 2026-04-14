from eikon.config import Config, load


def test_default_config():
    cfg = Config()
    assert cfg.veo.model == "veo-3.1-fast-generate-preview"
    assert cfg.generation.duration == 8
    assert cfg.generation.audio is False
    assert cfg.crop.target_resolution == 720


def test_load_returns_config():
    cfg = load()
    assert isinstance(cfg, Config)
