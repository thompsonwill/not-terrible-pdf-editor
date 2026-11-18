import { engine } from "../engine/client";
import type { Quad } from "../engine/types";
import { createAnnot } from "../state/actions";
import { hexToRgb, inlineEdit, notify, style, textSel } from "../state/store";
import { Icon } from "../ui/icons";

const stop = (e: Event) => e.stopPropagation();

export async function copySelection() {
  const s = textSel.value;
  if (!s) return;
  const text = await engine.copyText(s.page, s.p, s.q);
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied");
  } catch {
    notify("Clipboard unavailable", "error");
  }
}

export function SelectionMenu({ page, z, quads }: { page: number; z: number; quads: Quad[] }) {
  const last = quads[quads.length - 1];
  const x = Math.min(last[0], last[4]);
  const y = Math.max(last[5], last[7]);
  const markup = async (type: "Highlight" | "Underline" | "StrikeOut" | "Redact") => {
    const s = textSel.value;
    if (!s) return;
    textSel.value = null;
    const st = style.value;
    if (type === "Redact") {
      for (const q of s.quads)
        await createAnnot(page, { type: "Redact", rect: [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])] }, false);
      return;
    }
    const color = type === "Highlight" ? hexToRgb(st.highlight) : hexToRgb(st.stroke);
    const id = await createAnnot(page, { type, quads: s.quads, color }, type !== "Highlight");
    return id;
  };
  const comment = async () => {
    const id = await markup("Highlight");
    if (id) inlineEdit.value = { page, id, kind: "note", at: [x, y + 6] };
  };
  return (
    <div class="sel-menu" style={{ left: `${x * z}px`, top: `${y * z + 6}px` }} onPointerDown={stop} onDblClick={stop}>
      <button onClick={copySelection} title="Copy (Ctrl+C)"><Icon name="copy" size={16} /></button>
      <button onClick={() => markup("Highlight")} title="Highlight"><Icon name="highlight" size={16} /></button>
      <button onClick={() => markup("Underline")} title="Underline"><Icon name="underline" size={16} /></button>
      <button onClick={() => markup("StrikeOut")} title="Strikethrough"><Icon name="strike" size={16} /></button>
      <button onClick={comment} title="Highlight and comment"><Icon name="note" size={16} /></button>
      <button onClick={() => markup("Redact")} title="Mark for redaction"><Icon name="redact" size={16} /></button>
    </div>
  );
}
