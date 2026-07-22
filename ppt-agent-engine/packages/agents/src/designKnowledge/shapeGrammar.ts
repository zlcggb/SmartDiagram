/**
 * 可编辑 SVG 的形状语法。这里存“怎么画”，页面模板只存“何时用、放哪里”。
 * 所有规则都避开 mask/filter/rotate 等 PowerPoint 转换不稳定的能力。
 */
export const SHAPE_GRAMMAR = {
  layeredPanel: [
    "用 2-3 个错位 rect/polygon 叠成内容容器：底层色片、边框层、正文层",
    "至少加入一个切角、侧边色带、顶部标签槽或内嵌图标圆章，禁止只画白色圆角矩形",
    "容器内部按标题/证据/强调词分层，留白必须大于装饰密度"
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
    "关键结论放入横向色带、折线标签或桥接梁，不得作为普通副标题悬空",
    "色带长度与结论重要度对应，允许局部关键词用强调色分成独立 text"
  ],
  ambientBackground: [
    "背景使用 60/30/10 配色：大面积底色、局部柔色块、少量强调色",
    "使用低透明度 circle/path/grid line 构造空间，不得使用大面积渐变滤镜或网页玻璃按钮",
    "装饰必须服务阅读方向：引导线、轨道、坐标网格或章节编号只能选一种主母题"
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
  "把网页按钮、导航栏或后台仪表盘当作 PPT",
  "每个模块同尺寸、同颜色、同权重",
  "用装饰性折线冒充信息图",
  "为了填满画布而重复结论或补写无来源数字"
] as const;

