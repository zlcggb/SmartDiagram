/**
 * One-shot import rewriter after FSD directory consolidation.
 * Only rewrites import/export module specifiers; does not move files.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "src");

const files = execSync('find src -type f \\( -name "*.ts" -o -name "*.tsx" \\)', {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .map((f) => path.join(root, f));

/** Exact module specifier replacements (full string match after quote trim). */
const exact = new Map([
  // broken ppt shared paths from prior scripts
  ["../.@ppt-agent/shared", "@ppt-agent/shared"],
  [".@ppt-agent/shared/index.ts", "@ppt-agent/shared"],
  [".@ppt-agent/shared", "@ppt-agent/shared"],

  // diagram model
  ["@/features/diagram/model/chatStore", "@/features/diagram/model/chatStore"],
  ["../../lib/diagramHistory", "@/features/diagram/model/diagramHistory"],
  ["../lib/diagramHistory", "@/features/diagram/model/diagramHistory"],
  ["./diagramHistory.ts", "./diagramHistory.ts"],

  // auth: keep config implementation path; consumers may use either
  // Do NOT rewrite @/shared/lib/config/auth → @/shared/store/auth (circular).

  // icons / dialogs / ops / profile
  ["@/shared/ui/components/AppIconMarks", "@/components/brand/AppIconMarks"],
  ["../../components/brand/AppIconMarks", "@/components/brand/AppIconMarks"],
  ["../common/AppDialog", "@/components/common/AppDialog"],
  ["../ops/OpsDashboard", "@/components/ops/OpsDashboard"],
  ["../profile/ProfileWindow", "@/features/profile/ProfileWindow"],
  ["../profile/UserAvatar", "@/features/profile/UserAvatar"],
  ["../shell/MacWindow", "@/shared/ui/shell/MacWindow"],
  ["../settings/SettingsModal", "@/shared/ui/settings/SettingsModal"],

  // layout canvases (CanvasPanel was under components/layout)
  ["../canvas/ExportButton", "@/features/diagram/ui/ExportButton"],
  ["../canvas/SaveButton", "@/features/diagram/ui/SaveButton"],
  ["../canvas/ExcalidrawCanvas", "@/features/diagram/ui/ExcalidrawCanvas"],
  ["../canvas/MermaidCanvas", "@/features/diagram/ui/MermaidCanvas"],
  ["../canvas/FlowCanvas", "@/features/diagram/ui/FlowCanvas"],
  ["../canvas/MindmapCanvas", "@/features/diagram/ui/MindmapCanvas"],
  ["../canvas/ChartsCanvas", "@/features/diagram/ui/ChartsCanvas"],
  ["../canvas/DrawioCanvas", "@/features/diagram/ui/DrawioCanvas"],
  ["../canvas/InfographicCanvas", "@/features/diagram/ui/InfographicCanvas"],
  ["../canvas/ArtifactCanvas", "@/features/diagram/ui/ArtifactCanvas"],

  // pages / modules / recent work / ppt cross-links
  ["@/shared/ui/useRecentWork", "@/shared/ui/useRecentWork"],
  ["../modules/registry", "@/modules/registry"],
  ["../../modules/registry", "@/modules/registry"],
  ["../../ppt/lib/api", "@/features/ppt/lib/api"],
  ["../../ppt/shared", "@ppt-agent/shared"],
]);

/** Regex replacements applied to whole file content. */
const regexRules = [
  // DiagramWorkspace-style relative leftovers (only when path segment present)
  [
    /from\s+['"]\.\/components\/chat\/ChatPanel['"]/g,
    "from '@/features/diagram/ui/chat/ChatPanel'",
  ],
  [
    /from\s+['"]\.\/components\/layout\/CanvasPanel['"]/g,
    "from '@/features/diagram/ui/layout/CanvasPanel'",
  ],
  [
    /from\s+['"]\.\/components\/layout\/MobileTabBar['"]/g,
    "from '@/features/diagram/ui/layout/MobileTabBar'",
  ],
  [/from\s+['"]\.\/store\/chatStore['"]/g, "from '@/features/diagram/model/chatStore'"],
  [/from\s+['"]\.\/store\/authStore['"]/g, "from '@/shared/store/authStore'"],
  [/from\s+['"]\.\/hooks\/useIsMobile['"]/g, "from '@/shared/hooks/useIsMobile'"],

  // any remaining broken ppt shared forms
  [/from\s+['"][^'"]*\.@ppt-agent\/shared(?:\/index\.ts)?['"]/g, "from '@ppt-agent/shared'"],
  [/from\s+['"]\.@ppt-agent\/shared(?:\/index\.ts)?['"]/g, "from '@ppt-agent/shared'"],

  // ChatPanel nested AppDialog path from ui/chat
  [
    /from\s+['"]\.\.\/common\/AppDialog['"]/g,
    "from '@/components/common/AppDialog'",
  ],
  [
    /from\s+['"]\.\.\/\.\.\/common\/AppDialog['"]/g,
    "from '@/components/common/AppDialog'",
  ],
];

function rewriteSpecifier(spec) {
  if (exact.has(spec)) return exact.get(spec);
  return spec;
}

function transform(content) {
  let next = content;

  // Rewrite from/import()/export ... from '...'
  next = next.replace(
    /\b((?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+|))(['"])([^'"]+)\2/g,
    (full, prefix, quote, spec) => {
      const rewritten = rewriteSpecifier(spec);
      if (rewritten === spec) return full;
      return `${prefix}${quote}${rewritten}${quote}`;
    }
  );

  next = next.replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (full, quote, spec) => {
      const rewritten = rewriteSpecifier(spec);
      if (rewritten === spec) return full;
      return `import(${quote}${rewritten}${quote})`;
    }
  );

  for (const [re, replacement] of regexRules) {
    next = next.replace(re, replacement);
  }

  return next;
}

let changed = 0;
for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  const updated = transform(original);
  if (updated !== original) {
    fs.writeFileSync(file, updated);
    changed += 1;
    console.log("updated", path.relative(srcRoot, file));
  }
}

console.log(`Done. Updated ${changed} files.`);
