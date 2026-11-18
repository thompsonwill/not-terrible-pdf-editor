import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../src/engine/engine";
import { makeTextPdf, pageText, reopen, PNG } from "./fixtures";

let e: Engine;
beforeEach(() => {
  e = new Engine();
  expect(e.open(makeTextPdf(3)).needsPassword).toBe(false);
});

describe("open / render", () => {
  it("reports page sizes", () => {
    const info = e.info();
    expect(info.pages).toHaveLength(3);
    expect(info.pages[0]).toEqual({ w: 612, h: 792 });
    expect(info.canUndo).toBe(false);
  });
  it("renders RGBA pixels", () => {
    const r = e.renderRGBA(0, 0.5);
    expect(r.w).toBe(306);
    expect(r.pixels.length).toBe(r.w * r.h * 4);
    expect(r.pixels[3]).toBe(255);
  });
});

describe("text", () => {
  it("extracts lines with style", () => {
    const lines = e.textLines(0);
    expect(lines.map((l) => l.text.trim())).toContain("The quick brown fox jumps over the lazy dog.");
    const title = lines.find((l) => l.text.startsWith("Page 1"))!;
    expect(title.size).toBe(20);
    expect(title.bold).toBe(true);
    expect(title.color).toEqual([0, 0, 1]);
  });
  it("searches all pages", () => {
    const hits = e.search("lazy dog");
    expect(hits.map((h) => h.page)).toEqual([0, 1, 2]);
  });
  it("selects and copies text", () => {
    const l = e.textLines(0)[1];
    const y = l.origin[1] - 3;
    const txt = e.copyText(0, [l.bbox[0] + 1, y], [l.bbox[2] - 1, y]);
    expect(txt).toContain("quick brown");
    expect(e.highlight(0, [l.bbox[0] + 1, y], [l.bbox[2] - 1, y]).length).toBeGreaterThan(0);
  });
});

describe("annotations", () => {
  it("creates highlight, persists, undoes, redoes", () => {
    const quads = e.search("quick brown")[0].quads;
    const ch = e.createAnnot(0, { type: "Highlight", quads, color: [1, 1, 0] });
    expect(ch.info.canUndo).toBe(true);
    expect(e.listAnnots(0).map((a) => a.type)).toEqual(["Highlight"]);
    const saved = reopen(e.save());
    expect(saved.loadPage(0).getAnnotations()[0].getType()).toBe("Highlight");
    e.undo();
    expect(e.listAnnots(0)).toHaveLength(0);
    e.redo();
    expect(e.listAnnots(0)).toHaveLength(1);
  });
  it("creates every shape type and moves/resizes", () => {
    e.createAnnot(0, { type: "Square", rect: [100, 100, 200, 150], color: [1, 0, 0], interior: [0, 1, 0], width: 3 });
    e.createAnnot(0, { type: "Circle", rect: [100, 200, 200, 250], color: [1, 0, 0] });
    e.createAnnot(0, { type: "Line", line: [[100, 300], [300, 320]], lineEnd: "OpenArrow", color: [0, 0, 1], width: 2 });
    e.createAnnot(0, { type: "Ink", ink: [[[10, 10], [20, 30], [40, 35]]], color: [0, 0, 0], width: 2 });
    e.createAnnot(0, { type: "Polygon", vertices: [[300, 300], [350, 300], [325, 350]], color: [0, 0, 0] });
    e.createAnnot(0, { type: "Text", rect: [400, 100, 420, 120], contents: "A sticky note", icon: "Comment" });
    e.createAnnot(0, { type: "FreeText", rect: [100, 400, 300, 430], contents: "Added text", font: "TiRo", fontSize: 16, color: [1, 0, 0] });
    const list = e.listAnnots(0);
    expect(list.map((a) => a.type)).toEqual(["Square", "Circle", "Line", "Ink", "Polygon", "Text", "FreeText"]);
    expect(list[2].lineEnd).toBe("OpenArrow");
    const ft = list[6];
    expect(ft.fontSize).toBe(16);
    expect(ft.font).toBe("TiRo");
    e.transformAnnot(0, list[0].id, [150, 150, 350, 250]);
    const sq = e.listAnnots(0)[0];
    expect(sq.rect[0]).toBeCloseTo(150, 0);
    const ink = e.listAnnots(0)[3];
    e.transformAnnot(0, ink.id, [ink.rect[0] + 50, ink.rect[1], ink.rect[2] + 50, ink.rect[3]]);
    expect(e.listAnnots(0)[3].ink![0][0][0]).toBeCloseTo(60, 0);
    e.updateAnnot(0, ft.id, { fontSize: 20, contents: "Changed" });
    const ft2 = e.listAnnots(0)[6];
    expect(ft2.fontSize).toBe(20);
    expect(ft2.contents).toBe("Changed");
    e.deleteAnnot(0, list[1].id);
    expect(e.listAnnots(0)).toHaveLength(6);
    expect(e.listComments().map((c) => c.contents)).toEqual(["A sticky note", "Changed"]);
  });
  it("adds image stamps (signatures)", () => {
    e.createAnnot(0, { type: "Stamp", rect: [100, 500, 300, 560], image: PNG });
    const a = e.listAnnots(0)[0];
    expect(a.type).toBe("Stamp");
    e.transformAnnot(0, a.id, [120, 520, 220, 550]);
    expect(e.listAnnots(0)[0].rect[0]).toBeCloseTo(120, 0);
    expect(reopen(e.save()).loadPage(0).getAnnotations()).toHaveLength(1);
  });
});

