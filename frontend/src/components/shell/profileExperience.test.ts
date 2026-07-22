import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const authSource = readFileSync(new URL("../../config/auth.ts", import.meta.url), "utf8");
const authStoreSource = readFileSync(new URL("../../store/authStore.ts", import.meta.url), "utf8");
const desktopStoreSource = readFileSync(new URL("../../store/desktopStore.ts", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const profileWindowSource = readFileSync(new URL("../profile/ProfileWindow.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../../pages/HomePage.tsx", import.meta.url), "utf8");

test("profile updates persist the renewed user and avatar in the shared session", () => {
  assert.match(authSource, /avatar_url\?:\s*string\s*\|\s*null/);
  assert.match(authSource, /\/api\/auth\/me\/profile/);
  assert.match(authSource, /method:\s*'PATCH'/);
  assert.match(authSource, /writeAuthSession\(refreshed\)/);
  assert.match(authStoreSource, /const refreshed = await validateAuthSession\(session\)/);
  assert.match(authStoreSource, /set\(\{ session: refreshed, checking: false \}\)/);
});

test("the menu and desktop reuse a real avatar instead of a role initial", () => {
  assert.match(shellSource, /<UserAvatar user=\{session\?\.user\} size=\{20\}/);
  assert.doesNotMatch(shellSource, /userLabel\.charAt/);
  assert.match(homeSource, /<UserAvatar user=\{session\.user\} size=\{38\}/);
});

test("the account popover opens an editable global profile window", () => {
  assert.match(desktopStoreSource, /"profile"/);
  assert.match(shellSource, /openWindow\("profile"\)/);
  assert.match(shellSource, /<ProfileWindow onClose=\{closeShellWindow\}/);
  assert.match(profileWindowSource, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(profileWindowSource, /保存更改/);
  assert.match(profileWindowSource, /移除照片/);
});
