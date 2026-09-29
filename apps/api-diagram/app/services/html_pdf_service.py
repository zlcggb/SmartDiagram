"""Render self-contained HTML to PDF with headless Chromium."""

from __future__ import annotations

import asyncio
import logging

from playwright.async_api import Browser, Playwright, Route, async_playwright

logger = logging.getLogger(__name__)

MAX_HTML_BYTES = 2 * 1024 * 1024
_RENDER_TIMEOUT_MS = 20_000
_MAX_CONCURRENT = 2

_lock = asyncio.Lock()
_slots = asyncio.Semaphore(_MAX_CONCURRENT)
_playwright: Playwright | None = None
_browser: Browser | None = None


async def _get_browser() -> Browser:
    global _playwright, _browser
    async with _lock:
        if _browser is None or not _browser.is_connected():
            if _playwright is None:
                _playwright = await async_playwright().start()
            _browser = await _playwright.chromium.launch(args=["--disable-dev-shm-usage"])
        return _browser


async def _block_request(route: Route) -> None:
    # Untrusted HTML must not reach the network or local files (SSRF / file disclosure).
    await route.abort()


async def render_html_to_pdf(html: str) -> bytes:
    async with _slots:
        browser = await _get_browser()
        context = await browser.new_context(java_script_enabled=False, offline=True)
        try:
            await context.route("**/*", _block_request)
            page = await context.new_page()
            page.set_default_timeout(_RENDER_TIMEOUT_MS)
            await page.set_content(html, wait_until="load")
            return await page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
        finally:
            await context.close()


async def shutdown_pdf_renderer() -> None:
    global _playwright, _browser
    async with _lock:
        if _browser is not None:
            await _browser.close()
            _browser = None
        if _playwright is not None:
            await _playwright.stop()
            _playwright = None
