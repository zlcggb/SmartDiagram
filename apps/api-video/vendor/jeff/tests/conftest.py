import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "models" / "gliformer-base-v1"


@pytest.fixture(scope="session")
def base_backend():
    if not BASE.exists():
        pytest.skip("models/gliformer-base-v1 not downloaded")
    from jeff.backends.torch_backend import TorchBackend

    return TorchBackend(str(BASE), device=os.environ.get("JEFF_DEVICE"))
