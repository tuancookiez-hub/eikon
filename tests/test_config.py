from eikon.config import Config, load


def test_default_config():
    cfg = Config()
    assert cfg.crop.target_resolution == 720
    assert cfg.crop.offset_y == 280


def test_load_returns_config():
    cfg = load()
    assert isinstance(cfg, Config)
