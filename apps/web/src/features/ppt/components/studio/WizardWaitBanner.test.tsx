import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WizardWaitBanner } from "./WizardWaitBanner.js";

test("阶段等待条同时提供取消流程和立即继续，并把取消放在左侧", () => {
  const html = renderToStaticMarkup(
    <WizardWaitBanner
      wizardState={{ kind: "waitingAfterSearch", message: "检索完成" }}
      secondsLeft={5}
      onCancel={() => undefined}
      onSkip={() => undefined}
    />
  );

  assert.match(html, /取消流程/);
  assert.match(html, /立即继续/);
  assert.ok(html.indexOf("取消流程") < html.indexOf("立即继续"));
});
