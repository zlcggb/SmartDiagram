import fs from "node:fs";
import JSZip from "jszip";
import { buildOoxmlCustomGeometry, decodeSvgShapeMetadata, type EditableGradient } from "./svgPathGeometry.js";

function gradientXml(gradient: EditableGradient) {
  const stops = [...gradient.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => {
      const pos = Math.round(Math.max(0, Math.min(1, stop.offset)) * 100000);
      const transparency = Math.max(0, Math.min(100, stop.transparency ?? 0));
      const alpha = Math.round((100 - transparency) * 1000);
      return `<a:gs pos="${pos}"><a:srgbClr val="${stop.color}">${alpha < 100000 ? `<a:alpha val="${alpha}"/>` : ""}</a:srgbClr></a:gs>`;
    })
    .join("");
  const angle = ((Math.round(gradient.angle) % 21600000) + 21600000) % 21600000;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${angle}" scaled="1"/></a:gradFill>`;
}

function patchShape(shapeXml: string) {
  const nameMatch = shapeXml.match(/<p:cNvPr\b[^>]*\bname="(SVGCG_[A-Za-z0-9_-]+)"/);
  if (!nameMatch?.[1]) return shapeXml;
  const metadata = decodeSvgShapeMetadata(nameMatch[1]);
  if (!metadata) return shapeXml;

  let next = shapeXml.replace(`name="${nameMatch[1]}"`, 'name="SVG editable shape"');
  if (metadata.path) {
    const extent = shapeXml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
    const geometry = buildOoxmlCustomGeometry(
      metadata.path,
      Number.parseInt(extent?.[1] ?? "100000", 10),
      Number.parseInt(extent?.[2] ?? "100000", 10)
    );
    if (geometry) {
      next = next.replace(/<a:prstGeom\b[^>]*>[\s\S]*?<\/a:prstGeom>/, geometry);
    }
  }
  if (metadata.gradient?.stops.length) {
    next = next.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, gradientXml(metadata.gradient));
  }
  return next;
}

/** PptxGenJS 无自由曲线/渐变 API，写文件后把标记形状升级为 OOXML custGeom/gradFill。 */
export async function postprocessEditableSvgGeometry(outputPath: string) {
  const source = fs.readFileSync(outputPath);
  const zip = await JSZip.loadAsync(source);
  let changed = false;

  for (const [name, entry] of Object.entries(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name) || entry.dir) continue;
    const xml = await entry.async("string");
    const patched = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, patchShape);
    if (patched !== xml) {
      zip.file(name, patched);
      changed = true;
    }
  }

  if (!changed) return false;
  const result = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(outputPath, result);
  return true;
}
