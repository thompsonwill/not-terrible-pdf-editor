import { useEffect, useRef, useState } from "preact/hooks";
import { engine, renderPage } from "../engine/client";
import { extractPages, mutate, pickFile } from "../state/actions";
import { busy, currentPage, docInfo, goToPage, notify, pageRevs } from "../state/store";
import { Icon } from "../ui/icons";

const THUMB_W = 132;

function Thumb({ index, w, h, selected, current, onPick, onDrop }: {
  index: number; w: number; h: number; selected: boolean; current: boolean;
  onPick: (e: MouseEvent) => void; onDrop: (from: number, to: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [over, setOver] = useState<"before" | "after" | null>(null);
  const rev = pageRevs.value[index] ?? 0;
  const scale = THUMB_W / w;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "300px" });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const bmp = await renderPage(index, scale * (window.devicePixelRatio || 1), 1, () => !cancelled);
      const c = canvas.current;
      if (!bmp) return;
      if (!c || cancelled) return bmp.close();
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, rev, scale]);

  return (
    <div
      ref={ref}
      class={`thumb ${selected ? "selected" : ""} ${current ? "current" : ""} ${over ? `drop-${over}` : ""}`}
      draggable
      onClick={onPick}
      onDragStart={(e) => {
        e.dataTransfer!.setData("text/x-page", String(index));
        e.dataTransfer!.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer!.types.includes("text/x-page")) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setOver(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer!.getData("text/x-page"));
        const to = over === "after" ? index + 1 : index;
        setOver(null);
        if (!Number.isNaN(from)) onDrop(from, to);
      }}
    >
      <div class="thumb-img" style={{ width: `${THUMB_W}px`, height: `${h * scale}px` }}>
        {visible && <canvas ref={canvas} />}
      </div>
      <div class="thumb-label">{index + 1}</div>
    </div>
  );
}

export function Thumbnails() {
  const info = docInfo.value!;
  const [sel, setSel] = useState<Set<number>>(new Set());
  const anchor = useRef(0);
  const n = info.pages.length;
  const cur = currentPage.value;

  useEffect(() => {
    setSel((s) => new Set([...s].filter((i) => i < n)));
  }, [n]);

  const targets = () => (sel.size ? [...sel].sort((a, b) => a - b) : [cur]);

  const pick = (i: number, e: MouseEvent) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      setSel(new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k)));
    } else if (e.ctrlKey || e.metaKey) {
      const s = new Set(sel);
      s.has(i) ? s.delete(i) : s.add(i);
      setSel(s);
      anchor.current = i;
    } else {
      setSel(new Set());
      anchor.current = i;
      goToPage(i);
    }
  };

  const move = (from: number, to: number) => {
    const moving = sel.has(from) ? [...sel].sort((a, b) => a - b) : [from];
    const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !moving.includes(i));
    const insertAt = rest.filter((i) => i < to).length;
    const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    if (order.every((v, i) => v === i)) return;
    setSel(new Set(moving.map((_, k) => insertAt + k)));
    mutate(engine.reorderPages(order));
  };

  const rotate = (d: number) => mutate(engine.rotatePages(targets(), d));
  const del = async () => {
    const t = targets();
    if (t.length >= n) return notify("A PDF needs at least one page", "error");
    if (!confirm(`Delete ${t.length === 1 ? `page ${t[0] + 1}` : `${t.length} pages`}?`)) return;
    setSel(new Set());
    await mutate(engine.deletePages(t));
  };
  const insertBlank = () => {
    const t = targets();
    const after = t[t.length - 1];
    const p = info.pages[after];
    mutate(engine.insertBlankPage(after + 1, p.w, p.h));
  };
  const merge = async () => {
    const f = await pickFile("application/pdf,.pdf");
    if (!f) return;
    const t = targets();
    busy.value = "Inserting…";
    try {
      const c = await mutate(engine.mergePdf(new Uint8Array(await f.arrayBuffer()), t[t.length - 1] + 1));
      if (c) notify(`Inserted ${f.name}`);
    } finally {
      busy.value = null;
    }
  };

  return (
    <aside class="thumbs">
      <div class="thumbs-bar">
        <button class="tb" title="Rotate left" onClick={() => rotate(-90)}><Icon name="rotl" size={16} /></button>
        <button class="tb" title="Rotate right" onClick={() => rotate(90)}><Icon name="rotr" size={16} /></button>
        <button class="tb" title="Insert blank page after" onClick={insertBlank}><Icon name="plus" size={16} /></button>
        <button class="tb" title="Insert pages from another PDF after" onClick={merge}><Icon name="merge" size={16} /></button>
        <button class="tb" title="Extract pages to a new PDF" onClick={() => extractPages(targets())}><Icon name="extract" size={16} /></button>
        <button class="tb danger" title="Delete pages" onClick={del}><Icon name="trash" size={16} /></button>
      </div>
      <div class="thumbs-hint">{sel.size ? `${sel.size} selected` : `Page ${cur + 1} of ${n}`}</div>
      <div class="thumbs-list">
        {info.pages.map((p, i) => (
          <Thumb key={i} index={i} w={p.w} h={p.h} selected={sel.has(i)} current={i === cur} onPick={(e) => pick(i, e)} onDrop={move} />
        ))}
      </div>
    </aside>
  );
}
