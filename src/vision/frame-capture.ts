// Capture frames from YouTube video element
export class FrameCapture {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private intervalId: number | null = null;

  constructor(private captureIntervalMs: number = 1500) {
    this.canvas = new OffscreenCanvas(640, 480);
    this.ctx = this.canvas.getContext('2d')!;
  }

  start(videoElement: HTMLVideoElement, onFrame: (imageData: ImageData) => void) {
    this.stop();
    this.intervalId = window.setInterval(() => {
      this.canvas.width = videoElement.videoWidth;
      this.canvas.height = videoElement.videoHeight;
      this.ctx.drawImage(videoElement, 0, 0);
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      onFrame(imageData);
    }, this.captureIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
