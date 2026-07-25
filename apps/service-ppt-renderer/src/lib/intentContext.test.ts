import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectDto } from "@ppt-agent/shared";
import {
  buildConfirmedBrief,
  buildFactExtractionContext,
  selectAllExtractedFacts,
} from "./intentContext.js";

const project: ProjectDto = {
  id: "p1",
  name: "AI 工程师知识地图",
  reportType: "知识分享",
  audience: "转型中的开发工程师",
  purpose: "理解学习路径并开始实践",
  pageCount: 8,
  theme: "white-blue",
  mode: "topic",
  topic: "AI 应用工程师需要学习哪些知识",
  briefJson: {
    topic: "AI 应用工程师需要学习哪些知识",
    questions: [],
    answers: {},
    summary: "面向开发工程师，解释能力树、岗位与实践路径。",
    audience: "转型中的开发工程师",
    purpose: "理解学习路径并开始实践",
    pageCount: 8,
    questionSource: "ai"
  },
  researchJson: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

test("事实提取同时包含主题、已确认需求和用户资料", () => {
  const context = buildFactExtractionContext(project, "【文件：讲义.md】\n必须包含 RAG 与 Agent 工程化。");

  assert.match(context, /【创作主题】\nAI 应用工程师需要学习哪些知识/);
  assert.match(context, /【已确认需求】\n面向开发工程师/);
  assert.match(context, /【用户补充资料】\n【文件：讲义\.md】/);
  assert.ok(context.indexOf("【创作主题】") < context.indexOf("【已确认需求】"));
  assert.ok(context.indexOf("【已确认需求】") < context.indexOf("【用户补充资料】"));
});

test("没有需求摘要时使用已有受众和目标，不丢失上下文", () => {
  const context = buildFactExtractionContext(
    { ...project, briefJson: null, topic: null },
    "用户资料正文"
  );

  assert.match(context, /【创作主题】\nAI 工程师知识地图/);
  assert.match(context, /受众：转型中的开发工程师/);
  assert.match(context, /目标：理解学习路径并开始实践/);
  assert.match(context, /【用户补充资料】\n用户资料正文/);
});

test("提取后的事实默认全部勾选，且不修改模型原始结果", () => {
  const drafts = [
    { content: "事实 A", canUseInPpt: false },
    { content: "事实 B", canUseInPpt: true },
  ];

  const selected = selectAllExtractedFacts(drafts);

  assert.deepEqual(
    selected.map((fact) => fact.canUseInPpt),
    [true, true]
  );
  assert.equal(drafts[0]?.canUseInPpt, false);
});

test("确认需求只根据现有问题和回答生成确定性快照", () => {
  const confirmed = buildConfirmedBrief(
    {
      ...project,
      briefJson: {
        topic: project.topic ?? project.name,
        questionSource: "ai",
        questions: [
          { id: "target_audience", question: "这份内容主要讲给谁？" },
          { id: "learning_goal", question: "希望听完后获得什么？" },
          { id: "page_plan", question: "预期多少页？" },
          { id: "visual_rule", question: "视觉上有哪些禁忌？" }
        ],
        answers: {}
      }
    },
    {
      target_audience: "有开发经验的 AI 初学者",
      learning_goal: "掌握岗位能力与学习路径",
      page_plan: "8-10 页",
      visual_rule: "不要大段文字"
    }
  );

  assert.equal(confirmed.questionSource, "ai");
  assert.equal(confirmed.audience, "有开发经验的 AI 初学者");
  assert.equal(confirmed.purpose, "掌握岗位能力与学习路径");
  assert.equal(confirmed.pageCount, 10);
  assert.match(confirmed.summary ?? "", /这份内容主要讲给谁？：有开发经验的 AI 初学者/);
  assert.match(confirmed.summary ?? "", /视觉上有哪些禁忌？：不要大段文字/);
  assert.deepEqual(confirmed.answers, {
    target_audience: "有开发经验的 AI 初学者",
    learning_goal: "掌握岗位能力与学习路径",
    page_plan: "8-10 页",
    visual_rule: "不要大段文字"
  });
});
