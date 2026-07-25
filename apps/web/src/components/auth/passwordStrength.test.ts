import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePasswordStrength } from "./passwordStrength.ts";

test("evaluatePasswordStrength marks empty password", () => {
  assert.equal(evaluatePasswordStrength("").level, "empty");
});

test("evaluatePasswordStrength detects weak passwords", () => {
  assert.equal(evaluatePasswordStrength("1234567").level, "weak");
  assert.equal(evaluatePasswordStrength("abcdefgh").level, "weak");
});

test("evaluatePasswordStrength rewards mixed character classes", () => {
  assert.equal(evaluatePasswordStrength("Abcdefgh").level, "fair");
  assert.equal(evaluatePasswordStrength("Abcdefg1").level, "good");
  assert.equal(evaluatePasswordStrength("Abcdefg1!").level, "strong");
});
