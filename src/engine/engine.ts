// The PDF engine: every operation on the document lives here. It runs inside a Web Worker
// in the app (see worker.ts) and directly in Node for tests.
//
// The MuPDF document is the single source of truth. Every mutation is wrapped in a MuPDF
// journal operation, so undo/redo covers annotations, page operations, text edits and
// redactions alike.

import * as mupdf from "mupdf";
import type {
  AnnotInfo,
  AnnotPatch,
  AnnotSpec,
  Change,
  DocInfo,
  Point,
  Quad,
  Rect,
  RGB,
  SaveOptions,
  SearchHit,
  TextEditSpec,
  TextLine,
  WidgetInfo,
  WidgetKind,
} from "./types";

const SKIP_ANNOTS = new Set(["Popup", "Link", "Widget"]);

interface LineRecord extends TextLine {
  font: mupdf.Font | null;
  charset: Set<string>;
  family: "Helvetica" | "Times" | "Courier";
}

/** Closest standard font family, judged by name first (font flags are often wrong). */
function familyOf(name: string, font: mupdf.Font): "Helvetica" | "Times" | "Courier" {
  if (/mono|courier|consol|menlo|code|typewriter/i.test(name)) return "Courier";
  if (/sans|san[lsb]?\b|sanl|arial|helvet|verdana|tahoma|calibri|segoe|gothic|grotesk|roboto|inter\b|lato|noto ?sans|dejavusans|liberationsans|ubuntu|open ?sans|futura|frutiger|myriad/i.test(name))
    return "Helvetica";
  if (/serif|times|roman|rom\b|romno|georgia|garamond|minion|cambria|palatino|book|baskerville|caslon|libertine|charter|century|bodoni/i.test(name))
    return "Times";
  if (font.isMono()) return "Courier";
  return font.isSerif() ? "Times" : "Helvetica";
}

function toRGB(c: number[] | undefined | null): RGB {
  if (!c || c.length === 0) return [0, 0, 0];
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 3) return [c[0], c[1], c[2]];
  const [C, M, Y, K] = c;
  return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function base14Name(family: "Helvetica" | "Times" | "Courier", bold: boolean, italic: boolean): string {
  if (family === "Times") {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  const suffix = bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "";
  return family + suffix;
}

function cleanFontName(name: string) {
  return name.replace(/^[A-Z]{6}\+/, "");
}

function mapRect(pts: Point[], from: Rect, to: Rect): Point[] {
  const sx = (to[2] - to[0]) / Math.max(1e-6, from[2] - from[0]);
  const sy = (to[3] - to[1]) / Math.max(1e-6, from[3] - from[1]);
  return pts.map(([x, y]) => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy]);
}

interface Cmd {
  m: string;
  a: unknown[];
  result?: unknown;
}

/** Arguments (by position) that hold an annotation id, per command. */
const ANNOT_ID_ARG: Record<string, number> = { updateAnnot: 1, transformAnnot: 1, deleteAnnot: 1 };

export class Engine {
  private doc: mupdf.PDFDocument | null = null;
  private pages = new Map<number, mupdf.PDFPage>();
  private stext = new Map<number, mupdf.StructuredText>();
  private lines = new Map<number, LineRecord[]>();
  private fontRes = new Map<string, mupdf.PDFObject>();
  private dirty = false;

  // Save support. MuPDF's journal stops undoing correctly once the live document has been
  // written out, so we never save the live document. Instead we keep the original bytes plus a
  // log of the commands that produced each journal step, and saving replays them onto a fresh,
  // disposable copy.
  private original: Uint8Array | null = null;
  private password: string | null = null;
  private log: Cmd[] = [];
  private pos = 0;
  private pending: Cmd | null = null;
  private recording = true;

  // ---------- lifecycle ----------

  open(data: Uint8Array): { needsPassword: boolean } {
    this.close();
    const d = mupdf.Document.openDocument(data, "application/pdf");
    const pdf = d.asPDF();
    if (!pdf) throw new Error("Not a PDF document");
    this.doc = pdf;
    this.original = data;
    this.password = null;
    this.log = [];
    this.pos = 0;
    if (pdf.needsPassword()) return { needsPassword: true };
    this.afterOpen();
    return { needsPassword: false };
  }

