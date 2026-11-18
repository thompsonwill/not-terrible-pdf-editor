import { useEffect, useRef, useState } from "preact/hooks";
import { engine } from "../engine/client";
import type { AnnotInfo, Point, Quad, Rect, TextLine } from "../engine/types";
import { createAnnot, transformAnnot } from "../state/actions";
import {
  annotsByPage,
  bumpPage,
  hexToRgb,
  inlineEdit,
  placing,
  search,
  selection,
  style,
  textEdit,
  textSel,
  tool,
  type Tool,
} from "../state/store";
import { InlineEditor } from "./InlineEditor";
import { TextEditBox } from "./TextEditBox";
import { SelectionMenu } from "./SelectionMenu";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Gesture =
  | { kind: "move"; id: number; start: Point; orig: Rect; moved: boolean }
  | { kind: "resize"; id: number; handle: Handle; start: Point; orig: Rect; keepAspect: boolean }
  | { kind: "textsel"; start: Point; tool: Tool }
  | { kind: "box"; start: Point; tool: Tool }
  | { kind: "pen"; points: Point[] };

const MARKUP_TOOLS: Tool[] = ["highlight", "underline", "strike"];
const BOX_TOOLS: Tool[] = ["rect", "ellipse", "line", "arrow", "whiteout", "redact"];
const NO_MOVE = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);
const NO_RESIZE = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly", "Text"]);

const norm = (a: Point, b: Point): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const quadRect = (q: Quad): Rect => [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];
const inRect = (p: Point, r: Rect, pad = 0) => p[0] >= r[0] - pad && p[0] <= r[2] + pad && p[1] >= r[1] - pad && p[1] <= r[3] + pad;

