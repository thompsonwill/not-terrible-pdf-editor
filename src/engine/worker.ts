/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { Engine } from "./engine";

class WorkerEngine extends Engine {
  /** Render straight to an ImageBitmap so the pixels are transferred, not copied. */
  async renderBitmap(i: number, scale: number): Promise<ImageBitmap> {
    const { pixels, w, h } = this.renderRGBA(i, scale);
    const bmp = await createImageBitmap(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, w, h));
    return Comlink.transfer(bmp, [bmp]);
  }
}

Comlink.expose(new WorkerEngine());
export type { WorkerEngine };