  authenticate(password: string): boolean {
    const ok = this.D.authenticatePassword(password) !== 0;
    if (ok) {
      this.password = password;
      this.afterOpen();
    }
    return ok;
  }

  private afterOpen() {
    this.D.enableJournal();
    this.dirty = false;
  }

  close() {
    this.invalidate();
    this.doc?.destroy();
    this.doc = null;
  }

  private get D(): mupdf.PDFDocument {
    if (!this.doc) throw new Error("No document open");
    return this.doc;
  }

  info(): DocInfo {
    const d = this.D;
    const n = d.countPages();
    const pages = [];
    for (let i = 0; i < n; i++) {
      const b = this.page(i).getBounds();
      pages.push({ w: b[2] - b[0], h: b[3] - b[1] });
    }
    return { pages, canUndo: d.canUndo(), canRedo: d.canRedo(), dirty: this.dirty };
  }

  private page(i: number): mupdf.PDFPage {
    let p = this.pages.get(i);
    if (!p) {
      p = this.D.loadPage(i);
      this.pages.set(i, p);
    }
    return p;
  }

  private getStext(i: number): mupdf.StructuredText {
    let s = this.stext.get(i);
    if (!s) {
      s = this.page(i).toStructuredText("preserve-whitespace,preserve-spans");
      this.stext.set(i, s);
    }
    return s;
  }

  private invalidate(pages?: number[]) {
    const drop = (i: number) => {
      this.pages.get(i)?.destroy();
      this.pages.delete(i);
      this.stext.get(i)?.destroy();
      this.stext.delete(i);
      this.lines.delete(i);
    };
    if (!pages) {
      for (const i of [...this.pages.keys(), ...this.stext.keys()]) drop(i);
      this.lines.clear();
      this.fontRes.clear();
    } else pages.forEach(drop);
  }

  private rec(m: string, a: unknown[]) {
    this.pending = { m, a };
  }

  /** Run a mutation as one undoable journal step. */
  private op<T>(name: string, pages: number[] | "all", structure: boolean, fn: () => T): Change & { result: T } {
    const d = this.D;
    d.beginOperation(name);
    let result: T;
    try {
      result = fn();
      d.endOperation();
      if (this.recording && this.pending) {
        this.log.length = this.pos;
        this.log.push({ ...this.pending, result });
        this.pos++;
      }
    } catch (e) {
      this.pending = null;
      try {
        d.abandonOperation();
      } catch {
        /* ignore */
      }
      this.invalidate();
      throw e;
    }
    this.pending = null;
    this.dirty = true;
    this.invalidate(pages === "all" || structure ? undefined : pages);
    return { pages, structure, info: this.info(), result };
  }

  undo(): Change {
    if (this.D.canUndo()) {
      this.D.undo();
      this.pos = Math.max(0, this.pos - 1);
    }
    this.dirty = true;
    this.invalidate();
    return { pages: "all", structure: true, info: this.info() };
  }

  redo(): Change {
    if (this.D.canRedo()) {
      this.D.redo();
      this.pos = Math.min(this.log.length, this.pos + 1);
    }
    this.dirty = true;
    this.invalidate();
    return { pages: "all", structure: true, info: this.info() };
  }

  markSaved() {
    this.dirty = false;
  }

  // ---------- rendering ----------

