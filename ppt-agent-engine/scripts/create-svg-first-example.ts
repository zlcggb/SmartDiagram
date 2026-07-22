import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL ??= "file:D:/codex work/PPT-agent/ppt-agent-engine/prisma/dev.db";

const prisma = new PrismaClient();

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(
  x: number,
  y: number,
  value: string,
  options: {
    size?: number;
    fill?: string;
    weight?: number;
    width?: number;
    height?: number;
    anchor?: "start" | "middle" | "end";
  } = {}
) {
  const size = options.size ?? 24;
  const fill = options.fill ?? "#0F172A";
  const weight = options.weight ?? 500;
  const width = options.width ?? 420;
  const height = options.height ?? Math.ceil(size * 1.35);
  const anchor = options.anchor ?? "start";
  return `<text x="${x}" y="${y}" data-w="${width}" data-h="${height}" font-family="Microsoft YaHei, PingFang SC, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
}

function multiline(
  x: number,
  y: number,
  lines: string[],
  options: { size?: number; fill?: string; weight?: number; width?: number; gap?: number } = {}
) {
  const size = options.size ?? 21;
  const gap = options.gap ?? Math.ceil(size * 1.52);
  return lines.map((line, index) => text(x, y + index * gap, line, { ...options, size, height: gap + 6 })).join("\n");
}

function card(x: number, y: number, w: number, h: number, fill = "#FFFFFF", stroke = "#D8E6F2", rx = 22) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
}

function bar(x: number, y: number, w: number, color = "#0067B1") {
  return `<rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="${color}"/>`;
}

function svg(content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <rect x="0" y="0" width="1280" height="720" fill="#EEF6FB"/>
  <rect x="20" y="18" width="1240" height="684" rx="0" fill="none" stroke="#D5E5F0" stroke-width="1"/>
  ${content}
</svg>`;
}

