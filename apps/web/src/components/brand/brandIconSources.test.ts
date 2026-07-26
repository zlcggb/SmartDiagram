import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sourceRoot = new URL("../../", import.meta.url);

function source(path: string) {
  return readFileSync(new URL(path, sourceRoot), "utf8");
}

test("Dock and desktop module artwork use shared SVG marks instead of legacy PNG files", () => {
  const macIcons = source("shared/ui/macos/MacOSIcons.tsx");
  const appShell = source("shared/ui/shell/AppShell.tsx");

  assert.match(macIcons, /SmartDiagramIconMark/);
  assert.match(macIcons, /PptAgentIconMark/);
  assert.doesNotMatch(macIcons, /mindmap-384\.png/);
  assert.doesNotMatch(macIcons, /presentation-384\.png/);
  assert.match(appShell, /const MenuBarArtwork/);
  assert.match(appShell, /const menuBarArtworkSize = isDesktop \? 22 : 18/);
  assert.match(appShell, /<MenuBarArtwork size=\{menuBarArtworkSize\}/);
});

test("PPT page branding delegates to the same mark used by the shell", () => {
  const pptLogo = source("features/ppt/components/AppLogo.tsx");

  assert.match(pptLogo, /import \{ PptAgentIconMark \}/);
  assert.match(pptLogo, /<PptAgentIconMark/);
});

test("SmartDiagram brand surfaces reuse the shared purple pen mark", () => {
  const canvasPanel = source("features/diagram/ui/layout/CanvasPanel.tsx");
  const chatPanel = source("features/diagram/ui/chat/ChatPanel.tsx");

  assert.match(canvasPanel, /import \{ SmartDiagramIconMark \}/);
  assert.doesNotMatch(canvasPanel, /<PenTool/);
  assert.match(chatPanel, /import \{ SmartDiagramIconMark \}/);
  assert.ok((chatPanel.match(/<SmartDiagramIconMark/g) ?? []).length >= 2);
});
