import type { TextLine } from "../engine/types";

export const FREETEXT_FONTS = [
  { id: "Helv", label: "Sans (Helvetica)", css: "Helvetica, Arial, 'Liberation Sans', sans-serif" },
  { id: "TiRo", label: "Serif (Times)", css: "'Times New Roman', Times, 'Liberation Serif', serif" },
  { id: "Cour", label: "Mono (Courier)", css: "'Courier New', Courier, 'Liberation Mono', monospace" },
] as const;

export function cssForFreeText(id: string | undefined) {
  return FREETEXT_FONTS.find((f) => f.id === id)?.css ?? FREETEXT_FONTS[0].css;
}

export function cssForEditFont(font: string, line: TextLine) {
  if (font === "Helvetica") return FREETEXT_FONTS[0].css;
  if (font === "Times") return FREETEXT_FONTS[1].css;
  if (font === "Courier") return FREETEXT_FONTS[2].css;
  const family = line.fontName.replace(/[-,].*$/, "").replace(/(MT|PS|Std|Pro)$/, "");
  const generic = line.mono ? FREETEXT_FONTS[2].css : line.serif ? FREETEXT_FONTS[1].css : FREETEXT_FONTS[0].css;
  return `'${family}', ${generic}`;
}

let ctx: CanvasRenderingContext2D | null = null;
export function measureLines(text: string, css: string, size: number): { w: number; lines: number } {
  ctx ??= document.createElement("canvas").getContext("2d")!;
  ctx.font = `${size}px ${css}`;
  const lines = text.split("\n");
  return { w: Math.max(...lines.map((l) => ctx!.measureText(l).width)), lines: lines.length };
}
