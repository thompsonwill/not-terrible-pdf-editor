import { engine, cancelRenders } from "../engine/client";
import type { AnnotPatch, AnnotSpec, Change, Rect, SaveOptions } from "../engine/types";
import {
  annotsByPage,
  applyChange,
  author,
  busy,
  docInfo,
  fileHandle,
  fileName,
  goToPage,
  inlineEdit,
  notify,
  pageRevs,
  search,
  selection,
  textSel,
  tool,
  zoom,
} from "./store";

/** Run an engine mutation, apply the change to the UI, and report errors as toasts. */
export async function mutate<T extends Change>(p: Promise<T>): Promise<T | null> {
  try {
    const c = await p;
    applyChange(c);
    return c;
  } catch (e) {
    notify(String((e as Error)?.message ?? e), "error");
    return null;
  }
}

// ---------- open ----------

const PICKER_TYPES = [{ description: "PDF documents", accept: { "application/pdf": [".pdf"] } }];

export async function openFromFile(file: File, handle: FileSystemFileHandle | null = null) {
  if (docInfo.value?.dirty && !confirm("Discard unsaved changes to the current document?")) return;
  busy.value = "Opening…";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    cancelRenders();
    let { needsPassword } = await engine.open(bytes);
    while (needsPassword) {
      const pw = prompt(`"${file.name}" is password-protected. Password:`);
      if (pw === null) {
        busy.value = null;
        return;
      }
      needsPassword = !(await engine.authenticate(pw));
      if (needsPassword) notify("Wrong password", "error");
    }
    const info = await engine.info();
    fileName.value = file.name;
    fileHandle.current = handle;
    selection.value = null;
    textSel.value = null;
    inlineEdit.value = null;
    search.value = { query: "", hits: [], index: 0 };
    annotsByPage.value = new Map();
    pageRevs.value = info.pages.map(() => 0);
    tool.value = "select";
    docInfo.value = info;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        fitWidth();
        requestAnimationFrame(() => goToPage(0));
      }),
    );
    document.title = `${file.name} — PDF Editor`;
  } catch (e) {
    notify(`Couldn't open ${file.name}: ${(e as Error).message ?? e}`, "error");
  } finally {
    busy.value = null;
  }
}

export async function openDialog() {
  if ("showOpenFilePicker" in window) {
    try {
      const [h] = await (window as any).showOpenFilePicker({ types: PICKER_TYPES });
      await openFromFile(await h.getFile(), h);
    } catch (e) {
      if ((e as Error).name !== "AbortError") notify(String(e), "error");
    }
    return;
  }
  const f = await pickFile("application/pdf,.pdf");
  if (f) await openFromFile(f);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ---------- save ----------

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function writeHandle(h: FileSystemFileHandle, bytes: Uint8Array) {
  const w = await (h as any).createWritable();
  await w.write(bytes);
  await w.close();
}

/** Ctrl+S: overwrite the open file when the browser allows it, otherwise download. */
export async function save() {
  if (!docInfo.value) return;
  busy.value = "Saving…";
  try {
    const bytes = await engine.save({});
    const h = fileHandle.current;
    if (h && "createWritable" in h) {
      await writeHandle(h, bytes);
      notify(`Saved ${fileName.value}`);
    } else if ("showSaveFilePicker" in window) {
      busy.value = null;
      return saveAs({});
    } else {
      download(bytes, fileName.value || "document.pdf");
    }
    await engine.markSaved();
    docInfo.value = { ...docInfo.value!, dirty: false };
  } catch (e) {
    if ((e as Error).name !== "AbortError") notify(`Save failed: ${(e as Error).message ?? e}`, "error");
  } finally {
    busy.value = null;
  }
}

export async function saveAs(opts: SaveOptions, suggested?: string) {
  if (!docInfo.value) return;
  const flattened = !!(opts.flattenAnnots || opts.flattenForms);
  const base = fileName.value.replace(/\.pdf$/i, "") || "document";
  const name = suggested ?? (flattened ? `${base}-flattened.pdf` : `${base}.pdf`);
  busy.value = "Saving…";
  try {
    const bytes = await engine.save(opts);
    if ("showSaveFilePicker" in window) {
      busy.value = null;
      const h: FileSystemFileHandle = await (window as any).showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES });
      busy.value = "Saving…";
      await writeHandle(h, bytes);
      if (!flattened) {
        fileHandle.current = h;
        fileName.value = h.name;
        document.title = `${h.name} — PDF Editor`;
      }
    } else download(bytes, name);
    if (!flattened) {
      await engine.markSaved();
      docInfo.value = { ...docInfo.value!, dirty: false };
    }
    notify(`Saved ${name}`);
  } catch (e) {
    if ((e as Error).name !== "AbortError") notify(`Save failed: ${(e as Error).message ?? e}`, "error");
  } finally {
    busy.value = null;
  }
}

export async function extractPages(indices: number[]) {
  const bytes = await engine.extractPages([...indices].sort((a, b) => a - b));
  const base = fileName.value.replace(/\.pdf$/i, "") || "document";
  const label = indices.length === 1 ? `page-${indices[0] + 1}` : `${indices.length}-pages`;
  if ("showSaveFilePicker" in window) {
    try {
      const h = await (window as any).showSaveFilePicker({ suggestedName: `${base}-${label}.pdf`, types: PICKER_TYPES });
      await writeHandle(h, bytes);
    } catch (e) {
      if ((e as Error).name !== "AbortError") notify(String(e), "error");
    }
  } else download(bytes, `${base}-${label}.pdf`);
}

// ---------- history ----------

export async function undo() {
  if (!docInfo.value?.canUndo) return;
  inlineEdit.value = null;
  textSel.value = null;
  await mutate(engine.undo());
}
export async function redo() {
  if (!docInfo.value?.canRedo) return;
  inlineEdit.value = null;
  textSel.value = null;
  await mutate(engine.redo());
}

// ---------- annotations ----------

export async function createAnnot(page: number, spec: AnnotSpec, select = true) {
  const withAuthor = { ...spec, author: spec.author ?? (author.value || undefined) };
  const c = await mutate(engine.createAnnot(page, withAuthor));
  if (c && select) selection.value = { page, id: c.result };
  return c?.result ?? null;
}
export async function updateAnnot(page: number, id: number, patch: AnnotPatch) {
  return mutate(engine.updateAnnot(page, id, patch));
}
export async function transformAnnot(page: number, id: number, rect: Rect) {
  return mutate(engine.transformAnnot(page, id, rect));
}
export async function deleteSelected() {
  const s = selection.value;
  if (!s) return;
  selection.value = null;
  await mutate(engine.deleteAnnot(s.page, s.id));
}

// ---------- zoom ----------

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export function setZoom(z: number) {
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
}
export function fitWidth() {
  const el = document.querySelector(".viewer");
  const info = docInfo.value;
  if (!el || !info?.pages.length) return;
  const maxW = Math.max(...info.pages.map((p) => p.w));
  setZoom(Math.min(2, (el.clientWidth - 48) / maxW));
}
export function fitPage() {
  const el = document.querySelector(".viewer");
  const info = docInfo.value;
  if (!el || !info?.pages.length) return;
  const p = info.pages[0];
  setZoom(Math.min((el.clientWidth - 48) / p.w, (el.clientHeight - 32) / p.h));
}