  /** Render a page to RGBA pixels at `scale` device pixels per point. */
  renderRGBA(i: number, scale: number): { pixels: Uint8ClampedArray; w: number; h: number } {
    const pix = this.page(i).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const w = pix.getWidth();
    const h = pix.getHeight();
    const stride = pix.getStride();
    const src = pix.getPixels();
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      let s = y * stride;
      let o = y * w * 4;
      for (let x = 0; x < w; x++) {
        out[o] = src[s];
        out[o + 1] = src[s + 1];
        out[o + 2] = src[s + 2];
        out[o + 3] = 255;
        s += 3;
        o += 4;
      }
    }
    pix.destroy();
    return { pixels: out, w, h };
  }

  // ---------- text ----------

  textLines(i: number): TextLine[] {
    return this.lineRecords(i).map(({ font: _f, charset: _c, family: _fa, ...rest }) => rest);
  }

  private lineRecords(i: number): LineRecord[] {
    const cached = this.lines.get(i);
    if (cached) return cached;
    const out: LineRecord[] = [];
    let cur: LineRecord | null = null;
    let dir: Point = [1, 0];
    this.getStext(i).walk({
      beginLine(bbox: Rect, _wmode: number, direction: Point) {
        dir = direction;
        cur = null;
        void bbox;
      },
      onChar(c: string, origin: Point, font: mupdf.Font, size: number, quad: Quad, color: number[]) {
        const qb: Rect = [
          Math.min(quad[0], quad[4]),
          Math.min(quad[1], quad[3]),
          Math.max(quad[2], quad[6]),
          Math.max(quad[5], quad[7]),
        ];
        if (!cur) {
          const name = font.getName();
          cur = {
            id: out.length,
            bbox: qb,
            text: "",
            fontName: cleanFontName(name),
            size: Math.round(size * 100) / 100,
            color: toRGB(color),
            origin: [origin[0], origin[1]],
            dir: [dir[0], dir[1]],
            bold: font.isBold() || /bold|black|heavy|semibold/i.test(name),
            italic: font.isItalic() || /italic|oblique/i.test(name),
            serif: familyOf(name, font) === "Times",
            mono: familyOf(name, font) === "Courier",
            font,
            family: familyOf(name, font),
            charset: new Set(),
          };
          out.push(cur);
        } else {
          cur.bbox = [
            Math.min(cur.bbox[0], qb[0]),
            Math.min(cur.bbox[1], qb[1]),
            Math.max(cur.bbox[2], qb[2]),
            Math.max(cur.bbox[3], qb[3]),
          ];
        }
        cur.text += c;
        for (const ch of c) cur.charset.add(ch);
      },
      endLine() {
        cur = null;
      },
    } as unknown as Parameters<mupdf.StructuredText["walk"]>[0]);
    const lines = out.filter((l) => l.text.trim().length > 0);
    lines.forEach((l, idx) => (l.id = idx));
    this.lines.set(i, lines);
    return lines;
  }

  highlight(i: number, p: Point, q: Point): Quad[] {
    return this.getStext(i).highlight(p, q, 2000);
  }

  snap(i: number, p: Point, q: Point, mode: "words" | "lines"): Quad {
    return this.getStext(i).snap(p, q, mode);
  }

  copyText(i: number, p: Point, q: Point): string {
    return this.getStext(i).copy(p, q);
  }

  search(needle: string, maxHits = 2000): SearchHit[] {
    if (!needle) return [];
    const hits: SearchHit[] = [];
    const n = this.D.countPages();
    for (let i = 0; i < n && hits.length < maxHits; i++) {
      for (const quads of this.getStext(i).search(needle, "ignore-case")) {
        hits.push({ page: i, quads });
        if (hits.length >= maxHits) break;
      }
    }
    return hits;
  }

  // ---------- annotations ----------

  private findAnnot(i: number, id: number): mupdf.PDFAnnotation {
    const a = this.page(i)
      .getAnnotations()
      .find((x) => x.getObject().asIndirect() === id);
    if (!a) throw new Error(`Annotation ${id} not found on page ${i}`);
    return a;
  }

  private describe(a: mupdf.PDFAnnotation): AnnotInfo {
    const type = a.getType();
    const info: AnnotInfo = {
      id: a.getObject().asIndirect(),
      type,
      rect: a.hasRect() ? a.getRect() : a.getBounds(),
      contents: a.getContents() ?? "",
      author: a.hasAuthor() ? a.getAuthor() ?? "" : "",
      modified: 0,
      color: [...a.getColor()],
      interior: a.hasInteriorColor() ? [...a.getInteriorColor()] : [],
      width: a.hasBorder() ? a.getBorderWidth() : 0,
      opacity: a.getOpacity(),
      hasInterior: a.hasInteriorColor(),
      hasBorder: a.hasBorder(),
    };
    try {
      info.modified = a.getModificationDate().getTime() || 0;
    } catch {
      /* no date */
    }
    if (type === "FreeText") {
      try {
        const da = a.getDefaultAppearance();
        info.font = da.font;
        info.fontSize = da.size;
        info.color = [...da.color];
      } catch {
        /* no DA */
      }
    }
    if (a.hasLine()) info.line = a.getLine();
    if (a.hasLineEndingStyles()) info.lineEnd = a.getLineEndingStyles().end;
    if (a.hasInkList()) info.ink = a.getInkList();
    if (a.hasVertices()) info.vertices = a.getVertices();
    if (a.hasQuadPoints()) info.quads = a.getQuadPoints();
    return info;
  }

  listAnnots(i: number): AnnotInfo[] {
    return this.page(i)
      .getAnnotations()
      .filter((a) => !SKIP_ANNOTS.has(a.getType()))
      .map((a) => this.describe(a));
  }

  /** Every annotation in the document that carries a comment, for the comments panel. */
  listComments(): (AnnotInfo & { page: number })[] {
    const out: (AnnotInfo & { page: number })[] = [];
    const n = this.D.countPages();
    for (let i = 0; i < n; i++) {
      for (const a of this.listAnnots(i)) {
        if (a.type === "Text" || a.contents.trim()) out.push({ ...a, page: i });
      }
    }
    return out;
  }

  createAnnot(i: number, spec: AnnotSpec): Change & { result: number } {
    this.rec("createAnnot", [i, spec]);
    return this.op(`Add ${spec.type}`, [i], false, () => {
      const page = this.page(i);
      const a = page.createAnnotation(spec.type as mupdf.PDFAnnotationType);
      if (spec.quads) a.setQuadPoints(spec.quads as mupdf.Quad[]);
      if (spec.rect && a.hasRect()) a.setRect(spec.rect);
      if (spec.line) {
        a.setLine(spec.line[0], spec.line[1]);
        a.setLineEndingStyles("None", (spec.lineEnd ?? "None") as mupdf.PDFAnnotationLineEndingStyle);
      }
      if (spec.ink) a.setInkList(spec.ink);
      if (spec.vertices) a.setVertices(spec.vertices);
      if (spec.icon && a.hasIcon()) a.setIcon(spec.icon);
      if (spec.type === "FreeText") {
        const color = (spec.color ?? [0, 0, 0]) as mupdf.Color;
        a.setDefaultAppearance(spec.font ?? "Helv", spec.fontSize ?? 12, color);
        a.setBorderWidth(0);
      } else if (spec.color) a.setColor(spec.color as mupdf.AnnotColor);
      if (spec.interior && a.hasInteriorColor()) a.setInteriorColor(spec.interior as mupdf.AnnotColor);
      if (spec.width !== undefined && a.hasBorder() && spec.type !== "FreeText") a.setBorderWidth(spec.width);
      if (spec.opacity !== undefined) a.setOpacity(spec.opacity);
      if (spec.contents !== undefined) a.setContents(spec.contents);
      if (spec.author && a.hasAuthor()) a.setAuthor(spec.author);
      if (spec.image) {
        a.setIntent("StampImage");
        a.setStampImage(new mupdf.Image(spec.image));
      }
      a.setModificationDate(new Date());
      a.update();
      return a.getObject().asIndirect();
    });
  }

  updateAnnot(i: number, id: number, patch: AnnotPatch): Change {
    this.rec("updateAnnot", [i, id, patch]);
    return this.op("Edit annotation", [i], false, () => {
      const a = this.findAnnot(i, id);
      const type = a.getType();
      if (type === "FreeText" && (patch.color || patch.font || patch.fontSize)) {
        const da = a.getDefaultAppearance();
        a.setDefaultAppearance(
          patch.font ?? da.font,
          patch.fontSize ?? da.size,
          (patch.color ?? da.color) as mupdf.AnnotColor,
        );
      } else if (patch.color) a.setColor(patch.color as mupdf.AnnotColor);
      if (patch.interior && a.hasInteriorColor()) a.setInteriorColor(patch.interior as mupdf.AnnotColor);
      if (patch.width !== undefined && a.hasBorder() && type !== "FreeText") a.setBorderWidth(patch.width);
      if (patch.opacity !== undefined) a.setOpacity(patch.opacity);
      if (patch.contents !== undefined) a.setContents(patch.contents);
      if (patch.lineEnd && a.hasLineEndingStyles())
        a.setLineEndingStyles("None", patch.lineEnd as mupdf.PDFAnnotationLineEndingStyle);
      if (patch.rect && a.hasRect()) a.setRect(patch.rect);
      a.setModificationDate(new Date());
      a.update();
    });
  }

  /** Move/resize an annotation so its bounding box becomes `to`. */
  transformAnnot(i: number, id: number, to: Rect): Change {
    this.rec("transformAnnot", [i, id, to]);
    return this.op("Move annotation", [i], false, () => {
      const a = this.findAnnot(i, id);
      const from = a.hasRect() ? a.getRect() : a.getBounds();
      const type = a.getType();
      if (a.hasInkList()) {
        a.setInkList(a.getInkList().map((s) => mapRect(s, from, to)));
      } else if (a.hasLine()) {
        const [p, q] = mapRect(a.getLine(), from, to);
        a.setLine(p, q);
      } else if (a.hasVertices()) {
        a.setVertices(mapRect(a.getVertices(), from, to));
      } else if (a.hasQuadPoints()) {
        a.setQuadPoints(
          a.getQuadPoints().map((q) => mapRect(
            [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]], from, to,
          ).flat() as Quad),
        );
      } else if (type === "Text") {
        // Sticky-note icons keep their size; only move.
        const w = from[2] - from[0];
        const h = from[3] - from[1];
        a.setRect([to[0], to[1], to[0] + w, to[1] + h]);
      } else {
        a.setRect(to);
      }
      a.setModificationDate(new Date());
      a.update();
    });
  }

  deleteAnnot(i: number, id: number): Change {
    this.rec("deleteAnnot", [i, id]);
    return this.op("Delete annotation", [i], false, () => {
      this.page(i).deleteAnnotation(this.findAnnot(i, id));
    });
  }

  /** Hide/show an annotation while it is being edited inline (not journaled). */
  setHidden(i: number, id: number, hidden: boolean): void {
    const a = this.findAnnot(i, id);
    a.setHiddenForEditing(hidden);
    this.invalidate([i]);
  }

  // ---------- redaction ----------

  applyRedactions(): Change & { result: number } {
    this.rec("applyRedactions", []);
    return this.op("Apply redactions", "all", false, () => {
      const n = this.D.countPages();
      let count = 0;
      for (let i = 0; i < n; i++) {
        const page = this.page(i);
        const has = page.getAnnotations().some((a) => a.getType() === "Redact");
        if (has) {
          count++;
          page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
        }
      }
      return count;
    });
  }

  // ---------- editing existing text ----------

  editTextLine(i: number, lineId: number, spec: TextEditSpec): Change {
    const line = this.lineRecords(i).find((l) => l.id === lineId);
    if (!line) throw new Error("Text line not found");
    this.rec("editTextLine", [i, lineId, spec]);
    return this.op("Edit text", [i], false, () => {
      const page = this.page(i);
      const d = this.D;

      // 1. Remove only the original glyphs of this line (no images, no vector art).
      const [x0, y0, x1, y1] = line.bbox;
      const inset = (y1 - y0) * 0.22;
      const r = page.createAnnotation("Redact");
      r.setRect([x0 - 0.5, y0 + inset, x1 + 0.5, y1 - inset]);
      r.update();
      r.applyRedaction(0, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);

      if (!spec.text.trim()) return;

      // 2. Choose a font: the document's own font if it can draw every character, else a standard font.
      let font: mupdf.Font | null = null;
      let fontObj: mupdf.PDFObject | null = null;
      if (spec.font === "original" && line.font && spec.bold === line.bold && spec.italic === line.italic) {
        const chars = [...spec.text].filter((c) => c !== " ");
        const ok = chars.every((c) => line.charset.has(c) && line.font!.encodeCharacter(c) > 0);
        if (ok) {
          try {
            // Only reuse embedded TrueType fonts: re-embedding Type1/CFF fonts as CID fonts
            // renders in MuPDF but breaks in other viewers (e.g. Poppler/Evince).
            const obj = d.addFont(line.font);
            if (!obj.get("DescendantFonts", 0, "FontDescriptor", "FontFile2").isNull()) {
              fontObj = obj;
              font = line.font;
            }
          } catch {
            font = null;
          }
        }
      }
      if (!font) {
        const family = spec.font === "original" ? line.family : spec.font;
        const name = base14Name(family, spec.bold, spec.italic);
        font = new mupdf.Font(name);
        fontObj = this.fontRes.get(name) ?? null;
        if (!fontObj) {
          fontObj = d.addFont(font);
          this.fontRes.set(name, fontObj);
        }
      }

      // 3. Register the font in the page resources.
      const pobj = page.getObject();
      let res = pobj.getInheritable("Resources");
      if (res.isNull()) {
        res = d.newDictionary();
        pobj.put("Resources", res);
      } else if (!pobj.get("Resources").isDictionary() || pobj.get("Resources").isNull()) {
        // Inherited resources: copy onto the page so we don't touch sibling pages.
        const copy = d.newDictionary();
        res.forEach((v, k) => copy.put(k as string, v));
        pobj.put("Resources", copy);
        res = copy;
      }
      let fonts = res.get("Font");
      if (fonts.isNull()) {
        fonts = d.newDictionary();
        res.put("Font", fonts);
      }
      let n = 1;
      while (!fonts.get(`FEd${n}`).isNull()) n++;
      const resName = `FEd${n}`;
      fonts.put(resName, fontObj!);

      // 4. Write the new text at the original baseline, in PDF user space.
      // Glyphs are written as a TJ array; spaces the font has no glyph for (common in subset
      // fonts) become a quarter-em positioning gap instead of a missing-glyph box.
      const parts: string[] = [];
      let run = "";
      for (const ch of spec.text) {
        const gid = font.encodeCharacter(ch);
        if (gid > 0) run += gid.toString(16).padStart(4, "0");
        else if (/\s/.test(ch)) {
          if (run) parts.push(`<${run}>`);
          run = "";
          parts.push("-250");
        } else run += "0000";
      }
      if (run) parts.push(`<${run}>`);
      const tj = `[${parts.join(" ")}] TJ`;
      const inv = mupdf.Matrix.invert(page.getTransform());
      const [ox, oy] = line.origin;
      const px = inv[0] * ox + inv[2] * oy + inv[4];
      const py = inv[1] * ox + inv[3] * oy + inv[5];
      let ux = inv[0] * line.dir[0] + inv[2] * line.dir[1];
      let uy = inv[1] * line.dir[0] + inv[3] * line.dir[1];
      const len = Math.hypot(ux, uy) || 1;
      ux /= len;
      uy /= len;
      const [cr, cg, cb] = spec.color;
      const ops =
        `\nq BT /${resName} ${fmt(spec.size)} Tf ${fmt(cr)} ${fmt(cg)} ${fmt(cb)} rg ` +
        `${fmt(ux)} ${fmt(uy)} ${fmt(-uy)} ${fmt(ux)} ${fmt(px)} ${fmt(py)} Tm ${tj} ET Q\n`;

      // Isolate the existing content's graphics state so our text isn't affected by it.
      const contents = pobj.get("Contents");
      const arr = d.newArray();
      arr.push(d.addStream("q\n", {}));
      if (contents.isArray()) contents.forEach((v) => arr.push(v));
      else if (!contents.isNull()) arr.push(contents);
      arr.push(d.addStream("\nQ\n" + ops, {}));
      pobj.put("Contents", arr);
    });
  }

  // ---------- forms ----------

  listWidgets(i: number): WidgetInfo[] {
    return this.page(i)
      .getWidgets()
      .map((w) => {
        const t = w.getFieldType();
        const kind: WidgetKind =
          t === "text" ? "text"
          : t === "checkbox" ? "checkbox"
          : t === "radiobutton" ? "radio"
          : t === "combobox" ? "combo"
          : t === "listbox" ? "list"
          : t === "button" ? "button"
          : t === "signature" ? "signature"
          : "unknown";
        const value = w.getValue() ?? "";
        let options: string[] = [];
        if (kind === "combo" || kind === "list") {
          try {
            options = w.getOptions();
          } catch {
            /* none */
          }
        }
        return {
          id: w.getObject().asIndirect(),
          kind,
          name: (() => { try { return w.getLabel() || w.getObject().get("T").asString() || ""; } catch { return ""; } })(),
          rect: w.getRect(),
          value,
          checked: (kind === "checkbox" || kind === "radio") && value !== "Off" && value !== "",
          options,
          multiline: kind === "text" && w.isMultiline(),
          readOnly: w.isReadOnly(),
          maxLen: kind === "text" ? w.getMaxLen() : 0,
        };
      });
  }

  setWidget(i: number, id: number, value: string | boolean): Change {
    this.rec("setWidget", [i, id, value]);
    return this.op("Fill form field", "all", false, () => {
      const w = this.page(i)
        .getWidgets()
        .find((x) => x.getObject().asIndirect() === id);
      if (!w) throw new Error("Field not found");
      if (w.isCheckbox() || w.isRadioButton()) {
        const on = w.getValue() !== "Off" && w.getValue() !== "";
        if (on !== value) w.toggle();
      } else if (w.isChoice()) w.setChoiceValue(String(value));
      else w.setTextValue(String(value));
      w.update();
    });
  }

  // ---------- pages ----------

  rotatePages(indices: number[], delta: number): Change {
    this.rec("rotatePages", [indices, delta]);
    return this.op("Rotate page", "all", true, () => {
      for (const i of indices) {
        const obj = this.page(i).getObject();
        const cur = obj.getInheritable("Rotate");
        const r = cur.isNull() ? 0 : cur.asNumber();
        obj.put("Rotate", (((r + delta) % 360) + 360) % 360);
      }
    });
  }

  deletePages(indices: number[]): Change {
    this.rec("deletePages", [indices]);
    return this.op("Delete pages", "all", true, () => {
      for (const i of [...indices].sort((a, b) => b - a)) this.D.deletePage(i);
    });
  }

  insertBlankPage(at: number, w = 612, h = 792): Change {
    this.rec("insertBlankPage", [at, w, h]);
    return this.op("Insert page", "all", true, () => {
      const obj = this.D.addPage([0, 0, w, h], 0, {}, "");
      this.D.insertPage(at, obj);
    });
  }

  /** `order` is the new sequence of current page indices. */
  reorderPages(order: number[]): Change {
    this.rec("reorderPages", [order]);
    return this.op("Reorder pages", "all", true, () => {
      this.D.rearrangePages(order);
    });
  }

  mergePdf(data: Uint8Array, at: number): Change {
    const src = mupdf.Document.openDocument(data, "application/pdf").asPDF();
    if (!src) throw new Error("Not a PDF document");
    if (src.needsPassword()) throw new Error("That PDF is password-protected");
    this.rec("mergePdf", [data, at]);
    try {
      return this.op("Insert PDF", "all", true, () => {
        const map = this.D.newGraftMap();
        const n = src.countPages();
        for (let k = 0; k < n; k++) map.graftPage(at < 0 ? -1 : at + k, src, k);
      });
    } finally {
      src.destroy();
    }
  }

  extractPages(indices: number[]): Uint8Array {
    const out = new mupdf.PDFDocument();
    const map = out.newGraftMap();
    for (const i of indices) map.graftPage(-1, this.D, i);
    const buf = out.saveToBuffer("garbage,compress");
    const bytes = buf.asUint8Array().slice();
    buf.destroy();
    out.destroy();
    return bytes;
  }

  // ---------- saving ----------

  /** Produce the document as it currently stands (respecting undo), without touching the live document. */
  save(opts: SaveOptions = {}): Uint8Array {
    if (!this.original) throw new Error("No document open");
    const r = new Engine();
    r.recording = false;
    r.open(this.original);
    if (this.password !== null) r.authenticate(this.password);
    const ids = new Map<unknown, unknown>();
    const call = r as unknown as Record<string, (...a: unknown[]) => { result?: unknown }>;
    try {
      for (const cmd of this.log.slice(0, this.pos)) {
        const args = [...cmd.a];
        const k = ANNOT_ID_ARG[cmd.m];
        if (k !== undefined && ids.has(args[k])) args[k] = ids.get(args[k]);
        const out = call[cmd.m](...args);
        if (cmd.m === "createAnnot") ids.set(cmd.result, out.result);
      }
      const d = r.D;
      if (opts.flattenAnnots || opts.flattenForms) d.bake(!!opts.flattenAnnots, !!opts.flattenForms);
      // Garbage collection drops orphaned objects, e.g. content removed by redaction.
      const buf = d.saveToBuffer("garbage=deduplicate,compress");
      const bytes = buf.asUint8Array().slice();
      buf.destroy();
      return bytes;
    } finally {
      r.close();
    }
  }
}
