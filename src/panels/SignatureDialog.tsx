import { useEffect, useRef, useState } from "preact/hooks";
import { dialog, notify, persist, placing, tool } from "../state/store";
import { Icon } from "../ui/icons";

interface Saved {
  id: string;
  dataUrl: string;
  w: number;
  h: number;
}

const KEY = "pdfedit.signatures";
function loadSaved(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Crop a canvas to its non-transparent pixels and return a PNG. */
function trim(c: HTMLCanvasElement): { dataUrl: string; w: number; h: number } | null {
  const ctx = c.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL("image/png"), w: out.width, h: out.height };
}

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.split(",")[1]);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function use(sig: { dataUrl: string; w: number; h: number }) {
  // Place about 160pt wide (a typical signature), keeping aspect ratio.
  const w = Math.min(160, sig.w / 2);
  const h = (w * sig.h) / sig.w;
  const bytes = dataUrlBytes(sig.dataUrl);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  placing.value = { bytes, url, w, h, kind: "signature" };
  tool.value = "select";
  dialog.value = null;
  notify("Click on a page to place your signature");
}

const INKS = ["#111111", "#1a3fa8"];

function DrawPad({ ink, onReady }: { ink: string; onReady: (c: HTMLCanvasElement | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr * 1.5;
    c.height = c.clientHeight * dpr * 1.5;
    onReady(null);
  }, []);
  const pos = (e: PointerEvent): [number, number] => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const draw = (e: PointerEvent) => {
    if (!last.current) return;
    const ctx = ref.current!.getContext("2d")!;
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const evs = (e as any).getCoalescedEvents?.() ?? [e];
    for (const ev of evs) {
      const p = pos(ev);
      const pressure = ev.pointerType === "pen" && ev.pressure ? 0.5 + ev.pressure : 1;
      ctx.lineWidth = 4.5 * pressure * (ref.current!.width / 900);
      ctx.beginPath();
      ctx.moveTo(...last.current);
      ctx.lineTo(...p);
      ctx.stroke();
      last.current = p;
    }
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onReady(null);
  };
  return (
    <div class="pad-wrap">
      <canvas
        ref={ref}
        class="pad"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          last.current = pos(e);
          draw(e);
        }}
        onPointerMove={draw}
        onPointerUp={() => {
          last.current = null;
          setEmpty(false);
          onReady(ref.current);
        }}
      />
      <div class="pad-line">{empty && <span>Sign here</span>}</div>
      <button class="btn ghost small clear" onClick={clear}>Clear</button>
    </div>
  );
}

export function SignatureDialog() {
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [ink, setInk] = useState(INKS[0]);
  const [typed, setTyped] = useState("");
  const [remember, setRemember] = useState(true);
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null);
  const [knockout, setKnockout] = useState(true);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const drawn = useRef<HTMLCanvasElement | null>(null);
  const [drawReady, setDrawReady] = useState(false);

  // Uploaded image → canvas, optionally making a white background transparent.
  useEffect(() => {
    if (!uploadFile) return;
    (async () => {
      const bmp = await createImageBitmap(uploadFile);
      const scale = Math.min(1, 1200 / bmp.width);
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      if (knockout) {
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum > 215) d[i + 3] = 0;
          else if (lum > 160) d[i + 3] = Math.round((d[i + 3] * (215 - lum)) / 55);
        }
        ctx.putImageData(img, 0, 0);
      }
      setUpload(c);
    })().catch(() => notify("That image couldn't be read", "error"));
  }, [uploadFile, knockout]);

  const typedCanvas = () => {
    const c = document.createElement("canvas");
    c.width = 1400;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = ink;
    ctx.font = "160px 'Dancing Script', cursive";
    ctx.textBaseline = "middle";
    ctx.fillText(typed, 20, 150, 1360);
    return c;
  };

  const create = async () => {
    let c: HTMLCanvasElement | null = null;
    if (tab === "draw") c = drawn.current;
    else if (tab === "type") {
      if (!typed.trim()) return;
      await document.fonts.load("160px 'Dancing Script'");
      c = typedCanvas();
    } else c = upload;
    if (!c) return;
    const sig = trim(c);
    if (!sig) return notify("The signature is empty", "error");
    if (remember) {
      const next = [{ id: String(Date.now()), ...sig }, ...saved].slice(0, 8);
      setSaved(next);
      persist(KEY, next);
    }
    use(sig);
  };

  const remove = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    persist(KEY, next);
  };

  const ready = tab === "draw" ? drawReady : tab === "type" ? !!typed.trim() : !!upload;

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && (dialog.value = null)}>
      <div class="modal sig" role="dialog" aria-label="Signature">
        <div class="modal-head">
          <h2>Signature</h2>
          <button class="tb" onClick={() => (dialog.value = null)} title="Close"><Icon name="close" /></button>
        </div>
        {saved.length > 0 && (
          <div class="saved-sigs">
            {saved.map((s) => (
              <div class="saved-sig">
                <button onClick={() => use(s)} title="Use this signature"><img src={s.dataUrl} alt="Saved signature" /></button>
                <button class="x" onClick={() => remove(s.id)} title="Forget this signature"><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div class="tabs">
          {(["draw", "type", "upload"] as const).map((t) => (
            <button class={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
          {tab !== "upload" && (
            <span class="inks">
              {INKS.map((c) => (
                <button class={ink === c ? "ink on" : "ink"} style={{ background: c }} onClick={() => setInk(c)} title="Ink color" />
              ))}
            </span>
          )}
        </div>
        <div class="tab-body">
          {tab === "draw" && <DrawPad ink={ink} onReady={(c) => { drawn.current = c; setDrawReady(!!c); }} />}
          {tab === "type" && (
            <div class="type-sig">
              <input autoFocus value={typed} placeholder="Type your name" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
              <div class="type-preview" style={{ color: ink }}>{typed || " "}</div>
            </div>
          )}
          {tab === "upload" && (
            <div class="upload-sig">
              <input type="file" accept="image/*" onChange={(e) => setUploadFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
              <label><input type="checkbox" checked={knockout} onChange={(e) => setKnockout((e.target as HTMLInputElement).checked)} /> Remove white background</label>
              {upload && <img class="upload-preview" src={upload.toDataURL()} alt="Preview" />}
            </div>
          )}
        </div>
        <div class="modal-foot">
          <label><input type="checkbox" checked={remember} onChange={(e) => setRemember((e.target as HTMLInputElement).checked)} /> Remember on this device</label>
          <span class="spacer" />
          <button class="btn ghost" onClick={() => (dialog.value = null)}>Cancel</button>
          <button class="btn primary" disabled={!ready} onClick={create}>Place signature</button>
        </div>
      </div>
    </div>
  );
}
