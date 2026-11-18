import * as Comlink from "comlink";
import type { WorkerEngine } from "./worker";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
export const engine = Comlink.wrap<WorkerEngine>(worker);

/**
 * Render scheduler: at most two renders in flight; requests for pages that scrolled out of view
 * are dropped before they reach the worker. Priority 0 = main view, 1 = thumbnails.
 */
interface Job {
  key: string;
  page: number;
  scale: number;
  prio: number;
  wanted: () => boolean;
  resolve: (b: ImageBitmap | null) => void;
}
const queue: Job[] = [];
let inFlight = 0;

export function renderPage(page: number, scale: number, prio: number, wanted: () => boolean): Promise<ImageBitmap | null> {
  return new Promise((resolve) => {
    const key = `${prio}:${page}`;
    const existing = queue.findIndex((j) => j.key === key);
    if (existing >= 0) queue.splice(existing, 1)[0].resolve(null);
    queue.push({ key, page, scale, prio, wanted, resolve });
    pump();
  });
}

export function cancelRenders() {
  for (const j of queue.splice(0)) j.resolve(null);
}

function pump() {
  while (inFlight < 2 && queue.length) {
    queue.sort((a, b) => a.prio - b.prio);
    const job = queue.shift()!;
    if (!job.wanted()) {
      job.resolve(null);
      continue;
    }
    inFlight++;
    engine
      .renderBitmap(job.page, job.scale)
      .then((b) => job.resolve(b), (err) => {
        console.warn("render failed", err);
        job.resolve(null);
      })
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}
