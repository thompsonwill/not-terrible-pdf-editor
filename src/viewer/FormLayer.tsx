import { useEffect, useState } from "preact/hooks";
import { engine } from "../engine/client";
import type { WidgetInfo } from "../engine/types";
import { mutate } from "../state/actions";
import { tool } from "../state/store";

function TextField({ page, wd, z }: { page: number; wd: WidgetInfo; z: number }) {
  const [val, setVal] = useState(wd.value);
  useEffect(() => setVal(wd.value), [wd.value]);
  const commit = () => {
    if (val !== wd.value) mutate(engine.setWidget(page, wd.id, val));
  };
  const h = wd.rect[3] - wd.rect[1];
  const fontSize = Math.max(8, Math.min(14, h * 0.7)) * z;
  const common = {
    class: "field",
    value: val,
    readOnly: wd.readOnly,
    title: wd.name,
    maxLength: wd.maxLen > 0 ? wd.maxLen : undefined,
    style: { fontSize: `${fontSize}px` },
    onInput: (e: Event) => setVal((e.target as HTMLInputElement).value),
    onBlur: commit,
  };
  return wd.multiline ? (
    <textarea {...common} />
  ) : (
    <input {...common} type="text" onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

export function FormLayer({ page, z, widgets }: { page: number; z: number; widgets: WidgetInfo[] }) {
  const active = tool.value === "select";
  return (
    <div class={active ? "form-layer" : "form-layer inactive"}>
      {widgets.map((wd) => {
        if (wd.kind === "button" || wd.kind === "signature" || wd.kind === "unknown") return null;
        const [x0, y0, x1, y1] = wd.rect;
        const style = { left: `${x0 * z}px`, top: `${y0 * z}px`, width: `${(x1 - x0) * z}px`, height: `${(y1 - y0) * z}px` };
        let el;
        if (wd.kind === "text") el = <TextField page={page} wd={wd} z={z} />;
        else if (wd.kind === "checkbox" || wd.kind === "radio")
          el = (
            <button
              class={`field check ${wd.kind} ${wd.checked ? "on" : ""}`}
              disabled={wd.readOnly}
              title={wd.name}
              aria-pressed={wd.checked}
              onClick={() => mutate(engine.setWidget(page, wd.id, !wd.checked))}
            />
          );
        else
          el = (
            <select
              class="field"
              disabled={wd.readOnly}
              title={wd.name}
              size={wd.kind === "list" ? Math.max(2, Math.floor((y1 - y0) / 14)) : undefined}
              style={{ fontSize: `${Math.max(8, Math.min(13, (y1 - y0) * 0.65)) * z}px` }}
              onChange={(e) => mutate(engine.setWidget(page, wd.id, (e.target as HTMLSelectElement).value))}
            >
              {!wd.options.includes(wd.value) && <option value="">{wd.value}</option>}
              {wd.options.map((o) => (
                <option value={o} selected={o === wd.value}>
                  {o}
                </option>
              ))}
            </select>
          );
        return (
          <div class="field-wrap" style={style} key={wd.id}>
            {el}
          </div>
        );
      })}
    </div>
  );
}
