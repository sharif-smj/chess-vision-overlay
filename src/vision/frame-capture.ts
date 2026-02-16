export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D context for OffscreenCanvas');
    }
    return { canvas, ctx };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D context for HTMLCanvasElement');
  }
  return { canvas, ctx };
}

// Capture frames from YouTube video element.
export class FrameCapture {
  private canvas: AnyCanvas;
  private ctx: AnyCtx;
  private intervalId: number | null = null;
  private activeVideo: HTMLVideoElement | null = null;
  private onFrame: ((imageData: ImageData) => void) | null = null;

  constructor(private captureIntervalMs: number = 500) {
    const { canvas, ctx } = createCanvas(640, 480);
    this.canvas = canvas;
    this.ctx = ctx;
  }

  capture(videoElement: HTMLVideoElement): ImageData | null {
    if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;
    if (width === 0 || height === 0) {
      return null;
    }

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.ctx.drawImage(videoElement, 0, 0, width, height);
    return this.ctx.getImageData(0, 0, width, height);
  }

  start(videoElement: HTMLVideoElement, onFrame: (imageData: ImageData) => void): void {
    this.stop();
    this.activeVideo = videoElement;
    this.onFrame = onFrame;

    this.intervalId = window.setInterval(() => {
      const frame = this.capture(videoElement);
      if (frame) {
        onFrame(frame);
      }
    }, this.captureIntervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.activeVideo = null;
    this.onFrame = null;
  }

  setCaptureInterval(intervalMs: number): void {
    this.captureIntervalMs = intervalMs;
    if (this.activeVideo && this.onFrame) {
      this.start(this.activeVideo, this.onFrame);
    }
  }

  dispose(): void {
    this.stop();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  static crop(imageData: ImageData, rect: Rect): ImageData {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const maxWidth = imageData.width - x;
    const maxHeight = imageData.height - y;
    const width = Math.max(1, Math.min(Math.floor(rect.width), maxWidth));
    const height = Math.max(1, Math.min(Math.floor(rect.height), maxHeight));

    const output = new ImageData(width, height);
    const src = imageData.data;
    const dst = output.data;

    for (let row = 0; row < height; row++) {
      const srcOffset = ((y + row) * imageData.width + x) * 4;
      const dstOffset = row * width * 4;
      dst.set(src.subarray(srcOffset, srcOffset + width * 4), dstOffset);
    }

    return output;
  }
}
