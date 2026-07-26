import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sourceRoot = new URL("../../../", import.meta.url);

function source(path: string) {
  return readFileSync(new URL(path, sourceRoot), "utf8");
}

test("desktop-facing surfaces do not expose retired product names", () => {
  const surfaces = [
    source("shared/ui/shell/AppShell.tsx"),
    source("shared/ui/shell/SystemPanels.tsx"),
    source("shared/ui/shell/shellModel.ts"),
    source("components/auth/LoginScreen.tsx"),
    source("pages/home/HomePage.tsx"),
    source("app/i18n.ts"),
    readFileSync(new URL("../../../../index.html", import.meta.url), "utf8")
  ].join("\n");

  for (const retiredLabel of [
    "DeepDiagram Pro",
    "DeepDiagram 桌面",
    "DeepDiagram 帮助",
    "欢迎回到 DeepDiagram",
    ">DeepDiagram</span>",
    "SmartDiagram Pro"
  ]) {
    assert.doesNotMatch(surfaces, new RegExp(retiredLabel));
  }
});
