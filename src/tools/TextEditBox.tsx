import { useEffect, useRef, useState } from "preact/hooks";
import { engine } from "../engine/client";
import type { EditFont, TextLine } from "../engine/types";
import { mutate } from "../state/actions";
import { hexToRgb, rgbToHex, textEdit } from "../state/store";
import { Icon } from "../ui/icons";
import { cssForEditFont } from "./fonts";

const stop = (e: Event) => e.stopPropagation();

/** Inline editor for a line of the document's own text (Edit Text tool). */
export function TextEditBox({ page, z, line }: { page: number; z: number; line: TextLine }) {
  const [text, setText] = useState(line.text.replace(/\s+$/, ""));
  const [font, setFont] = useState<EditFont>("original");
  const [bold, setBold] = useState(line.bold);
  const [italic, setItalic] = useState(line.italic);
  const [size, setSize] = useState(line.size);
  const [color, setColor] = useState(rgbToHex(line.color));
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = input.current!;
    el.focus();
    el.select();
  }, []);

  const finish = async (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    textEdit.value = null;
    const unchanged =
      text === line.text.replace(/\s+$/, "") && font === "original" && bold === line.bold && italic === line.italic &&
      size === line.size && color === rgbToHex(line.color);
    if (!commit || unchanged) return;
    await mutate(engine.editTextLine(page, line.id, { text, font, bold, italic, size, color: hexToRgb(color) }));
  };

  const [x0, y0, x1, y1] = line.bbox;
  const h = y1 - y0;
  return (
    <div class="textedit" onPointerDown={stop} onDblClick={stop}>
      <input
        ref={input}
        class="textedit-input"
        value={text}
        spellcheck
        style={{
          left: `${(x0 - 2) * z}px`,
          top: `${(y0 - 1) * z}px`,
          height: `${(h + 2) * z}px`,
          minWidth: `${(x1 - x0 + 4) * z}px`,
          width: `${Math.max(x1 - x0 + 4, text.length * size * 0.55) * z}px`,
          fontFamily: cssForEditFont(font, line),
          fontSize: `${size * z}px`,
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? "italic" : "normal",
          color,
        }}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
      />
      <div
        class="textedit-bar"
        style={{ left: `${x0 * z}px`, top: `${Math.max(0, y0 * z - 44)}px` }}
        onMouseDown={(e) => e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "INPUT" && e.preventDefault()}
      >
        <select value={font} onChange={(e) => setFont((e.target as HTMLSelectElement).value as EditFont)} title={`Font in document: ${line.fontName}`}>
          <option value="original">Match original ({line.fontName.slice(0, 22)})</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Times">Times</option>
          <option value="Courier">Courier</option>
        </select>
        <button class={bold ? "tb on" : "tb"} title="Bold" onClick={() => setBold(!bold)}><Icon name="bold" size={15} /></button>
        <button class={italic ? "tb on" : "tb"} title="Italic" onClick={() => setItalic(!italic)}><Icon name="italic" size={15} /></button>
        <input type="number" min={2} max={400} step={0.5} value={size} title="Font size" class="num"
          onInput={(e) => setSize(Number((e.target as HTMLInputElement).value) || line.size)} />
        <input type="color" value={color} title="Text color" onInput={(e) => setColor((e.target as HTMLInputElement).value)} />
        <button class="tb ok" title="Apply (Enter)" onClick={() => finish(true)}><Icon name="check" size={15} /></button>
        <button class="tb" title="Cancel (Esc)" onClick={() => finish(false)}><Icon name="close" size={15} /></button>
      </div>
    </div>
  );
}
