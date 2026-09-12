import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePartialSlidePlan } from "./partialJsonParser";

describe("parsePartialSlidePlan", () => {
  it("空文本时返回空状态", () => {
    const result = parsePartialSlidePlan("");
    assert.equal(result.hasContent, false);
    assert.equal(result.title, null);
    assert.equal(result.contentBlocks.length, 0);
  });

  it("当仅流出 title 字段时能准确提取", () => {
    const raw = '{\n  "title": "从四级刚过到雅思能力迁移",\n  "pageG';
    const result = parsePartialSlidePlan(raw);
    assert.equal(result.hasContent, true);
    assert.equal(result.title, "从四级刚过到雅思能力迁移");
    assert.equal(result.contentBlocks.length, 0);
  });

  it("当 title 在字符串中间截断时也能提取部分标题", () => {
    const raw = '{\n  "title": "四级冲刺雅思备考';
    const result = parsePartialSlidePlan(raw);
    assert.equal(result.hasContent, true);
    assert.equal(result.title, "四级冲刺雅思备考");
  });

  it("当流出 title 和 keyMessage 时均能提取", () => {
    const raw = `{\n  "title": "在职学员备考路径",\n  "keyMessage": "建立复盘机制与专项突破",\n  "layoutType": "split"`;
    const result = parsePartialSlidePlan(raw);
    assert.equal(result.title, "在职学员备考路径");
    assert.equal(result.keyMessage, "建立复盘机制与专项突破");
    assert.equal(result.layoutType, "split");
  });

  it("当流出部分 contentBlocks 时能提取卡片与条目", () => {
    const raw = `{
      "title": "四步冲刺法",
      "keyMessage": "重点在听力与写作",
      "layoutType": "cards",
      "contentBlocks": [
        {
          "type": "block",
          "title": "现状诊断",
          "items": [
            "四级基础词汇已达标",
            "学术场景听力薄弱"
          ]
        },
        {
          "type": "block",
          "title": "专项突破",
          "items": [
            "每天精听真题 Section 3"
          ]
    `;
    const result = parsePartialSlidePlan(raw);
    assert.equal(result.hasContent, true);
    assert.equal(result.title, "四步冲刺法");
    assert.equal(result.contentBlocks.length, 2);
    assert.equal(result.contentBlocks[0]?.title, "现状诊断");
    assert.equal(result.contentBlocks[0]?.items.length, 2);
    assert.equal(result.contentBlocks[1]?.title, "专项突破");
    assert.equal(result.contentBlocks[1]?.items[0], "每天精听真题 Section 3");
  });

  it("能容忍 markdown ```json 代码块包裹", () => {
    const raw = "```json\n{\n  \"title\": \"包裹代码块测试\",\n  \"keyMessage\": \"测试内容\"\n";
    const result = parsePartialSlidePlan(raw);
    assert.equal(result.hasContent, true);
    assert.equal(result.title, "包裹代码块测试");
    assert.equal(result.keyMessage, "测试内容");
  });

  it("能提取 designGuide 视觉指导信息", () => {
    const raw = `{
      "title": "视觉版式测试",
      "designGuide": {
        "composition": "toc-rail 横向步道",
        "background": "浅暖灰微米色"
      }
    `;
    const result = parsePartialSlidePlan(raw);
    assert.equal(result.designGuide?.composition, "toc-rail 横向步道");
    assert.equal(result.designGuide?.background, "浅暖灰微米色");
  });
});
