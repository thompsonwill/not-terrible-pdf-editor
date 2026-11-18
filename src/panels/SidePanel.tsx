import { useEffect, useState } from "preact/hooks";
import { engine } from "../engine/client";
import type { AnnotInfo } from "../engine/types";
import { deleteSelected, updateAnnot } from "../state/actions";
import {
  author,
  docRev,
  goToPage,
  hexToRgb,
  inlineEdit,
  rgbToHex,
  selectedAnnot,
  selection,
  setAuthor,
  setStyle,
  style,
  tool,
} from "../state/store";
import { FREETEXT_FONTS } from "../tools/fonts";
import { Icon } from "../ui/icons";

const TYPE_LABEL: Record<string, string> = {
  Highlight: "Highlight", Underline: "Underline", StrikeOut: "Strikethrough", Squiggly: "Squiggly underline",
  Text: "Sticky note", FreeText: "Text box", Square: "Rectangle", Circle: "Ellipse", Line: "Line",
  Ink: "Freehand drawing", Polygon: "Polygon", PolyLine: "Polyline", Stamp: "Image / signature", Redact: "Redaction mark",
};

const TOOL_LABEL: Record<string, string> = {
  select: "Select", edittext: "Edit text", text: "Add text", note: "Comment", highlight: "Highlight",
  underline: "Underline", strike: "Strikethrough", pen: "Pen", rect: "Rectangle", ellipse: "Ellipse",
  line: "Line", arrow: "Arrow", polygon: "Polygon", whiteout: "Whiteout", redact: "Redact",
};

