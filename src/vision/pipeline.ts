import { ChangeDetector } from './change-detector';
import { FrameCapture, type Rect } from './frame-capture';

export type BoardRegion = Rect;

interface VisionWorkerResult {
  type: 'result';
  requestId: number;
  fen: string;
  boardRegion: BoardRegion;
  confidenceAverage: number;
  lowConfidenceSquares: number;
  detectorMs: number;
  classifierMs: number;
  processingMs: number;
  wasFlipped: boolean;
}

interface VisionWorkerError {
  type: 'error';
  requestId: number;
  message: string;
}

type VisionWorkerMessage = VisionWorkerResult | VisionWorkerError;

export interface VisionPipelineOptions {
  captureIntervalMs: number;
  boardRefreshMs: number;
  lowConfidenceThreshold: number;
}

export interface VisionPerformanceStats {
  fps: number;
  processingMs: number;
  detectorMs: number;
  classifierMs: number;
  confidenceAverage: number;
  lowConfidenceSquares: number;
}

export interface VisionPipelineUpdate {
  fen: string;
  boardRegion: BoardRegion;
  change: 'no-change' | 'move' | 'new-game';
  timestamp: number;
  wasFlipped: boolean;
  performance: VisionPerformanceStats;
}

const DEFAULT_OPTIONS: VisionPipelineOptions = {
  captureIntervalMs: 1500,
  boardRefreshMs: 1000,
  lowConfidenceThreshold: 0.58,
};

export class VisionPipeline {
  private readonly options: VisionPipelineOptions;
  private readonly frameCapture: FrameCapture;
  private readonly changeDetector: ChangeDetector;
  private readonly worker: Worker;

  private running = false;
  private activeVideo: HTMLVideoElement | null = null;
  private latestRequestId = 0;
  private lastDeliveredAt = 0;
  private forceFlip = false;

  constructor(
    deps?: {
      frameCapture?: FrameCapture;
      changeDetector?: ChangeDetector;
    },
    options: Partial<VisionPipelineOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.frameCapture = deps?.frameCapture ?? new FrameCapture(this.options.captureIntervalMs);
    this.changeDetector = deps?.changeDetector ?? new ChangeDetector();

    this.worker = new Worker(new URL('./vision-worker.ts', import.meta.url), { type: 'module' });
  }

  start(videoElement: HTMLVideoElement, onUpdate: (update: VisionPipelineUpdate) => void): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.activeVideo = videoElement;

    this.worker.onmessage = (event: MessageEvent<VisionWorkerMessage>) => {
      this.handleWorkerMessage(event.data, onUpdate);
    };

    this.frameCapture.start(videoElement, (frame) => {
      this.handleFrame(frame);
    });
  }

  stop(): void {
    this.running = false;
    this.frameCapture.stop();
    this.changeDetector.reset();
    this.activeVideo = null;
    this.cancelLatest();
    this.lastDeliveredAt = 0;
  }

  destroy(): void {
    this.stop();
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this.frameCapture.dispose();
  }

  setCaptureInterval(intervalMs: number): void {
    this.frameCapture.setCaptureInterval(intervalMs);
  }

  setForceFlip(forceFlip: boolean): void {
    this.forceFlip = forceFlip;
  }

  private handleFrame(frame: ImageData): void {
    if (!this.running) {
      return;
    }

    this.cancelLatest();

    const requestId = ++this.latestRequestId;
    this.worker.postMessage({
      type: 'process',
      requestId,
      frame,
      now: Date.now(),
      boardRefreshMs: this.options.boardRefreshMs,
      confidenceThreshold: this.options.lowConfidenceThreshold,
      forceFlip: this.forceFlip,
    });
  }

  private handleWorkerMessage(message: VisionWorkerMessage, onUpdate: (update: VisionPipelineUpdate) => void): void {
    if (!this.running) {
      return;
    }

    if (message.requestId !== this.latestRequestId) {
      return;
    }

    if (message.type === 'error') {
      console.error('[VisionPipeline] Worker failed to process frame', message.message);
      return;
    }

    const now = Date.now();
    const delta = this.lastDeliveredAt > 0 ? now - this.lastDeliveredAt : 0;
    this.lastDeliveredAt = now;

    const change = this.changeDetector.detect(message.fen);

    onUpdate({
      fen: message.fen,
      boardRegion: message.boardRegion,
      change: change.type,
      timestamp: now,
      wasFlipped: message.wasFlipped,
      performance: {
        fps: delta > 0 ? 1000 / delta : 0,
        processingMs: message.processingMs,
        detectorMs: message.detectorMs,
        classifierMs: message.classifierMs,
        confidenceAverage: message.confidenceAverage,
        lowConfidenceSquares: message.lowConfidenceSquares,
      },
    });
  }

  private cancelLatest(): void {
    if (this.latestRequestId === 0) {
      return;
    }

    this.worker.postMessage({
      type: 'cancel',
      requestId: this.latestRequestId,
    });
  }
}
