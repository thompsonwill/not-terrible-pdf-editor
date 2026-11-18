import { signal, computed } from "@preact/signals";
import type { AnnotInfo, Change, DocInfo, Point, Quad, SearchHit } from "../engine/types";

export type Tool =
  | "select"
  | "edittext"
  | "text"
  | "note"
  | "highlight"
  | "underline"
  | "strike"
  | "pen"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "signature"
  | "image"
  | "whiteout"
  | "redact";

export interface Style {
  stroke: string;
  fill: string | null;
  width: number;
  opacity: number;
  highlight: string;
  textColor: string;
  fontSize: number;
  font: "Helv" | "TiRo" | "Cour";
}

const DEFAULT_STYLE: Style = {
  stroke: "#e53935",
  fill: null,
  width: 2,
  opacity: 1,
  highlight: "#ffe14d",
  textColor: "#111111",
  fontSize: 14,
  font: "Helv",
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
export function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// ---------- document ----------
export const docInfo = signal<DocInfo | null>(null);
export const fileName = signal("");
export const fileHandle: { current: FileSystemFileHandle | null } = { current: null };
/** Per-page render revision; bumping it re-renders that page and refetches its annotations. */
export const pageRevs = signal<number[]>([]);
export const docRev = signal(0);

export function applyChange(c: Change) {
  docInfo.value = c.info;
  const n = c.info.pages.length;
  const prev = pageRevs.value;
  const next = Array.from({ length: n }, (_, i) => prev[i] ?? 0);
  if (c.pages === "all" || c.structure) for (let i = 0; i < n; i++) next[i]++;
  else for (const i of c.pages) if (i < n) next[i]++;
  pageRevs.value = next;
  docRev.value++;
  if (c.structure || c.pages === "all") selection.value = null;
}

// ---------- view ----------
export const zoom = signal(1);
export const currentPage = signal(0);
export const showThumbs = signal(true);
export const showSide = signal(true);
export const scrollRequest = signal<{ page: number; y?: number; n: number } | null>(null);
export function goToPage(page: number, y?: number) {
  scrollRequest.value = { page, y, n: (scrollRequest.value?.n ?? 0) + 1 };
}

// ---------- tools ----------
export const tool = signal<Tool>("select");
export const style = signal<Style>(load("pdfedit.style", DEFAULT_STYLE));
export function setStyle(patch: Partial<Style>) {
  style.value = { ...style.value, ...patch };
  persist("pdfedit.style", style.value);
}
export const author = signal<string>(load("pdfedit.author", { name: "" }).name);
export function setAuthor(name: string) {
  author.value = name;
  persist("pdfedit.author", { name });
}

/** Image waiting to be placed (signature or picture). */
export const placing = signal<{ bytes: Uint8Array; url: string; w: number; h: number; kind: "signature" | "image" } | null>(null);

// ---------- selection ----------
export const selection = signal<{ page: number; id: number } | null>(null);
export const annotsByPage = signal<Map<number, AnnotInfo[]>>(new Map());
export const selectedAnnot = computed(() => {
  const s = selection.value;
  if (!s) return null;
  return annotsByPage.value.get(s.page)?.find((a) => a.id === s.id) ?? null;
});
export function setPageAnnots(page: number, list: AnnotInfo[]) {
  const m = new Map(annotsByPage.value);
  m.set(page, list);
  annotsByPage.value = m;
}

export const textSel = signal<{ page: number; quads: Quad[]; p: Point; q: Point } | null>(null);

/** An annotation being edited inline (FreeText contents or sticky-note comment). */
export const inlineEdit = signal<{ page: number; id: number | null; kind: "freetext" | "note"; at: Point } | null>(null);

// ---------- search ----------
export const search = signal<{ query: string; hits: SearchHit[]; index: number }>({ query: "", hits: [], index: 0 });

// ---------- ui ----------
export const toast = signal<{ msg: string; kind: "info" | "error"; n: number } | null>(null);
export function notify(msg: string, kind: "info" | "error" = "info") {
  toast.value = { msg, kind, n: (toast.value?.n ?? 0) + 1 };
}
export const dialog = signal<null | "signature" | "save" | "shortcuts">(null);
export const busy = signal<string | null>(null);

// ---------- color helpers ----------
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(c: number[] | undefined): string {
  if (!c || c.length === 0) return "#000000";
  const rgb = c.length === 1 ? [c[0], c[0], c[0]] : c.slice(0, 3);
  return "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
}

/** Re-render one page without a document change (e.g. after hiding an annotation for editing). */
export function bumpPage(i: number) {
  const next = [...pageRevs.value];
  next[i] = (next[i] ?? 0) + 1;
  pageRevs.value = next;
}

/** Existing-text line currently being edited with the Edit Text tool. */
export const textEdit = signal<{ page: number; line: import("../engine/types").TextLine } | null>(null);
