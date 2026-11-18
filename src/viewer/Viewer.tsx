import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { currentPage, docInfo, scrollRequest, zoom } from "../state/store";
import { setZoom } from "../state/actions";
import { PageView } from "./PageView";

export const GAP = 16;
export const PAD = 24;

export function Viewer() {
  const ref = useRef<HTMLDivElement>(null);
  const info = docInfo.value!;
  const z = zoom.value;
  const [range, setRange] = useState<[number, number]>([0, 2]);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const prevZoom = useRef(z);

  const tops = useMemo(() => {
    const t: number[] = [];
    let y = PAD;
    for (const p of info.pages) {
      t.push(y);
      y += p.h * z + GAP;
    }
    t.push(y - GAP + PAD);
    return t;
  }, [info.pages, z]);

  const maxW = useMemo(() => Math.max(...info.pages.map((p) => p.w)), [info.pages]);

  const updateRange = () => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const n = info.pages.length;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid + 1] - GAP < top) lo = mid + 1;
      else hi = mid;
    }
    let last = lo;
    while (last < n - 1 && tops[last + 1] < bottom) last++;
    setRange((r) => (r[0] === lo && r[1] === last ? r : [lo, last]));
    // Current page = the one crossing 40% of the viewport height.
    const probe = top + el.clientHeight * 0.4;
    let cur = lo;
    while (cur < last && tops[cur + 1] <= probe) cur++;
    if (currentPage.value !== cur) currentPage.value = cur;
  };

  // Keep the point under the cursor (or the viewport centre) fixed while zooming.
  useLayoutEffect(() => {
    const el = ref.current;
    const old = prevZoom.current;
    prevZoom.current = z;
    if (!el || old === z) return;
    const a = anchor.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    anchor.current = null;
    const r = z / old;
    el.scrollLeft = (el.scrollLeft + a.x) * r - a.x;
    el.scrollTop = PAD + (el.scrollTop + a.y - PAD) * r - a.y;
    updateRange();
  }, [z]);

  useEffect(updateRange, [tops]);

  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      anchor.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setZoom(zoom.value * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const req = scrollRequest.value;
    const el = ref.current;
    if (!req || !el || req.page >= info.pages.length) return;
    const y = tops[req.page] + (req.y !== undefined ? req.y * z - el.clientHeight / 3 : -PAD / 2);
    el.scrollTo({ top: Math.max(0, y) });
  }, [scrollRequest.value]);

  const [first, last] = range;
  return (
    <div class="viewer" ref={ref} onScroll={updateRange}>
      <div class="pages" style={{ width: `${maxW * z + PAD * 2}px`, paddingTop: `${PAD}px`, paddingBottom: `${PAD}px` }}>
        {info.pages.map((p, i) => (
          <PageView key={i} index={i} w={p.w} h={p.h} z={z} visible={i >= first - 1 && i <= last + 1} />
        ))}
      </div>
    </div>
  );
}
