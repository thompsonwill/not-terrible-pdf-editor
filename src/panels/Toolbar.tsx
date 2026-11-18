import { useRef } from "preact/hooks";
import { engine } from "../engine/client";
import { fitPage, fitWidth, mutate, openDialog, pickFile, redo, save, setZoom, undo } from "../state/actions";
import {
  annotsByPage,
  dialog,
  docInfo,
  goToPage,
  notify,
  placing,
  search,
  selection,
  showSide,
  showThumbs,
  textEdit,
  textSel,
  tool,
  zoom,
  type Tool,
} from "../state/store";
import { Icon } from "../ui/icons";
import { LICENSE_NAME, SOURCE_URL } from "../config";

const TOOL_GROUPS: { id: Tool; label: string; key?: string }[][] = [
  [
    { id: "select", label: "Select / move", key: "V" },
    { id: "edittext", label: "Edit existing text", key: "E" },
    { id: "text", label: "Add text", key: "T" },
    { id: "note", label: "Sticky-note comment", key: "N" },
  ],
  [
    { id: "highlight", label: "Highlight text", key: "H" },
    { id: "underline", label: "Underline text", key: "U" },
    { id: "strike", label: "Strikethrough text", key: "K" },
  ],
  [
    { id: "pen", label: "Freehand pen", key: "P" },
    { id: "rect", label: "Rectangle (Shift = square)", key: "R" },
    { id: "ellipse", label: "Ellipse (Shift = circle)", key: "O" },
    { id: "line", label: "Line", key: "L" },
    { id: "arrow", label: "Arrow", key: "A" },
    { id: "polygon", label: "Polygon (click points, double-click to finish)", key: "G" },
  ],
  [
    { id: "signature", label: "Signature", key: "S" },
    { id: "image", label: "Insert image", key: "I" },
    { id: "whiteout", label: "Whiteout (cover content)", key: "W" },
    { id: "redact", label: "Mark for redaction", key: "X" },
  ],
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  TOOL_GROUPS.flat().filter((t) => t.key).map((t) => [t.key!.toLowerCase(), t.id]),
);

export async function chooseTool(t: Tool) {
  textSel.value = null;
  textEdit.value = null;
  if (t !== "select") selection.value = null;
  if (placing.value) {
    URL.revokeObjectURL(placing.value.url);
    placing.value = null;
  }
  if (t === "signature") {
    dialog.value = "signature";
    return;
  }
  if (t === "image") {
    const f = await pickFile("image/png,image/jpeg");
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 300 / Math.max(bmp.width, bmp.height)) * 0.75; // px → pt, capped
      const w = Math.max(24, bmp.width * scale);
      const h = Math.max(24, bmp.height * scale);
      bmp.close();
      placing.value = { bytes, url: URL.createObjectURL(f), w, h, kind: "image" };
      tool.value = "select";
      notify("Click on a page to place the image");
    } catch {
      notify("That image couldn't be read. Use PNG or JPEG.", "error");
    }
    return;
  }
  tool.value = t;
}

export async function applyRedactions() {
  const n = [...annotsByPage.value.values()].flat().filter((a) => a.type === "Redact").length;
  if (!confirm(
    "Apply all redactions?\n\nMarked areas will be permanently blacked out, and the text, images and graphics underneath " +
    "will be removed from the file. You can still undo before closing.",
  )) return;
  const c = await mutate(engine.applyRedactions());
  if (c) notify(c.result ? `Redactions applied on ${c.result} page(s)` : n ? "Redactions applied" : "Nothing was marked for redaction");
}

async function runSearch(query: string, dir: 1 | -1 | 0) {
  const s = search.value;
  if (!query) {
    search.value = { query: "", hits: [], index: 0 };
    return;
  }
  if (query !== s.query || dir === 0) {
    const hits = await engine.search(query);
    search.value = { query, hits, index: 0 };
    if (hits.length) goToPage(hits[0].page, hits[0].quads[0][1]);
    else notify(`No matches for “${query}”`);
    return;
  }
  if (!s.hits.length) return;
  const index = (s.index + dir + s.hits.length) % s.hits.length;
  search.value = { ...s, index };
  const hit = s.hits[index];
  goToPage(hit.page, hit.quads[0][1]);
}

