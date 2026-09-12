import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceFocusShortcut,
  readWorkspaceFocusMode,
  WORKSPACE_FOCUS_MODE_KEY,
  writeWorkspaceFocusMode
} from "./workspaceFocusMode.js";

test("沉浸模式偏好可以安全读取并写回", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };

  assert.equal(readWorkspaceFocusMode(storage), false);
  writeWorkspaceFocusMode(storage, true);
  assert.equal(values.get(WORKSPACE_FOCUS_MODE_KEY), "true");
  assert.equal(readWorkspaceFocusMode(storage), true);
  writeWorkspaceFocusMode(storage, false);
  assert.equal(readWorkspaceFocusMode(storage), false);
});

test("浏览器拒绝访问存储时回退为普通模式", () => {
  const storage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    }
  };

  assert.equal(readWorkspaceFocusMode(storage), false);
  assert.doesNotThrow(() => writeWorkspaceFocusMode(storage, true));
});

test("⌘⇧F 只在非编辑控件中切换沉浸模式", () => {
  assert.equal(
    isWorkspaceFocusShortcut({ key: "F", metaKey: true, shiftKey: true }),
    true
  );
  assert.equal(
    isWorkspaceFocusShortcut({ key: "f", metaKey: false, shiftKey: true }),
    false
  );
  assert.equal(
    isWorkspaceFocusShortcut({
      key: "f",
      metaKey: true,
      shiftKey: true,
      target: { tagName: "INPUT" }
    }),
    false
  );
  assert.equal(
    isWorkspaceFocusShortcut({
      key: "f",
      metaKey: true,
      shiftKey: true,
      target: { isContentEditable: true }
    }),
    false
  );
});
