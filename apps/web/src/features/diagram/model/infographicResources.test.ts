import assert from "node:assert/strict";
import test from "node:test";

import { iconifyResourceUrl } from "./infographicResources.ts";

test("adds the Lucide collection for bare infographic icon names", () => {
  assert.equal(
    iconifyResourceUrl("folder"),
    "https://api.iconify.design/lucide/folder.svg",
  );
});

test("preserves explicit Iconify collection names", () => {
  assert.equal(
    iconifyResourceUrl("mdi:account-circle"),
    "https://api.iconify.design/mdi/account-circle.svg",
  );
  assert.equal(
    iconifyResourceUrl("heroicons/rocket-launch"),
    "https://api.iconify.design/heroicons/rocket-launch.svg",
  );
});

test("rejects malformed resource names instead of issuing noisy requests", () => {
  assert.equal(iconifyResourceUrl(""), null);
  assert.equal(iconifyResourceUrl("../folder"), null);
  assert.equal(iconifyResourceUrl("lucide:folder?color=red"), null);
});
