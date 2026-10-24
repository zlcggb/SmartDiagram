"""``uv run jeff`` — start the server."""

from __future__ import annotations

import logging

import uvicorn

from .app import create_app
from .config import Settings


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = Settings()
    uvicorn.run(create_app(s), host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    main()
