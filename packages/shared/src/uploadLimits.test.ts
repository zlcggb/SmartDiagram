import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MATERIAL_UPLOAD_LIMIT_MIB,
  materialUploadLimitBytes,
  resolveMaterialUploadLimitMib
} from "./uploadLimits.js";

test("资料上传上限默认是 50 MiB", () => {
  assert.equal(DEFAULT_MATERIAL_UPLOAD_LIMIT_MIB, 50);
  assert.equal(materialUploadLimitBytes(undefined), 50 * 1024 * 1024);
});

test("资料上传上限可向下配置，非法或过大的值回退到 50 MiB", () => {
  assert.equal(resolveMaterialUploadLimitMib("20"), 20);
  assert.equal(resolveMaterialUploadLimitMib("0"), 50);
  assert.equal(resolveMaterialUploadLimitMib("100"), 50);
  assert.equal(resolveMaterialUploadLimitMib("invalid"), 50);
});