function Row({ label, children }: { label: string; children: any }) {
  return (
    <label class="prop">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />;
}

function Range({ value, min, max, step, onChange, fmt }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <span class="range">
      <input type="range" min={min} max={max} step={step} value={v}
        onInput={(e) => setV(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
      <output>{fmt ? fmt(v) : v}</output>
    </span>
  );
}

function SelectedProps({ a }: { a: AnnotInfo }) {
  const s = selection.value!;
  const up = (patch: Parameters<typeof updateAnnot>[2]) => updateAnnot(s.page, a.id, patch);
  const isMarkup = ["Highlight", "Underline", "StrikeOut", "Squiggly"].includes(a.type);
  const [contents, setContents] = useState(a.contents);
  useEffect(() => setContents(a.contents), [a.id, a.contents]);
  return (
    <div class="props">
      <h3>{TYPE_LABEL[a.type] ?? a.type}<span class="muted"> · page {s.page + 1}</span></h3>
      {a.type !== "Stamp" && a.type !== "Redact" && (
        <Row label={a.type === "FreeText" ? "Text color" : "Color"}>
          <Color value={rgbToHex(a.color)} onChange={(v) => up({ color: hexToRgb(v) })} />
        </Row>
      )}
      {a.hasInterior && (
        <Row label="Fill">
          <span class="fill-row">
            <input type="checkbox" checked={a.interior.length > 0} title="Filled"
              onChange={(e) => up({ interior: (e.target as HTMLInputElement).checked ? hexToRgb(style.value.fill ?? "#ffffff") : [] })} />
            {a.interior.length > 0 && <Color value={rgbToHex(a.interior)} onChange={(v) => up({ interior: hexToRgb(v) })} />}
          </span>
        </Row>
      )}
      {a.hasBorder && a.type !== "FreeText" && !isMarkup && (
        <Row label="Thickness">
          <Range value={a.width} min={0} max={20} step={0.5} onChange={(v) => up({ width: v })} fmt={(v) => `${v}pt`} />
        </Row>
      )}
      {a.type === "FreeText" && (
        <>
          <Row label="Font">
            <select value={a.font} onChange={(e) => up({ font: (e.target as HTMLSelectElement).value as "Helv" })}>
              {FREETEXT_FONTS.map((f) => <option value={f.id}>{f.label}</option>)}
            </select>
          </Row>
          <Row label="Size">
            <input type="number" min={4} max={144} value={a.fontSize} class="num"
              onChange={(e) => up({ fontSize: Number((e.target as HTMLInputElement).value) || 12 })} />
          </Row>
        </>
      )}
      {a.type === "Line" && (
        <Row label="Line end">
          <select value={a.lineEnd ?? "None"} onChange={(e) => up({ lineEnd: (e.target as HTMLSelectElement).value })}>
            <option value="None">None</option>
            <option value="OpenArrow">Open arrow</option>
            <option value="ClosedArrow">Closed arrow</option>
            <option value="Circle">Circle</option>
            <option value="Square">Square</option>
            <option value="Butt">Bar</option>
          </select>
        </Row>
      )}
      {a.type !== "Redact" && (
        <Row label="Opacity">
          <Range value={a.opacity} min={0.1} max={1} step={0.05} onChange={(v) => up({ opacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </Row>
      )}
      {a.type !== "FreeText" && (
        <label class="prop col">
          <span>Comment</span>
          <textarea rows={3} value={contents} placeholder="Add a comment…"
            onInput={(e) => setContents((e.target as HTMLTextAreaElement).value)}
            onBlur={() => contents !== a.contents && up({ contents })} />
        </label>
      )}
      {a.type === "FreeText" && <p class="hint">Double-click the text box to edit its text.</p>}
      {a.type === "Redact" && <p class="hint">Click <b>Apply</b> in the toolbar to permanently remove marked content.</p>}
      <button class="btn danger" onClick={deleteSelected}><Icon name="trash" size={15} /> Delete</button>
    </div>
  );
}

function ToolProps() {
  const t = tool.value;
  const st = style.value;
  const shape = ["pen", "rect", "ellipse", "line", "arrow", "polygon"].includes(t);
  const textish = t === "text";
  return (
    <div class="props">
      <h3>{TOOL_LABEL[t] ?? "Tool"}</h3>
      {t === "highlight" && <Row label="Color"><Color value={st.highlight} onChange={(v) => setStyle({ highlight: v })} /></Row>}
      {(shape || t === "underline" || t === "strike") && (
        <Row label="Color"><Color value={st.stroke} onChange={(v) => setStyle({ stroke: v })} /></Row>
      )}
      {(t === "rect" || t === "ellipse" || t === "polygon") && (
        <Row label="Fill">
          <span class="fill-row">
            <input type="checkbox" checked={!!st.fill} onChange={(e) => setStyle({ fill: (e.target as HTMLInputElement).checked ? "#ffcdd2" : null })} />
            {st.fill && <Color value={st.fill} onChange={(v) => setStyle({ fill: v })} />}
          </span>
        </Row>
      )}
      {shape && (
        <>
          <Row label="Thickness">
            <Range value={st.width} min={0.5} max={20} step={0.5} onChange={(v) => setStyle({ width: v })} fmt={(v) => `${v}pt`} />
          </Row>
          <Row label="Opacity">
            <Range value={st.opacity} min={0.1} max={1} step={0.05} onChange={(v) => setStyle({ opacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          </Row>
        </>
      )}
      {textish && (
        <>
          <Row label="Color"><Color value={st.textColor} onChange={(v) => setStyle({ textColor: v })} /></Row>
          <Row label="Font">
            <select value={st.font} onChange={(e) => setStyle({ font: (e.target as HTMLSelectElement).value as "Helv" })}>
              {FREETEXT_FONTS.map((f) => <option value={f.id}>{f.label}</option>)}
            </select>
          </Row>
          <Row label="Size">
            <input type="number" min={4} max={144} value={st.fontSize} class="num"
              onChange={(e) => setStyle({ fontSize: Number((e.target as HTMLInputElement).value) || 12 })} />
          </Row>
        </>
      )}
      <p class="hint">{HINTS[t]}</p>
    </div>
  );
}

const HINTS: Record<string, string> = {
  select: "Click an annotation to select it. Drag to move, use the handles to resize, Delete to remove. Drag across text to select and copy it. Double-click a text box to edit it.",
  edittext: "Click a line of the document's text to rewrite it. Fonts are matched as closely as possible. Scanned (image) text can't be edited.",
  text: "Click anywhere on the page to type. Ctrl+Enter or click away to finish.",
  note: "Click to drop a sticky note and write a comment.",
  highlight: "Drag across text to highlight it.",
  underline: "Drag across text to underline it.",
  strike: "Drag across text to strike it through.",
  pen: "Draw freehand. Each stroke becomes its own drawing.",
  rect: "Drag to draw. Hold Shift for a square.",
  ellipse: "Drag to draw. Hold Shift for a circle.",
  line: "Drag to draw a line.",
  arrow: "Drag to draw an arrow.",
  polygon: "Click to add points. Double-click, press Enter, or click the first point to finish.",
  whiteout: "Drag over content to cover it with white. This only hides it; use Redact to really remove it.",
  redact: "Drag over content to mark it, then click Apply to permanently remove it from the file.",
};

function Comments() {
  const [items, setItems] = useState<(AnnotInfo & { page: number })[]>([]);
  const rev = docRev.value;
  useEffect(() => {
    const t = setTimeout(() => engine.listComments().then(setItems).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [rev]);
  const sel = selection.value;
  return (
    <div class="comments">
      <h3>Comments <span class="muted">{items.length || ""}</span></h3>
      {items.length === 0 && <p class="hint">No comments yet. Use the comment tool, or select any annotation and add a comment.</p>}
      {items.map((c) => (
        <button
          class={sel?.id === c.id ? "comment on" : "comment"}
          onClick={() => {
            tool.value = "select";
            selection.value = { page: c.page, id: c.id };
            goToPage(c.page, c.rect[1]);
          }}
          onDblClick={() => (inlineEdit.value = { page: c.page, id: c.id, kind: c.type === "FreeText" ? "freetext" : "note", at: [c.rect[2] + 4, c.rect[1]] })}
        >
          <div class="comment-meta">
            <span class="swatch" style={{ background: rgbToHex(c.color) }} />
            {TYPE_LABEL[c.type] ?? c.type} · p.{c.page + 1}
            {c.author && <span class="muted"> · {c.author}</span>}
          </div>
          <div class="comment-body">{c.contents || <i class="muted">(empty)</i>}</div>
        </button>
      ))}
      <label class="prop author">
        <span>Your name</span>
        <input type="text" value={author.value} placeholder="Shown on comments" onChange={(e) => setAuthor((e.target as HTMLInputElement).value)} />
      </label>
    </div>
  );
}

export function SidePanel() {
  const a = selectedAnnot.value;
  return (
    <aside class="side">
      {a ? <SelectedProps a={a} /> : <ToolProps />}
      <Comments />
    </aside>
  );
}