const slides = [
  {
    title: "智慧展厅二期升级项目周报",
    slideGoal: "建立项目总体状态认知",
    keyMessage: "核心系统联调已通过，项目整体进度可控，但第三方素材与网络策略仍需闭环。",
    recommendedLayout: "hero-metric-cover",
    contentPoints: ["72小时稳定性测试通过", "施工完成率68%", "网络策略与备件库存待确认"],
    planJson: {
      title: "智慧展厅二期升级项目周报",
      pageGoal: "建立项目总体状态认知",
      keyMessage: "核心系统联调已通过，项目整体进度可控，但第三方素材与网络策略仍需闭环。",
      layoutType: "hero-metric-cover",
      contentBlocks: [
        { type: "summary", title: "本周结论", items: ["系统联调完成", "施工进度符合预期", "交付风险需客户协同"] },
        { type: "callout", title: "核心指标", items: ["72小时稳定性测试", "68%施工完成率"] }
      ],
      sourceFactIds: []
    },
    svgPreview: svg(`
      ${card(72, 78, 705, 340, "#FFFFFF", "#DCEAF5", 28)}
      ${text(110, 150, "项目周报", { size: 26, fill: "#0067B1", weight: 700, width: 250 })}
      ${text(110, 260, "智慧展厅二期升级项目周报", { size: 52, fill: "#101828", weight: 800, width: 620, height: 76 })}
      ${text(112, 365, "核心系统联调通过，施工进度符合预期；关键风险进入客户协同闭环。", { size: 24, fill: "#475467", weight: 700, width: 610, height: 70 })}
      ${card(825, 78, 360, 340, "#0067B1", "#0067B1", 28)}
      <circle cx="1005" cy="210" r="115" fill="none" stroke="#2B82C8" stroke-width="2"/>
      <circle cx="1005" cy="210" r="72" fill="none" stroke="#57A3DB" stroke-width="2"/>
      ${text(1005, 245, "72小时", { size: 78, fill: "#FFFFFF", weight: 800, width: 330, height: 96, anchor: "middle" })}
      ${text(1005, 305, "稳定性测试通过", { size: 22, fill: "#EAF6FF", weight: 700, width: 260, height: 34, anchor: "middle" })}
      ${bar(925, 345, 160, "#A8D8FF")}
      ${card(72, 462, 340, 150, "#FFFFFF", "#DCEAF5", 22)}
      ${bar(105, 494, 68)}
      ${text(105, 540, "汇报对象", { size: 24, fill: "#0067B1", weight: 800, width: 260 })}
      ${text(105, 580, "客户信息化负责人 / 销售总监 / PMO", { size: 20, fill: "#344054", width: 270, height: 42 })}
      ${card(470, 462, 340, 150, "#FFFFFF", "#DCEAF5", 22)}
      ${bar(503, 494, 68)}
      ${text(503, 540, "本周重点", { size: 24, fill: "#0067B1", weight: 800, width: 260 })}
      ${text(503, 580, "系统联调、施工进展、交付风险", { size: 20, fill: "#344054", width: 270, height: 42 })}
      ${card(868, 462, 317, 150, "#FFFFFF", "#DCEAF5", 22)}
      ${bar(901, 494, 68)}
      ${text(901, 540, "下一步", { size: 24, fill: "#0067B1", weight: 800, width: 230 })}
      ${text(901, 580, "上线评审与素材替换复测", { size: 20, fill: "#344054", width: 240, height: 42 })}
      ${text(72, 676, "PPT Agent Engine · SVG-first editable sample", { size: 15, fill: "#7A8B9A", width: 360 })}
      ${text(1190, 676, "01", { size: 22, fill: "#0067B1", weight: 800, width: 60 })}
    `)
  },
  {
    title: "本周核心进展概览",
    slideGoal: "展示关键里程碑",
    keyMessage: "技术、内容和现场施工三条主线均取得可汇报进展。",
    recommendedLayout: "hero-status-cards",
    contentPoints: ["主屏控制系统完成联调", "三个重点场景脚本初稿完成", "现场施工完成率68%"],
    planJson: {
      title: "本周核心进展概览",
      pageGoal: "展示关键里程碑",
      keyMessage: "技术、内容和现场施工三条主线均取得可汇报进展。",
      layoutType: "hero-status-cards",
      contentBlocks: [
        { type: "summary", title: "核心结论", items: ["系统联调通过", "内容脚本推进", "施工进度可控"] }
      ],
      sourceFactIds: []
    },
    svgPreview: svg(`
      ${text(72, 116, "本周核心进展概览", { size: 42, fill: "#101828", weight: 800, width: 600, height: 64 })}
      ${text(75, 162, "三条主线同步推进，关键节点已经具备向客户确认的基础。", { size: 22, fill: "#536273", width: 620, height: 38 })}
      ${card(72, 210, 1120, 130, "#073D68", "#073D68", 0)}
      ${bar(105, 248, 88, "#00A6D6")}
      ${text(105, 292, "核心结论", { size: 25, fill: "#FFFFFF", weight: 800, width: 240 })}
      ${text(105, 324, "系统联调、内容创作与现场施工均取得实质性进展，整体进度受控。", { size: 20, fill: "#DDF2FF", width: 850, height: 36 })}
      ${card(72, 395, 345, 200, "#FFFFFF", "#DCEAF5", 18)}
      ${bar(105, 432, 74)}
      ${text(105, 478, "系统联调", { size: 28, fill: "#0067B1", weight: 800, width: 240 })}
      ${multiline(105, 528, ["主屏控制系统已完成联调", "通过 72 小时连续稳定性测试", "可靠性指标达到上线前要求"], { size: 19, fill: "#1D2939", width: 280 })}
      ${card(468, 395, 345, 200, "#FFFFFF", "#DCEAF5", 18)}
      ${bar(501, 432, 74)}
      ${text(501, 478, "内容创作", { size: 28, fill: "#0067B1", weight: 800, width: 240 })}
      ${multiline(501, 528, ["3 个重点场景脚本完成初稿", "能源调度获客户认可", "城市运营获客户认可"], { size: 19, fill: "#1D2939", width: 280 })}
      ${card(864, 395, 328, 200, "#FFFFFF", "#DCEAF5", 18)}
      ${bar(897, 432, 74)}
      ${text(897, 478, "现场施工", { size: 28, fill: "#0067B1", weight: 800, width: 240 })}
      ${text(897, 548, "68%", { size: 58, fill: "#0067B1", weight: 800, width: 160 })}
      ${text(1012, 548, "完成率", { size: 21, fill: "#344054", weight: 700, width: 120 })}
      ${text(897, 586, "弱电桥架与主屏结构已就绪", { size: 19, fill: "#1D2939", width: 250 })}
      ${text(72, 676, "PPT Agent Engine · SVG-first editable sample", { size: 15, fill: "#7A8B9A", width: 360 })}
      ${text(1190, 676, "02", { size: 22, fill: "#0067B1", weight: 800, width: 60 })}
    `)
  },
  {
    title: "项目交付风险与应对策略",
    slideGoal: "明确风险闭环路径",
    keyMessage: "当前风险集中在第三方素材、网络策略和备件库存，需要客户与项目组共同闭环。",
    recommendedLayout: "risk-matrix",
    contentPoints: ["第三方素材交付延迟3天", "网络策略待客户确认", "LED备件库存待采购确认"],
    planJson: {
      title: "项目交付风险与应对策略",
      pageGoal: "明确风险闭环路径",
      keyMessage: "当前风险集中在第三方素材、网络策略和备件库存，需要客户与项目组共同闭环。",
      layoutType: "risk-matrix",
      contentBlocks: [
        { type: "table", title: "风险与行动", items: ["素材延迟", "网络策略", "备件库存"] }
      ],
      sourceFactIds: []
    },
    svgPreview: svg(`
      ${text(72, 110, "项目交付风险与应对策略", { size: 42, fill: "#101828", weight: 800, width: 650, height: 64 })}
      ${text(75, 156, "把风险从“待确认”推进到“有负责人、有时间、有闭环”。", { size: 22, fill: "#536273", width: 660 })}
      ${card(72, 215, 490, 380, "#FFFFFF", "#DCEAF5", 18)}
      ${bar(105, 252, 76, "#7B61FF")}
      ${text(105, 302, "风险概览", { size: 30, fill: "#7B61FF", weight: 800, width: 240 })}
      ${multiline(105, 365, ["核心风险：第三方内容供应商视频素材延迟 3 天", "潜在影响：最终联调窗口被压缩", "严重程度：中等（Medium）", "当前状态：已纳入重点监控"], { size: 23, fill: "#1D2939", width: 380, gap: 45 })}
      ${card(605, 215, 585, 380, "#FFFFFF", "#DCEAF5", 18)}
      ${bar(640, 252, 76, "#0067B1")}
      ${text(640, 302, "风险应对矩阵", { size: 30, fill: "#0067B1", weight: 800, width: 260 })}
      <rect x="640" y="340" width="500" height="52" fill="#073D68"/>
      ${text(665, 374, "应对策略", { size: 20, fill: "#FFFFFF", weight: 800, width: 150 })}
      ${text(828, 374, "关键动作", { size: 20, fill: "#FFFFFF", weight: 800, width: 150 })}
      ${text(990, 374, "预期结果", { size: 20, fill: "#FFFFFF", weight: 800, width: 150 })}
      <line x1="805" y1="340" x2="805" y2="548" stroke="#DCEAF5" stroke-width="2"/>
      <line x1="970" y1="340" x2="970" y2="548" stroke="#DCEAF5" stroke-width="2"/>
      <line x1="640" y1="444" x2="1140" y2="444" stroke="#DCEAF5" stroke-width="2"/>
      <line x1="640" y1="548" x2="1140" y2="548" stroke="#DCEAF5" stroke-width="2"/>
      ${text(665, 425, "窗口压缩", { size: 20, fill: "#1D2939", weight: 700, width: 120 })}
      ${text(828, 425, "调整测试窗口", { size: 20, fill: "#1D2939", width: 130 })}
      ${text(990, 425, "联调不断档", { size: 20, fill: "#1D2939", width: 130 })}
      ${text(665, 520, "策略未定", { size: 20, fill: "#1D2939", weight: 700, width: 120 })}
      ${text(828, 520, "客户确认端口", { size: 20, fill: "#1D2939", width: 130 })}
      ${text(990, 520, "远程运维可用", { size: 20, fill: "#1D2939", width: 130 })}
      ${text(72, 676, "PPT Agent Engine · SVG-first editable sample", { size: 15, fill: "#7A8B9A", width: 360 })}
      ${text(1190, 676, "03", { size: 22, fill: "#7B61FF", weight: 800, width: 60 })}
    `)
  },
  {
    title: "下周计划与下一步行动",
    slideGoal: "明确责任和时间节点",
    keyMessage: "下周围绕上线排期、素材替换、主屏复测和客户确认完成关键闭环。",
    recommendedLayout: "timeline-action",
    contentPoints: ["周一完成上线排期评审", "周三完成素材替换与主屏复测", "周五前确认网络策略与备件库存"],
    planJson: {
      title: "下周计划与下一步行动",
      pageGoal: "明确责任和时间节点",
      keyMessage: "下周围绕上线排期、素材替换、主屏复测和客户确认完成关键闭环。",
      layoutType: "timeline-action",
      contentBlocks: [
        { type: "timeline", title: "关键节点", items: ["周一", "周三", "周五前"] }
      ],
      sourceFactIds: []
    },
    svgPreview: svg(`
      ${text(72, 110, "下周计划与下一步行动", { size: 42, fill: "#101828", weight: 800, width: 650, height: 64 })}
      ${text(75, 156, "明确时间、责任方和客户确认事项，保证试运行节点不被风险拖慢。", { size: 22, fill: "#536273", width: 720 })}
      ${card(72, 214, 1120, 135, "#0067B1", "#0067B1", 0)}
      ${bar(105, 252, 85, "#FFFFFF")}
      ${text(105, 294, "核心目标", { size: 28, fill: "#FFFFFF", weight: 800, width: 240 })}
      ${text(105, 326, "完成上线排期评审、第三方素材替换与主屏复测，并推动客户确认关键策略。", { size: 21, fill: "#EAF6FF", width: 860, height: 36 })}
      <line x1="140" y1="455" x2="980" y2="455" stroke="#0067B1" stroke-width="5"/>
      <circle cx="190" cy="455" r="15" fill="#0067B1"/>
      <circle cx="500" cy="455" r="15" fill="#0067B1"/>
      <circle cx="810" cy="455" r="15" fill="#0067B1"/>
      ${card(105, 500, 250, 110, "#FFFFFF", "#DCEAF5", 18)}
      ${text(130, 540, "周一", { size: 28, fill: "#0067B1", weight: 800, width: 80 })}
      ${text(130, 580, "完成上线排期评审", { size: 20, fill: "#1D2939", width: 180 })}
      ${card(415, 500, 250, 110, "#FFFFFF", "#DCEAF5", 18)}
      ${text(440, 540, "周三", { size: 28, fill: "#0067B1", weight: 800, width: 80 })}
      ${text(440, 580, "素材替换与主屏复测", { size: 20, fill: "#1D2939", width: 185 })}
      ${card(725, 500, 250, 110, "#FFFFFF", "#DCEAF5", 18)}
      ${text(750, 540, "周五前", { size: 28, fill: "#0067B1", weight: 800, width: 120 })}
      ${text(750, 580, "确认网络策略与备件库存", { size: 20, fill: "#1D2939", width: 190 })}
      ${card(1000, 410, 190, 200, "#073D68", "#073D68", 20)}
      ${bar(1030, 448, 70, "#00A6D6")}
      ${text(1030, 496, "执行提示", { size: 25, fill: "#FFFFFF", weight: 800, width: 150 })}
      ${multiline(1030, 545, ["请客户信息化负责人", "参加风险闭环会议", "并确认端口策略"], { size: 18, fill: "#EAF6FF", width: 130, gap: 28 })}
      ${text(72, 676, "PPT Agent Engine · SVG-first editable sample", { size: 15, fill: "#7A8B9A", width: 360 })}
      ${text(1190, 676, "04", { size: 22, fill: "#0067B1", weight: 800, width: 60 })}
    `)
  }
];

