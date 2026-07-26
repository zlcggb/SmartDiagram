import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePasswordStrength,
  passwordStrengthBarColors,
  type PasswordStrengthLevel,
} from "./passwordStrength.ts";

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

test("password strength colors cover every possible level", () => {
  const levels: PasswordStrengthLevel[] = ["empty", "weak", "fair", "good", "strong"];
  for (const level of levels) {
    assert.equal(typeof passwordStrengthBarColors[level], "string");
    assert.notEqual(passwordStrengthBarColors[level], "");
  }
});