describe("redaction", () => {
  it("removes text underneath for real", () => {
    const q = e.search("12345678")[0].quads[0];
    e.createAnnot(0, { type: "Redact", rect: [q[0], q[1], q[6], q[7]] });
    e.applyRedactions();
    const bytes = e.save();
    expect(pageText(bytes, 0)).not.toContain("12345678");
    expect(pageText(bytes, 0)).toContain("Secret account number");
    expect(pageText(bytes, 1)).toContain("12345678");
    // The removed text must not survive anywhere in the file (e.g. as an orphaned stream).
    const raw = reopen(bytes);
    let found = 0;
    for (let n = 1; n < raw.countObjects(); n++) {
      const o = raw.newIndirect(n);
      if (o.isStream() && o.readStream().asString().includes("12345678")) found++;
    }
    expect(found).toBe(2); // only pages 2 and 3 still have it
  });
});

describe("edit existing text", () => {
  it("replaces a line with a standard font", () => {
    const line = e.textLines(0).find((l) => l.text.includes("quick"))!;
    e.editTextLine(0, line.id, { text: "A completely new sentence ✓", font: "Times", bold: false, italic: false, size: line.size, color: line.color });
    const t = pageText(e.save(), 0);
    expect(t).toContain("A completely new sentence");
    expect(t).not.toContain("quick brown");
    expect(t).toContain("Secret account number");
    expect(t).toContain("Page 1 title");
    const nl = e.textLines(0).find((l) => l.text.includes("completely"))!;
    expect(nl.bbox[0]).toBeCloseTo(line.bbox[0], 0);
    expect(nl.origin[1]).toBeCloseTo(line.origin[1], 0);
  });
  it("reuses the original font when possible", () => {
    const line = e.textLines(0).find((l) => l.text.startsWith("Page 1"))!;
    e.editTextLine(0, line.id, { text: "Page 1 tile", font: "original", bold: true, italic: false, size: line.size, color: line.color });
    const nl = e.textLines(0).find((l) => l.text.includes("tile"))!;
    expect(nl.fontName).toMatch(/Bold/);
    expect(nl.color).toEqual([0, 0, 1]);
    e.undo();
    expect(pageText(e.save(), 0)).toContain("Page 1 title");
  });
  it("can edit twice on the same page", () => {
    let lines = e.textLines(0);
    e.editTextLine(0, lines[1].id, { text: "first edit", font: "Helvetica", bold: false, italic: false, size: 12, color: [0, 0, 0] });
    lines = e.textLines(0);
    const l = lines.find((x) => x.text.includes("Secret"))!;
    e.editTextLine(0, l.id, { text: "second edit", font: "Courier", bold: true, italic: false, size: 12, color: [0, 0, 0] });
    const t = pageText(e.save(), 0);
    expect(t).toContain("first edit");
    expect(t).toContain("second edit");
    expect(t).not.toContain("Secret");
  });
});

describe("pages", () => {
  it("rotates, deletes, inserts, reorders", () => {
    e.rotatePages([0], 90);
    expect(e.info().pages[0]).toEqual({ w: 792, h: 612 });
    e.insertBlankPage(1, 300, 400);
    expect(e.info().pages[1]).toEqual({ w: 300, h: 400 });
    e.deletePages([1]);
    expect(e.info().pages).toHaveLength(3);
    e.reorderPages([2, 0, 1]);
    expect(pageText(e.save(), 0)).toContain("Page 3");
    e.undo();
    expect(pageText(e.save(), 0)).toContain("Page 1");
  });
  it("merges and extracts", () => {
    e.mergePdf(makeTextPdf(2), 3);
    expect(e.info().pages).toHaveLength(5);
    const ex = e.extractPages([2, 0]);
    const d = reopen(ex);
    expect(d.countPages()).toBe(2);
    expect(pageText(ex, 0)).toContain("Page 3");
  });
});

describe("save", () => {
  it("keeps undo working across saves, and saves respect undo", () => {
    const a = e.createAnnot(0, { type: "Square", rect: [10, 10, 50, 50] }).result;
    e.updateAnnot(0, a, { color: [0, 1, 0] });
    e.save();
    e.createAnnot(1, { type: "Circle", rect: [10, 10, 50, 50] });
    e.undo();
    expect(e.listAnnots(1)).toHaveLength(0);
    const d = reopen(e.save());
    expect(d.loadPage(1).getAnnotations()).toHaveLength(0);
    expect(d.loadPage(0).getAnnotations()[0].getColor()).toEqual([0, 1, 0]);
    e.undo();
    e.undo();
    expect(e.listAnnots(0)).toHaveLength(0);
    expect(reopen(e.save()).loadPage(0).getAnnotations()).toHaveLength(0);
    e.redo();
    expect(reopen(e.save()).loadPage(0).getAnnotations()).toHaveLength(1);
  });
  it("hiding an annotation for inline editing is not an undo step", () => {
    const a = e.createAnnot(0, { type: "FreeText", rect: [10, 10, 100, 40], contents: "x" }).result;
    e.undo(); e.redo();
    e.setHidden(0, a, true);
    expect(e.info().canRedo).toBe(false);
    e.undo();
    expect(e.listAnnots(0)).toHaveLength(0);
  });
  it("flattens annotations", () => {
    e.createAnnot(0, { type: "FreeText", rect: [100, 400, 300, 430], contents: "Flattened words", font: "Helv", fontSize: 14 });
    const bytes = e.save({ flattenAnnots: true });
    expect(reopen(bytes).loadPage(0).getAnnotations()).toHaveLength(0);
    expect(pageText(bytes, 0)).toContain("Flattened words");
  });
});
