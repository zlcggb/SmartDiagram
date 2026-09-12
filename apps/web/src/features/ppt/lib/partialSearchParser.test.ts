import test from "node:test";
import assert from "node:assert/strict";
import { parsePartialSlideSearch } from "./partialSearchParser.ts";

test("parsePartialSlideSearch: parses early streaming text with queries", () => {
  const delta = `
{
  "queries": [
    "IELTS 官方评分标准 听力 阅读 写作 口语 评分维度",
    "IELTS Academic test format listening reading writing speaking"
  `;
  const parsed = parsePartialSlideSearch(delta);
  assert.equal(parsed.hasContent, true);
  assert.equal(parsed.queries.length, 2);
  assert.equal(parsed.queries[0], "IELTS 官方评分标准 听力 阅读 写作 口语 评分维度");
});

test("parsePartialSlideSearch: parses intermediate streaming text with results", () => {
  const delta = `
{
  "queries": [
    "IELTS 写作 口语"
  ],
  "results": [
    {
      "title": "雅思四项技能与考试任务结构",
      "snippet": "待核验线索：雅思围绕听、说、读、写四项英语技能设置任务。",
      "selected": true
    },
    {
      "title": "口语与写作核心提分路径",
      "snippet": "针对在职人士建立
  `;
  const parsed = parsePartialSlideSearch(delta);
  assert.equal(parsed.hasContent, true);
  assert.equal(parsed.queries.length, 1);
  assert.ok(parsed.results.length >= 1);
  assert.equal(parsed.results[0].title, "雅思四项技能与考试任务结构");
});

test("parsePartialSlideSearch: handles empty or invalid text safely", () => {
  const empty = parsePartialSlideSearch("");
  assert.equal(empty.hasContent, false);
  assert.equal(empty.queries.length, 0);
  assert.equal(empty.results.length, 0);

  const random = parsePartialSlideSearch("some unexpected raw content");
  assert.equal(random.hasContent, false);
});
