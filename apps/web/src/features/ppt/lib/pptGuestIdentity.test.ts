import assert from "node:assert/strict";
import test from "node:test";
import {
  GUEST_TOKEN_STORAGE_KEY,
  getOrCreatePptGuestToken,
  isValidPptGuestToken
} from "./pptGuestIdentity.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

test("访客令牌为高熵值并稳定保存在当前浏览器", () => {
  const storage = memoryStorage();
  const cryptoLike = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      const bytes = array as Uint8Array;
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return array;
    }
  };
  const first = getOrCreatePptGuestToken(storage, cryptoLike);
  const second = getOrCreatePptGuestToken(storage, cryptoLike);

  assert.equal(first, second);
  assert.equal(storage.getItem(GUEST_TOKEN_STORAGE_KEY), first);
  assert.equal(isValidPptGuestToken(first), true);
  assert.equal(isValidPptGuestToken("anonymous"), false);
});

