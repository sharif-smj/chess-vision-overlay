import { BoardDetector, type BoardRegion } from './board-detector';
import { ChangeDetector } from './change-detector';
import { FrameCapture } from './frame-capture';
import { PieceClassifier } from './piece-classifier';

export interface VisionPipelineOptions {
  captureIntervalMs: number;
  boardRefreshMs: number;
}

export interface VisionPipelineUpdate {
  fen: string;
  boardRegion: BoardRegion;
  change: 'no-change' | 'move' | 'new-game';
  timestamp: number;
}

const DEFAULT_OPTIONS: VisionPipelineOptions = {
  captureIntervalMs: 500,
  boardRefreshMs: 1000,
};

export class VisionPipeline {
  private readonly options: VisionPipelineOptions;
  private readonly frameCapture: FrameCapture;
  private readonly boardDetector: BoardDetector;
  private readonly pieceClassifier: PieceClassifier;
  private readonly changeDetector: ChangeDetector;

  private cachedBoardRegion: BoardRegion | null = null;
  private lastBoardDetectionAt = 0;
  private running = false;
  private processing = false;

  constructor(
    deps?: {
      frameCapture?: FrameCapture;
      boardDetector?: BoardDetector;
      pieceClassifier?: PieceClassifier;
      changeDetector?: ChangeDetector;
    },
    options: Partial<VisionPipelineOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.frameCapture = deps?.frameCapture ?? new FrameCapture(this.options.captureIntervalMs);
    this.boardDetector = deps?.boardDetector ?? new BoardDetector();
    this.pieceClassifier = deps?.pieceClassifier ?? new PieceClassifier();
    this.changeDetector = deps?.changeDetector ?? new ChangeDetector();
  }

  start(videoElement: HTMLVideoElement, onUpdate: (update: VisionPipelineUpdate) => void): void {
    if (this.running) {
      return;
    }

    this.running = true;

    this.frameCapture.start(videoElement, (frame) => {
      void this.handleFrame(frame, onUpdate);
    });
  }

  stop(): void {
    this.running = false;
    this.frameCapture.stop();
    this.changeDetector.reset();
    this.cachedBoardRegion = null;
    this.lastBoardDetectionAt = 0;
    this.processing = false;
  }

  private async handleFrame(frame: ImageData, onUpdate: (update: VisionPipelineUpdate) => void): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }

    this.processing = true;

    try {
      const now = Date.now();

      if (!this.cachedBoardRegion || now - this.lastBoardDetectionAt >= this.options.boardRefreshMs) {
        const region = await this.boardDetector.detect(frame);
        this.cachedBoardRegion = region;
        this.lastBoardDetectionAt = now;
      }

      if (!this.cachedBoardRegion) {
        return;
      }

      const boardImage = FrameCapture.crop(frame, this.cachedBoardRegion);
      const fen = await this.pieceClassifier.classify(boardImage);
      const change = this.changeDetector.detect(fen);

      onUpdate({
        fen,
        boardRegion: this.cachedBoardRegion,
        change: change.type,
        timestamp: now,
      });
    } catch (error) {
      console.error('[VisionPipeline] Failed to process frame', error);
    } finally {
      this.processing = false;
    }
  }
}
