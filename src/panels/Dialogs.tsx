import { useState } from "preact/hooks";
import { saveAs } from "../state/actions";
import { dialog } from "../state/store";
import { Icon } from "../ui/icons";

function Modal({ title, children, foot }: { title: string; children: any; foot?: any }) {
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && (dialog.value = null)}>
      <div class="modal" role="dialog" aria-label={title}>
        <div class="modal-head">
          <h2>{title}</h2>
          <button class="tb" onClick={() => (dialog.value = null)} title="Close"><Icon name="close" /></button>
        </div>
        <div class="modal-body">{children}</div>
        {foot && <div class="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function SaveDialog() {
  const [annots, setAnnots] = useState(false);
  const [forms, setForms] = useState(false);
  return (
    <Modal
      title="Save a copy"
      foot={
        <>
          <span class="spacer" />
          <button class="btn ghost" onClick={() => (dialog.value = null)}>Cancel</button>
          <button class="btn primary" onClick={() => { dialog.value = null; saveAs({ flattenAnnots: annots, flattenForms: forms }); }}>Save…</button>
        </>
      }
    >
      <label class="check-row">
        <input type="checkbox" checked={annots} onChange={(e) => setAnnots((e.target as HTMLInputElement).checked)} />
        <span><b>Flatten annotations</b><br /><span class="muted">Burn highlights, shapes, text boxes and signatures into the page so they can't be moved or deleted by others.</span></span>
      </label>
      <label class="check-row">
        <input type="checkbox" checked={forms} onChange={(e) => setForms((e.target as HTMLInputElement).checked)} />
        <span><b>Flatten form fields</b><br /><span class="muted">Turn filled-in form fields into plain page content.</span></span>
      </label>
      <p class="muted small">Flattened copies are saved as a new file; your working document stays editable.</p>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+O", "Open"],
  ["Ctrl+S", "Save"],
  ["Ctrl+Shift+S", "Save a copy / flatten"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+F", "Find"],
  ["Ctrl+C", "Copy selected text"],
  ["Ctrl + wheel, Ctrl+= / Ctrl+−", "Zoom"],
  ["Ctrl+0", "Fit width"],
  ["Delete", "Delete selected annotation"],
  ["Arrow keys", "Nudge selected annotation (Shift = 10×)"],
  ["Esc", "Back to Select tool / cancel"],
  ["V E T N", "Select, Edit text, Add text, Note"],
  ["H U K", "Highlight, Underline, Strikethrough"],
  ["P R O L A G", "Pen, Rectangle, Ellipse, Line, Arrow, Polygon"],
  ["S I W X", "Signature, Image, Whiteout, Redact"],
  ["PgUp / PgDn", "Previous / next page"],
];

export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts">
      <table class="keys">
        {SHORTCUTS.map(([k, v]) => (
          <tr><td><kbd>{k}</kbd></td><td>{v}</td></tr>
        ))}
      </table>
    </Modal>
  );
}
