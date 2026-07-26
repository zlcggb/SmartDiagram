/**
 * 可编辑 SVG 的形状语法。这里存“怎么画”，页面模板只存“何时用、放哪里”。
 * 所有规则都避开 mask/filter/rotate 等 PowerPoint 转换不稳定的能力。
 */
export const SHAPE_GRAMMAR = {
  layeredPanel: [
    "内容容器优先使用单层浅表面、1px 低对比边框和 12-20px 圆角，通过面积与留白区分主次",
    "强调依次使用标题字重、关键词着色或 48-88px 顶部短细线；禁止整高侧边色条和无意义错位叠片",
    "容器内部按标题/证据/强调词分层，内边距 24-32px，留白必须大于装饰密度"
  ],
  visualNexus: [
    "中心锚点由同心 circle、短 path 和关键词组成，直径 92-150px",
    "用 2-4 条 path/polyline 连接到内容区域；连接线必须有方向、汇聚或递进含义",
    "锚点是结论的视觉压缩，不得做成无意义按钮"
  ],
  editorialTitle: [
    "标题左对齐或沿视觉轴错位排布，避免默认水平居中",
    "可配 01/章节标签、短横线、关键词强调色，但不得制造用户未提供的业务数字",
    "标题区宽度控制在 460-760px，至少与主视觉形成一个明显轴线"
  ],
  evidenceStrip: [
    "关键结论作为编辑式导语或独立文字锚点，不默认放入高饱和横向色带",
    "使用字阶、留白和局部关键词强调建立层级，必要时只加一条短细分隔线"
  ],
  ambientBackground: [
    "背景以主题纯色或单一浅表面分区为主，强调色只占很小面积",
    "同页最多选择一种低对比装饰语法：引导线、轨道、坐标基线或局部柔色面",
    "禁止泛用光晕、巨型透明圆、无意义渐变和网页玻璃按钮"
  ],
  dataGlyph: [
    "用原生 rect/line/path/circle 组成微型柱图、趋势线、环图或刻度，不用图片",
    "图形必须映射输入内容；没有真实数字时只能表达分类、关系或强弱，不得伪造数值"
  ]
} as const;

export const SVG_EDITABILITY_CONTRACT = [
  "只用 rect/text/tspan/line/circle/ellipse/path/polygon/polyline/g",
  "所有文字保留为 text/tspan；每个 text 都带 data-w 与 data-h",
  "transform 只允许 translate(x,y)，颜色只用 HEX 与 fill-opacity/stroke-opacity",
  "按语义分组并保留 id：background-layer、title-zone、visual-anchor、content-zone-N、connector-layer",
  "禁止 mask/filter/foreignObject/textPath/style/class/rotate/scale/matrix"
] as const;

export const VISUAL_ANTI_PATTERNS = [
  "纯文字平铺",
  "标题居中 + 副标题 + 等宽白卡片",
  "整页只有圆角矩形和文字",
  "卡片附着 4-20px 且覆盖高度 70% 以上的整高强调色条",
  "用大量胶囊标签、光晕或错位叠片制造虚假层级",
  "主视觉、独立内容区或文字为了装饰感相互压边遮挡",
  "把网页按钮、导航栏或后台仪表盘当作 PPT",
  "每个模块同尺寸、同颜色、同权重",
  "用装饰性折线冒充信息图",
  "为了填满画布而重复结论或补写无来源数字"
] as const;