async function main() {
  const project = await prisma.project.create({
    data: {
      name: `SVG-first 可编辑样例 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      reportType: "项目周报",
      audience: "客户信息化负责人、销售总监、项目管理办公室",
      purpose: "验证 SVG 页面设计可以转换为 PPT 原生文本框和形状",
      pageCount: slides.length,
      theme: "white-blue"
    }
  });

  const facts = await Promise.all(
    [
      "展厅主屏控制系统完成联调，并通过 72 小时连续运行稳定性测试。",
      "现场施工完成率约 68%，弱电桥架与主屏结构已安装就绪。",
      "第三方内容供应商视频素材交付延迟 3 天，可能压缩最终联调窗口。",
      "客户现场网络策略和 LED 备件库存仍需本周五前确认。"
    ].map((content, index) =>
      prisma.fact.create({
        data: {
          projectId: project.id,
          category: index < 2 ? "项目进展" : "风险问题",
          content,
          status: "confirmed",
          confidence: 0.9,
          sourceText: "本地 SVG-first 样例资料",
          sourceLocation: `样例事实 ${index + 1}`,
          canUseInPpt: true
        }
      })
    )
  );

  for (const [index, slide] of slides.entries()) {
    await prisma.slide.create({
      data: {
        projectId: project.id,
        sortOrder: index + 1,
        title: slide.title,
        slideGoal: slide.slideGoal,
        keyMessage: slide.keyMessage,
        contentPoints: JSON.stringify(slide.contentPoints),
        recommendedLayout: slide.recommendedLayout,
        status: "planned",
        planJson: JSON.stringify({ ...slide.planJson, sourceFactIds: facts.map((fact) => fact.id) }),
        svgPreview: slide.svgPreview,
        generationStatus: "svg-ready",
        slideSources: {
          create: facts.map((fact) => ({
            factId: fact.id,
            usageType: "supporting"
          }))
        }
      }
    });
  }

  console.log(JSON.stringify({ projectId: project.id, slideCount: slides.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
