import fs from "node:fs";
import path from "node:path";
import { fontsDir, workspaceRoot } from "./paths.js";

export const subtitleFontsSourceDir = path.join(workspaceRoot, "apps", "api", "assets", "fonts");

const fontDefinitions = [
  {
    id: "noto-sans-cjk-sc",
    label: "Noto Sans CJK SC（思源黑体）",
    family: "Noto Sans CJK SC",
    license: "SIL Open Font License 1.1",
    fontFile: "NotoSansCJKsc-Regular.otf",
    licenseFile: "NotoSansCJK_LICENSE.txt"
  }
] as const;

export interface SubtitleFont {
  id: string;
  label: string;
  family: string;
  license: string;
  fontPath: string;
  licensePath: string;
}

export function ensureSubtitleFonts(targetDir = fontsDir, sourceDir = subtitleFontsSourceDir): SubtitleFont[] {
  fs.mkdirSync(targetDir, { recursive: true });
  return fontDefinitions.map((font) => {
    const sourceFontPath = path.join(sourceDir, font.fontFile);
    const sourceLicensePath = path.join(sourceDir, font.licenseFile);
    if (!fs.existsSync(sourceFontPath) || !fs.existsSync(sourceLicensePath)) {
      throw new Error(`缺少字幕字体或许可证：${font.fontFile}`);
    }
    const fontPath = path.join(targetDir, font.fontFile);
    const licensePath = path.join(targetDir, font.licenseFile);
    if (!fs.existsSync(fontPath)) fs.copyFileSync(sourceFontPath, fontPath);
    if (!fs.existsSync(licensePath)) fs.copyFileSync(sourceLicensePath, licensePath);
    return { ...font, fontPath, licensePath };
  });
}

export function subtitleFontCatalog() {
  return ensureSubtitleFonts().map(({ id, label, family, license }) => ({ id, label, family, license }));
}

export function resolveSubtitleFont(fontId: string) {
  const font = ensureSubtitleFonts().find((item) => item.id === fontId);
  if (!font) throw new Error(`不支持的字幕字体：${fontId}`);
  return font;
}
