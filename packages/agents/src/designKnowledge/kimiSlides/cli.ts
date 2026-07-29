#!/usr/bin/env node
import {
  assembleKimiDesignKnowledge,
  inspectKimiDesignKnowledgeCatalog
} from "./service.js";
import type { KimiKnowledgeOutputDialect } from "./types.js";

type CliOptions = {
  topic?: string;
  title?: string;
  pageType?: string;
  goal?: string;
  theme?: string;
  style?: string;
  output: KimiKnowledgeOutputDialect;
  root?: string;
  format: "prompt" | "json";
  maxChars?: number;
  list: boolean;
  help: boolean;
};

function usage() {
  return `Kimi Slides 设计知识 CLI

用法：
  pnpm design:knowledge -- --topic "AI 销售培训" --page-type cover --theme white-blue --style apple-minimal

参数：
  --topic <text>          页面主题或内容摘要
  --title <text>          页面标题
  --page-type <type>      cover / section / content / ending
  --goal <text>           页面用途
  --theme <id>            当前主题
  --style <id>            当前演示风格
  --output <dialect>      smartslide（默认）或 svg
  --root <path>           Kimi Slides 解压目录
  --max-chars <number>    提示词字符预算
  --format <format>       prompt（默认）或 json
  --list                  列出可用场景与设计系统
  --help                  显示帮助`;
}

function valueAfter(argv: string[], index: number, name: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} 缺少参数值`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: "smartslide",
    format: "prompt",
    list: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      continue;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--list") {
      options.list = true;
    } else if (argument === "--topic") {
      options.topic = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--title") {
      options.title = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--page-type") {
      options.pageType = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--goal") {
      options.goal = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--theme") {
      options.theme = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--style") {
      options.style = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--output") {
      const value = valueAfter(argv, index, argument);
      if (value !== "smartslide" && value !== "svg") {
        throw new Error("--output 只支持 smartslide 或 svg");
      }
      options.output = value;
      index += 1;
    } else if (argument === "--root") {
      options.root = valueAfter(argv, index, argument);
      index += 1;
    } else if (argument === "--format") {
      const value = valueAfter(argv, index, argument);
      if (value !== "prompt" && value !== "json") {
        throw new Error("--format 只支持 prompt 或 json");
      }
      options.format = value;
      index += 1;
    } else if (argument === "--max-chars") {
      const value = Number(valueAfter(argv, index, argument));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--max-chars 必须是正数");
      }
      options.maxChars = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return options;
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.list) {
    const summary = inspectKimiDesignKnowledgeCatalog(options.root);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.available) process.exitCode = 2;
    return;
  }

  const bundle = assembleKimiDesignKnowledge({
    topic: options.topic,
    title: options.title,
    pageType: options.pageType,
    slideGoal: options.goal,
    theme: options.theme,
    presentationStyle: options.style,
    outputDialect: options.output,
    maxPromptChars: options.maxChars,
    knowledgeRoot: options.root
  });
  if (options.format === "json") {
    console.log(JSON.stringify(bundle, null, 2));
  } else {
    console.log(bundle.prompt || bundle.warnings.join("\n"));
  }
  if (!bundle.available) process.exitCode = 2;
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Kimi Slides 设计知识 CLI 执行失败");
  console.error(usage());
  process.exitCode = 1;
}
