import { useEffect, useRef, useState } from "preact/hooks";
import { engine } from "../engine/client";
import type { Rect } from "../engine/types";
import { createAnnot, mutate, updateAnnot } from "../state/actions";
import { annotsByPage, bumpPage, hexToRgb, inlineEdit, rgbToHex, selection, style, tool } from "../state/store";
import { cssForFreeText, measureLines } from "./fonts";

type Edit = NonNullable<typeof inlineEdit.value>;
const stop = (e: Event) => e.stopPropagation();

export function InlineEditor({ page, z, edit }: { page: number; z: number; edit: Edit }) {
  return edit.kind === "freetext" ? <FreeTextEditor page={page} z={z} edit={edit} /> : <NoteEditor page={page} z={z} edit={edit} />;
}

function FreeTextEditor({ page, z, edit }: { page: number; z: number; edit: Edit }) {
  const existing = edit.id !== null ? annotsByPage.value.get(page)?.find((a) => a.id === edit.id) : undefined;
  const st = style.value;
  const font = existing?.font ?? st.font;
  const size = existing?.fontSize ?? st.fontSize;
  const color = existing ? rgbToHex(existing.color) : st.textColor;
  const css = cssForFreeText(font);
  const [text, setText] = useState(existing?.contents ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const finish = async (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    inlineEdit.value = null;
    const value = text.replace(/\s+$/, "");
    const m = measureLines(value || " ", css, size);
    const [x, y] = edit.at;
    const rect: Rect = [x, y, x + m.w + size * 0.5 + 6, y + m.lines * size * 1.2 + size * 0.35 + 4];
    if (edit.id === null) {
      if (commit && value) {
        await createAnnot(page, { type: "FreeText", rect, contents: value, font: font as "Helv", fontSize: size, color: hexToRgb(color) });
        tool.value = "select";
      }
      return;
    }
    await engine.setHidden(page, edit.id, false);
    if (!commit || value === existing?.contents) {
      bumpPage(page);
      return;
    }
    if (!value) {
      selection.value = null;
      await mutate(engine.deleteAnnot(page, edit.id));
    } else await updateAnnot(page, edit.id, { contents: value, rect });
  };

  const rows = Math.max(1, text.split("\n").length);
  const m = measureLines(text || "M", css, size);
  return (
    <textarea
      ref={ref}
      class="inline-text"
      value={text}
      rows={rows}
      placeholder="Type…"
      spellcheck
      style={{
        left: `${edit.at[0] * z}px`,
        top: `${edit.at[1] * z}px`,
        font: `${size * z}px/1.2 ${css}`,
        color,
        width: `${(m.w + size) * z + 16}px`,
      }}
      onPointerDown={stop}
      onDblClick={stop}
      onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(false);
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true);
      }}
    />
  );
}

function NoteEditor({ page, z, edit }: { page: number; z: number; edit: Edit }) {
  const a = annotsByPage.value.get(page)?.find((x) => x.id === edit.id);
  const [text, setText] = useState(a?.contents ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const save = async () => {
    inlineEdit.value = null;
    if (edit.id !== null && text !== (a?.contents ?? "")) await updateAnnot(page, edit.id, { contents: text });
  };
  return (
    <div
      class="note-popup"
      style={{ left: `${edit.at[0] * z}px`, top: `${edit.at[1] * z}px` }}
      onPointerDown={stop}
      onDblClick={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") inlineEdit.value = null;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      }}
    >
      <div class="note-head">
        {a?.type === "Text" ? "Comment" : `Comment on ${a?.type ?? "annotation"}`}
        {a?.author ? <span class="muted"> · {a.author}</span> : null}
      </div>
      <textarea ref={ref} rows={4} value={text} placeholder="Write a comment…" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="note-actions">
        <button class="btn ghost" onClick={() => (inlineEdit.value = null)}>Cancel</button>
        <button class="btn primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}