function Btn({ icon, label, onClick, active, disabled }: { icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button class={active ? "tb on" : "tb"} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function Toolbar() {
  const info = docInfo.value;
  const has = !!info;
  const t = tool.value;
  const searchRef = useRef<HTMLInputElement>(null);
  const s = search.value;

  return (
    <header class="toolbar">
      <div class="tgroup">
        <Btn icon="sidebar" label="Toggle page thumbnails" onClick={() => (showThumbs.value = !showThumbs.value)} active={showThumbs.value} disabled={!has} />
        <Btn icon="open" label="Open PDF (Ctrl+O)" onClick={openDialog} />
        <Btn icon="save" label="Save (Ctrl+S)" onClick={save} disabled={!has} />
        <Btn icon="saveas" label="Save as / export (Ctrl+Shift+S)" onClick={() => (dialog.value = "save")} disabled={!has} />
      </div>
      <div class="tgroup">
        <Btn icon="undo" label="Undo (Ctrl+Z)" onClick={undo} disabled={!info?.canUndo} />
        <Btn icon="redo" label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!info?.canRedo} />
      </div>
      {TOOL_GROUPS.map((g) => (
        <div class="tgroup">
          {g.map((x) => (
            <Btn
              icon={x.id}
              label={`${x.label}${x.key ? ` (${x.key})` : ""}`}
              active={t === x.id && !(x.id === "select" && placing.value)}
              disabled={!has}
              onClick={() => chooseTool(x.id)}
            />
          ))}
          {g.some((x) => x.id === "redact") && (
            <button class="tb text" title="Apply all redactions" disabled={!has} onClick={applyRedactions}>Apply</button>
          )}
        </div>
      ))}
      <div class="spacer" />
      <div class="tgroup">
        <Btn icon="zoomout" label="Zoom out (Ctrl+−)" onClick={() => setZoom(zoom.value / 1.2)} disabled={!has} />
        <button class="tb text zoom" title="Fit page" onClick={fitPage} disabled={!has}>{Math.round(zoom.value * 100)}%</button>
        <Btn icon="zoomin" label="Zoom in (Ctrl+=)" onClick={() => setZoom(zoom.value * 1.2)} disabled={!has} />
        <Btn icon="fit" label="Fit width" onClick={fitWidth} disabled={!has} />
      </div>
      <div class="search">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          id="search-input"
          type="search"
          placeholder="Find"
          disabled={!has}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch((e.target as HTMLInputElement).value, e.shiftKey ? -1 : 1);
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).value = "";
              runSearch("", 0);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onInput={(e) => !(e.target as HTMLInputElement).value && runSearch("", 0)}
        />
        {s.query && <span class="count">{s.hits.length ? `${s.index + 1}/${s.hits.length}` : "0"}</span>}
        <button class="tb small" title="Previous (Shift+Enter)" disabled={!s.hits.length} onClick={() => runSearch(s.query, -1)}><Icon name="up" size={15} /></button>
        <button class="tb small" title="Next (Enter)" disabled={!s.hits.length} onClick={() => runSearch(s.query, 1)}><Icon name="down" size={15} /></button>
      </div>
      <div class="tgroup">
        <Btn icon="keyboard" label="Keyboard shortcuts (?)" onClick={() => (dialog.value = "shortcuts")} />
        <a class="tb" href={SOURCE_URL} target="_blank" rel="noopener" title={`Source code (free software, ${LICENSE_NAME})`} aria-label="Source code">
          <Icon name="code" />
        </a>
        <Btn icon="panel" label="Toggle properties & comments" onClick={() => (showSide.value = !showSide.value)} active={showSide.value} disabled={!has} />
      </div>
    </header>
  );
}
