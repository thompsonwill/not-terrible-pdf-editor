import { useEffect, useRef, useState } from "preact/hooks";
import { engine, renderPage } from "../engine/client";
import type { TextLine, WidgetInfo } from "../engine/types";
import { pageRevs, setPageAnnots, tool } from "../state/store";
import { Interaction } from "../tools/Interaction";
import { FormLayer } from "./FormLayer";
import { GAP } from "./Viewer";

const MAX_PIXELS = 24e6;

export function PageView({ index, w, h, z, visible }: { index: number; w: number; h: number; z: number; visible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rev = pageRevs.value[index] ?? 0;
  const [widgets, setWidgets] = useState<WidgetInfo[]>([]);
  const [lines, setLines] = useState<TextLine[]>([]);
  const [rendered, setRendered] = useState(false);
  const live = useRef({ visible, rev, z });
  live.current = { visible, rev, z };
  const editingText = tool.value === "edittext";

  // Render the page bitmap (debounced on zoom so pinch/wheel zooming stays smooth).
  useEffect(() => {
    if (!visible) {
      setRendered(false);
      return;
    }
    let cancelled = false;
    const delay = rendered ? 90 : 0;
    const t = setTimeout(async () => {
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(z * dpr, Math.sqrt(MAX_PIXELS / (w * h)));
      const bmp = await renderPage(index, scale, 0, () => !cancelled && live.current.visible);
      if (!bmp) return;
      const c = canvas.current;
      if (cancelled || !c) {
        bmp.close();
        return;
      }
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
      setRendered(true);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, rev, z, index, w, h]);

  // Annotation and form-field data for interaction.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    engine.listAnnots(index).then((a) => !cancelled && setPageAnnots(index, a)).catch(() => {});
    engine.listWidgets(index).then((wd) => !cancelled && setWidgets(wd)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, rev, index]);

  useEffect(() => {
    if (!visible || !editingText) return;
    let cancelled = false;
    engine.textLines(index).then((l) => !cancelled && setLines(l)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, rev, index, editingText]);

  return (
    <div
      class="page"
      data-page={index}
      style={{ width: `${w * z}px`, height: `${h * z}px`, marginBottom: `${GAP}px` }}
    >
      {visible && <canvas ref={canvas} class={rendered ? "page-canvas" : "page-canvas loading"} />}
      {visible && <Interaction page={index} w={w} h={h} z={z} lines={editingText ? lines : []} />}
      {visible && widgets.length > 0 && <FormLayer page={index} z={z} widgets={widgets} />}
    </div>
  );
}
