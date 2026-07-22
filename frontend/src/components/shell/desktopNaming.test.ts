import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sourceRoot = new URL("../../", import.meta.url);

function source(path: string) {
  return readFileSync(new URL(path, sourceRoot), "utf8");
}

test("desktop-facing surfaces do not expose the retired DeepDiagram product name", () => {
  const surfaces = [
    source("components/shell/AppShell.tsx"),
    source("components/shell/SystemPanels.tsx"),
    source("components/shell/shellModel.ts"),
    source("components/auth/LoginScreen.tsx"),
    source("pages/HomePage.tsx"),
    source("i18n.ts"),
    readFileSync(new URL("../../../index.html", import.meta.url), "utf8")
  ].join("\n");

  for (const retiredLabel of [
    "DeepDiagram Pro",
    "DeepDiagram 桌面",
    "DeepDiagram 帮助",
    "欢迎回到 DeepDiagram",
    ">DeepDiagram</span>"
  ]) {
    assert.doesNotMatch(surfaces, new RegExp(retiredLabel));
  }
});
