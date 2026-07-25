import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./macShell.css", import.meta.url), "utf8");

test("desktop menu bar uses the Apple system font stack and white foreground", () => {
  assert.match(css, /--mac-system-font:\s*-apple-system,\s*BlinkMacSystemFont/);
  assert.match(css, /--mac-menubar-foreground:\s*rgba\(255,\s*255,\s*255,/);
  assert.match(css, /\.mac-menu-bar\s*\{[^}]*font-family:\s*var\(--mac-system-font\)/s);
  assert.match(css, /\.mac-app-shell\[data-area='desktop'\] \.mac-menu-bar\s*\{[^}]*color:\s*var\(--mac-menubar-foreground\)/s);
});

test("menu bar controls inherit the contextual foreground color", () => {
  assert.match(css, /\.mac-menu-trigger\s*\{[^}]*color:\s*inherit/s);
  assert.match(css, /\.mac-menu-status-button,[\s\S]*?\.mac-menu-user-button\s*\{[^}]*color:\s*inherit/s);
});

test("application content and shell overlays stay below the menu bar safe area", () => {
  assert.match(css, /--mac-menu-bar-height:\s*28px/);
  assert.match(
    css,
    /\.mac-app-content\s*\{[^}]*position:\s*absolute[^}]*inset:\s*var\(--mac-menu-bar-height\)\s+0\s+0[^}]*transform:\s*translateZ\(0\)/s
  );
  assert.match(
    css,
    /\.mac-window-backdrop\s*\{[^}]*inset:\s*var\(--mac-menu-bar-height\)\s+0\s+0/s
  );
  assert.match(
    css,
    /\.mac-spotlight-backdrop\s*\{[^}]*inset:\s*var\(--mac-menu-bar-height\)\s+0\s+0/s
  );
});

test("menu bar stays fully transparent across desktop, diagram, and PPT", () => {
  assert.match(
    css,
    /\.mac-menu-bar\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none[^}]*-webkit-backdrop-filter:\s*none[^}]*backdrop-filter:\s*none/s
  );
  assert.doesNotMatch(css, /\.mac-app-shell\[data-area='(?:desktop|diagram|ppt)'\] \.mac-menu-bar\s*\{[^}]*(?:background|box-shadow|backdrop-filter)\s*:/s);
});

test("diagram and PPT safe areas do not expose a shared gray veil", () => {
  assert.doesNotMatch(
    css,
    /\.mac-app-shell:not\(\[data-area='desktop'\]\)\s*\{[^}]*background:\s*#f3f6f9/s
  );
  assert.match(
    css,
    /\.mac-app-shell\[data-area='diagram'\]\[data-canvas-mode='light'\]\s*\{[^}]*background:\s*#f8fafc/s
  );
  assert.match(
    css,
    /\.mac-app-shell\[data-area='diagram'\]\[data-canvas-mode='dark'\]\s*\{[^}]*background:\s*#020617/s
  );
  assert.match(
    css,
    /\.mac-app-shell\[data-area='ppt-home'\],[\s\S]*?\.mac-app-shell\[data-area='ppt-project'\]\s*\{[^}]*background:\s*#f9fbfc/s
  );
});

test("desktop wallpaper bleeds behind the transparent menu bar", () => {
  assert.match(
    css,
    /\.mac-app-shell\[data-area='desktop'\] \.mac-app-content,[\s\S]*?\.mac-app-shell\[data-area='desktop'\] \.mac-desktop\s*\{[^}]*overflow:\s*visible/s
  );
  assert.match(
    css,
    /\.mac-app-shell\[data-area='desktop'\] \.mac-desktop__wallpaper,[\s\S]*?\.mac-desktop__scrim\s*\{[^}]*top:\s*calc\(-1 \* var\(--mac-menu-bar-height\)\)/s
  );
});

test("PPT 首页在固定高度宿主内拥有独立纵向滚动区", () => {
  assert.match(
    css,
    /\.mac-app-shell\[data-area='ppt-home'\] \.ppt-root > \.home-shell\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s
  );
});

test("PPT 导演页在固定高度宿主内由项目主内容区滚动", () => {
  assert.match(
    css,
    /\.mac-app-shell\[data-area='ppt-project'\] \.ppt-root > \.studio-shell\s*\{[^}]*display:\s*flex[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s
  );
  assert.match(
    css,
    /\.mac-app-shell\[data-area='ppt-project'\] \.studio-shell > main\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s
  );
  assert.match(
    css,
    /\.mac-app-shell\[data-area='ppt-project'\] \.studio-shell\.intent-route > main,[\s\S]*?\.studio-shell\.structure-route > main\s*\{[^}]*overflow:\s*hidden/s
  );
});
