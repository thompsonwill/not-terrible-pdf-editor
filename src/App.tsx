import { useEffect, useState } from "preact/hooks";
import { deleteSelected, fitWidth, openDialog, openFromFile, redo, save, setZoom, transformAnnot, undo } from "./state/actions";
import {
  busy,
  currentPage,
  dialog,
  docInfo,
  goToPage,
  inlineEdit,
  placing,
  selectedAnnot,
  selection,
  showSide,
  showThumbs,
  textEdit,
  textSel,
  toast,
  tool,
  zoom,
} from "./state/store";
import { Toolbar, TOOL_KEYS, chooseTool } from "./panels/Toolbar";
import { Thumbnails } from "./panels/Thumbnails";
import { SidePanel } from "./panels/SidePanel";
import { SignatureDialog } from "./panels/SignatureDialog";
import { SaveDialog, ShortcutsDialog } from "./panels/Dialogs";
import { Viewer } from "./viewer/Viewer";
import { copySelection } from "./tools/SelectionMenu";
import { Icon } from "./ui/icons";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

function onKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const has = !!docInfo.value;
  if (mod && k === "o") return e.preventDefault(), openDialog();
  if (mod && k === "s") {
    e.preventDefault();
    if (has) e.shiftKey ? (dialog.value = "save") : save();
    return;
  }
  if (mod && k === "f" && has) {
    e.preventDefault();
    const el = document.getElementById("search-input") as HTMLInputElement | null;
    el?.focus();
    el?.select();
    return;
  }
  if (isTyping(e.target) || dialog.value || inlineEdit.value || textEdit.value || !has) return;
  if (mod && k === "z") return e.preventDefault(), e.shiftKey ? redo() : undo();
  if (mod && k === "y") return e.preventDefault(), redo();
  if (mod && k === "c" && textSel.value) return e.preventDefault(), copySelection();
  if (mod && (k === "=" || k === "+")) return e.preventDefault(), setZoom(zoom.value * 1.2);
  if (mod && k === "-") return e.preventDefault(), setZoom(zoom.value / 1.2);
  if (mod && k === "0") return e.preventDefault(), fitWidth();
  if (mod || e.altKey) return;

  if ((k === "delete" || k === "backspace") && selection.value) return e.preventDefault(), deleteSelected();
  if (k === "escape") {
    if (placing.value) {
      URL.revokeObjectURL(placing.value.url);
      placing.value = null;
    }
    textSel.value = null;
    selection.value = null;
    tool.value = "select";
    return;
  }
  const a = selectedAnnot.value;
  const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k] && a && selection.value && !["Highlight", "Underline", "StrikeOut", "Squiggly"].includes(a.type)) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const [dx, dy] = arrows[k];
    const r = a.rect;
    transformAnnot(selection.value.page, a.id, [r[0] + dx * d, r[1] + dy * d, r[2] + dx * d, r[3] + dy * d]);
    return;
  }
  if (k === "pagedown") return e.preventDefault(), goToPage(Math.min(docInfo.value!.pages.length - 1, currentPage.value + 1));
  if (k === "pageup") return e.preventDefault(), goToPage(Math.max(0, currentPage.value - 1));
  if (k === "?") return (dialog.value = "shortcuts");
  if (TOOL_KEYS[k]) return chooseTool(TOOL_KEYS[k]);
}

function Toast() {
  const t = toast.value;
  const [shown, setShown] = useState<typeof t>(null);
  useEffect(() => {
    if (!t) return;
    setShown(t);
    const id = setTimeout(() => setShown(null), t.kind === "error" ? 6000 : 2500);
    return () => clearTimeout(id);
  }, [t?.n]);
  if (!shown) return null;
  return <div class={`toast ${shown.kind}`} role="status" onClick={() => setShown(null)}>{shown.msg}</div>;
}

function Empty() {
  return (
    <div class="empty">
      <div class="empty-card">
        <div class="empty-icon"><Icon name="open" size={40} /></div>
        <h1>Open a PDF</h1>
        <p>Drop a file anywhere, or</p>
        <button class="btn primary big" onClick={openDialog}>Choose PDF…</button>
        <p class="muted small">Everything happens on this computer. Nothing is uploaded.</p>
      </div>
    </div>
  );
}

export function App() {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (docInfo.value?.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    // Opened from the OS via the installed app's file handler.
    const lq = (window as any).launchQueue;
    lq?.setConsumer(async (params: { files: FileSystemFileHandle[] }) => {
      const h = params.files?.[0];
      if (h) openFromFile(await h.getFile(), h);
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  const onDrop = async (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    setDragging(false);
    const item = [...e.dataTransfer.items].find((i) => i.kind === "file");
    if (!item) return;
    const handle = await (item as any).getAsFileSystemHandle?.().catch?.(() => null);
    const file = item.getAsFile();
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return;
    openFromFile(file, handle?.kind === "file" ? handle : null);
  };

  const has = !!docInfo.value;
  return (
    <div
      class="app"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.relatedTarget === null && setDragging(false)}
      onDrop={onDrop}
    >
      <Toolbar />
      <main class="main">
        {has && showThumbs.value && <Thumbnails />}
        {has ? <Viewer /> : <Empty />}
        {has && showSide.value && <SidePanel />}
      </main>
      {dialog.value === "signature" && <SignatureDialog />}
      {dialog.value === "save" && <SaveDialog />}
      {dialog.value === "shortcuts" && <ShortcutsDialog />}
      {dragging && <div class="drop-hint">Drop PDF to open</div>}
      {busy.value && <div class="busy">{busy.value}</div>}
      <Toast />
    </div>
  );
}