function distToSeg(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function hitAnnot(list: AnnotInfo[], p: Point, z: number): AnnotInfo | null {
  const pad = 4 / z;
  for (let k = list.length - 1; k >= 0; k--) {
    const a = list[k];
    if (a.quads?.length) {
      if (a.quads.some((q) => inRect(p, quadRect(q), pad))) return a;
      continue;
    }
    if (a.line && a.line.length === 2) {
      if (distToSeg(p, a.line[0], a.line[1]) <= pad + a.width + 2 / z) return a;
      continue;
    }
    if (a.ink) {
      const tol = pad + a.width / 2 + 2 / z;
      if (a.ink.some((s) => s.some((pt, j) => j > 0 && distToSeg(p, s[j - 1], pt) <= tol))) return a;
      continue;
    }
    if (inRect(p, a.rect, pad)) return a;
  }
  return null;
}

function resizeRect(orig: Rect, h: Handle, dx: number, dy: number, keepAspect: boolean): Rect {
  let [x0, y0, x1, y1] = orig;
  if (h.includes("w")) x0 += dx;
  if (h.includes("e")) x1 += dx;
  if (h.includes("n")) y0 += dy;
  if (h.includes("s")) y1 += dy;
  if (keepAspect && h.length === 2) {
    const ar = (orig[2] - orig[0]) / (orig[3] - orig[1]);
    const w = Math.abs(x1 - x0);
    const hh = w / ar;
    if (h.includes("n")) y0 = y1 - hh;
    else y1 = y0 + hh;
  }
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function simplify(points: Point[], tol: number): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (const p of points.slice(1)) {
    const last = out[out.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= tol) out.push(p);
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

function handlePos(r: Rect, h: Handle): Point {
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  return [h.includes("w") ? r[0] : h.includes("e") ? r[2] : cx, h.includes("n") ? r[1] : h.includes("s") ? r[3] : cy];
}

export function Interaction({ page, w, h, z, lines }: { page: number; w: number; h: number; z: number; lines: TextLine[] }) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{ rect?: Rect; a?: Point; b?: Point; pen?: Point[] } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [poly, setPoly] = useState<Point[]>([]);
  const [dragging, setDragging] = useState(false);
  const hlPending = useRef<{ busy: boolean; next: [Point, Point] | null }>({ busy: false, next: null });

  const t = tool.value;
  const annots = annotsByPage.value.get(page) ?? [];
  const sel = selection.value?.page === page ? annots.find((a) => a.id === selection.value!.id) ?? null : null;
  const ts = textSel.value?.page === page ? textSel.value : null;
  const st = style.value;
  const place = placing.value;

  // Polygon in progress is discarded when switching tools.
  useEffect(() => setPoly([]), [t]);

  // Enter finishes, Escape cancels a polygon in progress.
  useEffect(() => {
    if (!poly.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") finishPolygon(poly);
      else if (e.key === "Escape") setPoly([]);
      else return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [poly]);

  const toPage = (e: PointerEvent | MouseEvent): Point => {
    const r = root.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / z, (e.clientY - r.top) / z];
  };

  // Throttled text-selection highlighting through the worker.
  const requestHighlight = (p: Point, q: Point) => {
    const s = hlPending.current;
    s.next = [p, q];
    if (s.busy) return;
    const run = async () => {
      if (!s.next) {
        s.busy = false;
        return;
      }
      s.busy = true;
      const [a, b] = s.next;
      s.next = null;
      const quads = await engine.highlight(page, a, b);
      textSel.value = quads.length ? { page, quads, p: a, q: b } : null;
      run();
    };
    run();
  };

  const strokeColor = () => hexToRgb(st.stroke);
  const fillColor = () => (st.fill ? hexToRgb(st.fill) : undefined);

  const finishPolygon = async (pts: Point[]) => {
    setPoly([]);
    if (pts.length < 3) return;
    await createAnnot(page, { type: "Polygon", vertices: pts, color: strokeColor(), interior: fillColor(), width: st.width, opacity: st.opacity });
    tool.value = "select";
  };

  const onPointerDown = async (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = toPage(e);
    const target = e.target as Element;
    if (inlineEdit.value || textEdit.value) return;

    // Placing a signature / image.
    if (place) {
      const pw = place.w;
      const ph = place.h;
      const rect: Rect = [p[0] - pw / 2, p[1] - ph / 2, p[0] + pw / 2, p[1] + ph / 2];
      placing.value = null;
      URL.revokeObjectURL(place.url);
      await createAnnot(page, { type: "Stamp", rect, image: place.bytes, contents: "" });
      tool.value = "select";
      return;
    }

    if (t === "select") {
      const handle = target.getAttribute?.("data-handle") as Handle | null;
      if (handle && sel) {
        gesture.current = { kind: "resize", id: sel.id, handle, start: p, orig: sel.rect, keepAspect: sel.type === "Stamp" || e.shiftKey };
      } else {
        const hit = hitAnnot(annots, p, z);
        if (hit) {
          selection.value = { page, id: hit.id };
          textSel.value = null;
          if (!NO_MOVE.has(hit.type)) gesture.current = { kind: "move", id: hit.id, start: p, orig: hit.rect, moved: false };
        } else {
          selection.value = null;
          textSel.value = null;
          gesture.current = { kind: "textsel", start: p, tool: t };
        }
      }
    } else if (MARKUP_TOOLS.includes(t)) {
      textSel.value = null;
      gesture.current = { kind: "textsel", start: p, tool: t };
    } else if (BOX_TOOLS.includes(t)) {
      gesture.current = { kind: "box", start: p, tool: t };
    } else if (t === "pen") {
      gesture.current = { kind: "pen", points: [p] };
    } else if (t === "polygon") {
      if (poly.length >= 3 && Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]) < 8 / z) finishPolygon(poly);
      else setPoly([...poly, p]);
      return;
    } else if (t === "text") {
      selection.value = null;
      inlineEdit.value = { page, id: null, kind: "freetext", at: [p[0], p[1] - st.fontSize * 0.6] };
      return;
    } else if (t === "note") {
      const id = await createAnnot(page, { type: "Text", rect: [p[0] - 10, p[1] - 10, p[0] + 10, p[1] + 10], icon: "Comment", color: [1, 0.85, 0.2], contents: "" });
      if (id !== null) inlineEdit.value = { page, id, kind: "note", at: [p[0] + 12, p[1] - 10] };
      tool.value = "select";
      return;
    } else if (t === "edittext") {
      const line = lines.find((l) => inRect(p, l.bbox, 1));
      if (line) textEdit.value = { page, line };
      return;
    } else return;
    root.current!.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = toPage(e);
    const g = gesture.current;
    if (!g) {
      if (place || t === "edittext" || (t === "polygon" && poly.length)) setHover(p);
      return;
    }
    if (g.kind === "move") {
      const dx = p[0] - g.start[0];
      const dy = p[1] - g.start[1];
      if (!g.moved && Math.hypot(dx, dy) * z < 3) return;
      g.moved = true;
      setPreview({ rect: [g.orig[0] + dx, g.orig[1] + dy, g.orig[2] + dx, g.orig[3] + dy] });
    } else if (g.kind === "resize") {
      setPreview({ rect: resizeRect(g.orig, g.handle, p[0] - g.start[0], p[1] - g.start[1], g.keepAspect || e.shiftKey) });
    } else if (g.kind === "textsel") {
      if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) * z < 3) return;
      requestHighlight(g.start, p);
    } else if (g.kind === "box") {
      let q = p;
      if (e.shiftKey && (g.tool === "rect" || g.tool === "ellipse")) {
        const d = Math.max(Math.abs(p[0] - g.start[0]), Math.abs(p[1] - g.start[1]));
        q = [g.start[0] + Math.sign(p[0] - g.start[0]) * d, g.start[1] + Math.sign(p[1] - g.start[1]) * d];
      }
      if (g.tool === "line" || g.tool === "arrow") setPreview({ a: g.start, b: q });
      else setPreview({ rect: norm(g.start, q) });
    } else if (g.kind === "pen") {
      const evs = (e as any).getCoalescedEvents?.() ?? [e];
      for (const ev of evs) g.points.push(toPage(ev));
      setPreview({ pen: [...g.points] });
    }
  };

  const onPointerUp = async (e: PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    const pv = preview;
    setPreview(null);
    if (!g) return;
    const p = toPage(e);
    if (g.kind === "move") {
      if (g.moved && pv?.rect) await transformAnnot(page, g.id, pv.rect);
    } else if (g.kind === "resize") {
      if (pv?.rect && pv.rect[2] - pv.rect[0] > 2 && pv.rect[3] - pv.rect[1] > 2) await transformAnnot(page, g.id, pv.rect);
    } else if (g.kind === "textsel") {
      // Let the last highlight request land.
      while (hlPending.current.busy) await new Promise((r) => setTimeout(r, 10));
      const sel = textSel.value;
      if (g.tool !== "select" && sel?.page === page && sel.quads.length) {
        const type = g.tool === "highlight" ? "Highlight" : g.tool === "underline" ? "Underline" : "StrikeOut";
        const color = g.tool === "highlight" ? hexToRgb(st.highlight) : strokeColor();
        textSel.value = null;
        await createAnnot(page, { type, quads: sel.quads, color, opacity: g.tool === "highlight" ? 1 : st.opacity }, false);
      }
    } else if (g.kind === "box") {
      const r = norm(g.start, p);
      if (pv?.rect) Object.assign(r, pv.rect);
      const big = (r[2] - r[0]) * z > 4 || (r[3] - r[1]) * z > 4;
      if (!big) return;
      const common = { color: strokeColor(), width: st.width, opacity: st.opacity };
      switch (g.tool) {
        case "rect":
          await createAnnot(page, { type: "Square", rect: r, interior: fillColor(), ...common });
          tool.value = "select";
          break;
        case "ellipse":
          await createAnnot(page, { type: "Circle", rect: r, interior: fillColor(), ...common });
          tool.value = "select";
          break;
        case "line":
        case "arrow":
          await createAnnot(page, { type: "Line", line: [g.start, pv?.b ?? p], lineEnd: g.tool === "arrow" ? "OpenArrow" : "None", ...common });
          tool.value = "select";
          break;
        case "whiteout":
          await createAnnot(page, { type: "Square", rect: r, color: [1, 1, 1], interior: [1, 1, 1], width: 0, opacity: 1, contents: "" }, false);
          break;
        case "redact":
          await createAnnot(page, { type: "Redact", rect: r }, false);
          break;
      }
    } else if (g.kind === "pen") {
      const pts = simplify(g.points, 0.6);
      if (pts.length > 1) await createAnnot(page, { type: "Ink", ink: [pts], color: strokeColor(), width: st.width, opacity: st.opacity }, false);
    }
  };

  const onDblClick = async (e: MouseEvent) => {
    const p = toPage(e);
    if (t === "polygon") {
      // The dblclick's two clicks already added two (identical) vertices.
      finishPolygon(poly.slice(0, -1));
      return;
    }
    if (t !== "select") return;
    const hit = hitAnnot(annots, p, z);
    if (hit?.type === "FreeText") {
      await engine.setHidden(page, hit.id, true);
      bumpPage(page);
      inlineEdit.value = { page, id: hit.id, kind: "freetext", at: [hit.rect[0], hit.rect[1]] };
    } else if (hit) {
      inlineEdit.value = { page, id: hit.id, kind: "note", at: [hit.rect[2] + 4, hit.rect[1]] };
    } else {
      const q = await engine.snap(page, p, p, "words");
      const quads = await engine.highlight(page, [q[0] + 0.1, (q[1] + q[5]) / 2], [q[2] - 0.1, (q[3] + q[7]) / 2]);
      if (quads.length) textSel.value = { page, quads, p: [q[0] + 0.1, (q[1] + q[5]) / 2], q: [q[2] - 0.1, (q[3] + q[7]) / 2] };
    }
  };

  const cursor =
    place ? "copy"
    : t === "select" ? "default"
    : MARKUP_TOOLS.includes(t) ? "text"
    : t === "edittext" ? "text"
    : "crosshair";

  const hits = search.value.hits;
  const hoverLine = t === "edittext" && hover && !textEdit.value ? lines.find((l) => inRect(hover, l.bbox, 1)) : null;
  const sw = 1 / z; // one screen pixel in page units
  const ie = inlineEdit.value?.page === page ? inlineEdit.value : null;
  const te = textEdit.value?.page === page ? textEdit.value : null;

  return (
    <div
      ref={root}
      class="interaction"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDblClick={onDblClick}
    >
      <svg class="overlay" width={w * z} height={h * z} viewBox={`0 0 ${w} ${h}`}>
        {/* search results */}
        {hits.map((hit, k) =>
          hit.page === page
            ? hit.quads.map((q) => {
                const r = quadRect(q);
                return (
                  <rect
                    x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]}
                    class={k === search.value.index ? "search-hit current" : "search-hit"}
                  />
                );
              })
            : null,
        )}
        {/* text selection */}
        {ts?.quads.map((q) => {
          const r = quadRect(q);
          return <rect x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} class="text-sel" />;
        })}
        {/* edit-text targets */}
        {t === "edittext" && !te && lines.map((l) => (
          <rect x={l.bbox[0] - 1} y={l.bbox[1] - 1} width={l.bbox[2] - l.bbox[0] + 2} height={l.bbox[3] - l.bbox[1] + 2}
            class={l === hoverLine ? "line-box hover" : "line-box"} stroke-width={sw} />
        ))}
        {/* redaction marks are drawn by MuPDF; outline them so they're visible */}
        {annots.filter((a) => a.type === "Redact").map((a) => (
          <rect x={a.rect[0]} y={a.rect[1]} width={a.rect[2] - a.rect[0]} height={a.rect[3] - a.rect[1]} class="redact-mark" stroke-width={2 * sw} />
        ))}
        {/* selected annotation */}
        {sel && !preview && (
          <g>
            <rect x={sel.rect[0]} y={sel.rect[1]} width={sel.rect[2] - sel.rect[0]} height={sel.rect[3] - sel.rect[1]}
              class="sel-box" stroke-width={sw} />
            {!NO_RESIZE.has(sel.type) && HANDLES.map((hd) => {
              const [hx, hy] = handlePos(sel.rect, hd);
              const s = 8 / z;
              return <rect data-handle={hd} class={`handle h-${hd}`} x={hx - s / 2} y={hy - s / 2} width={s} height={s} stroke-width={sw} />;
            })}
          </g>
        )}
        {/* gesture previews */}
        {preview?.rect && (t === "ellipse" ? (
          <ellipse cx={(preview.rect[0] + preview.rect[2]) / 2} cy={(preview.rect[1] + preview.rect[3]) / 2}
            rx={(preview.rect[2] - preview.rect[0]) / 2} ry={(preview.rect[3] - preview.rect[1]) / 2}
            fill={st.fill ?? "none"} stroke={st.stroke} stroke-width={st.width} opacity={st.opacity} />
        ) : t === "rect" ? (
          <rect x={preview.rect[0]} y={preview.rect[1]} width={preview.rect[2] - preview.rect[0]} height={preview.rect[3] - preview.rect[1]}
            fill={st.fill ?? "none"} stroke={st.stroke} stroke-width={st.width} opacity={st.opacity} />
        ) : (
          <rect x={preview.rect[0]} y={preview.rect[1]} width={preview.rect[2] - preview.rect[0]} height={preview.rect[3] - preview.rect[1]}
            class={t === "whiteout" ? "ghost whiteout" : t === "redact" ? "ghost redact" : "ghost"} stroke-width={sw} />
        ))}
        {preview?.a && preview.b && (
          <g stroke={st.stroke} stroke-width={st.width} opacity={st.opacity} stroke-linecap="round">
            <line x1={preview.a[0]} y1={preview.a[1]} x2={preview.b[0]} y2={preview.b[1]} />
            {t === "arrow" && (() => {
              const [ax, ay] = preview.a!;
              const [bx, by] = preview.b!;
              const ang = Math.atan2(by - ay, bx - ax);
              const L = Math.max(8, st.width * 4);
              const p1 = [bx - L * Math.cos(ang - 0.45), by - L * Math.sin(ang - 0.45)];
              const p2 = [bx - L * Math.cos(ang + 0.45), by - L * Math.sin(ang + 0.45)];
              return <polyline points={`${p1} ${bx},${by} ${p2}`} fill="none" />;
            })()}
          </g>
        )}
        {preview?.pen && (
          <polyline points={preview.pen.map((p) => p.join(",")).join(" ")} fill="none" stroke={st.stroke}
            stroke-width={st.width} opacity={st.opacity} stroke-linecap="round" stroke-linejoin="round" />
        )}
        {poly.length > 0 && (
          <g>
            <polyline points={[...poly, ...(hover ? [hover] : [])].map((p) => p.join(",")).join(" ")}
              fill={st.fill ?? "none"} stroke={st.stroke} stroke-width={st.width} opacity={st.opacity} />
            <circle cx={poly[0][0]} cy={poly[0][1]} r={5 / z} class="poly-start" stroke-width={sw} />
          </g>
        )}
        {place && hover && (
          <image href={place.url} x={hover[0] - place.w / 2} y={hover[1] - place.h / 2} width={place.w} height={place.h} opacity={0.7} />
        )}
      </svg>
      {ts && t === "select" && !dragging && <SelectionMenu page={page} z={z} quads={ts.quads} />}
      {ie && <InlineEditor page={page} z={z} edit={ie} />}
      {te && <TextEditBox page={page} z={z} line={te.line} />}
    </div>
  );
}

