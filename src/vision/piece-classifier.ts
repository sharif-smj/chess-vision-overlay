import { InferenceSession, Tensor } from 'onnxruntime-web';
import {
  detectBoardPerspective,
  piecesToFen,
  rotatePieces180,
  type BoardPerspective,
} from './fen-utils';

const PIECE_LABELS = ['1', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'] as const;
const BACK_RANK_WHITE = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'] as const;
const BACK_RANK_BLACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'] as const;

export interface PieceClassifierOptions {
  modelPath: string;
  tileSize: number;
  forceMock: boolean;
}

export interface ClassificationOptions {
  forceFlip?: boolean;
}

export interface PieceClassificationResult {
  fen: string;
  pieces: string[];
  confidences: Float32Array;
  perspective: BoardPerspective;
  wasFlipped: boolean;
  averageConfidence: number;
}

const DEFAULT_OPTIONS: PieceClassifierOptions = {
  modelPath: 'models/piece-classifier.onnx',
  tileSize: 32,
  forceMock: false,
};

// ONNX-backed classifier with deterministic fallback.
export class PieceClassifier {
  private readonly options: PieceClassifierOptions;
  private session: InferenceSession | null = null;
  private modelLoadPromise: Promise<void> | null = null;

  constructor(options: Partial<PieceClassifierOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async classify(boardImage: ImageData, options: ClassificationOptions = {}): Promise<string> {
    const result = await this.classifyDetailed(boardImage, options);
    return result.fen;
  }

  async classifyDetailed(boardImage: ImageData, options: ClassificationOptions = {}): Promise<PieceClassificationResult> {
    await this.ensureModelLoaded();

    const { tensorData, occupancy } = this.preprocessBoard(boardImage, this.options.tileSize);

    let pieces: string[];
    let confidences: Float32Array;

    if (this.session) {
      const logits = await this.runInference(tensorData);
      if (logits) {
        const inference = this.logitsToPieces(logits);
        pieces = inference.pieces;
        confidences = inference.confidences;
      } else {
        const fallback = this.heuristicPiecesFromOccupancy(occupancy);
        pieces = fallback.pieces;
        confidences = fallback.confidences;
      }
    } else {
      const fallback = this.heuristicPiecesFromOccupancy(occupancy);
      pieces = fallback.pieces;
      confidences = fallback.confidences;
    }

    const perspective = detectBoardPerspective(pieces);
    const shouldFlip = Boolean(options.forceFlip) || perspective === 'black-bottom';
    const normalizedPieces = shouldFlip ? rotatePieces180(pieces) : pieces.slice();

    let confidenceSum = 0;
    for (const value of confidences) {
      confidenceSum += value;
    }

    return {
      fen: piecesToFen(normalizedPieces),
      pieces: normalizedPieces,
      confidences,
      perspective,
      wasFlipped: shouldFlip,
      averageConfidence: confidences.length > 0 ? confidenceSum / confidences.length : 0,
    };
  }

  async dispose(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      const releasable = this.session as InferenceSession & { release?: () => Promise<void> };
      if (typeof releasable.release === 'function') {
        await releasable.release();
      }
    } catch (error) {
      console.warn('[PieceClassifier] Failed to release ONNX session', error);
    } finally {
      this.session = null;
      this.modelLoadPromise = null;
    }
  }

  private async ensureModelLoaded(): Promise<void> {
    if (this.options.forceMock || this.session || this.modelLoadPromise) {
      return this.modelLoadPromise ?? Promise.resolve();
    }

    this.modelLoadPromise = (async () => {
      try {
        const modelPath = this.resolveModelPath(this.options.modelPath);
        this.session = await InferenceSession.create(modelPath, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
      } catch (error) {
        console.warn('[PieceClassifier] Failed to load ONNX model, using heuristic fallback.', error);
        this.session = null;
      }
    })();

    return this.modelLoadPromise;
  }

  private resolveModelPath(path: string): string {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }

  private preprocessBoard(
    boardImage: ImageData,
    tileSize: number,
  ): { tensorData: Float32Array; occupancy: Float32Array } {
    const squares = 64;
    const channels = 1;
    const data = new Float32Array(squares * channels * tileSize * tileSize);
    const occupancy = new Float32Array(squares);

    const src = boardImage.data;
    const tileWidth = boardImage.width / 8;
    const tileHeight = boardImage.height / 8;

    let outIndex = 0;

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        let sum = 0;
        let sumSq = 0;

        for (let ty = 0; ty < tileSize; ty++) {
          const sy = Math.min(
            boardImage.height - 1,
            Math.floor(rank * tileHeight + ((ty + 0.5) * tileHeight) / tileSize),
          );
          for (let tx = 0; tx < tileSize; tx++) {
            const sx = Math.min(
              boardImage.width - 1,
              Math.floor(file * tileWidth + ((tx + 0.5) * tileWidth) / tileSize),
            );

            const lum = this.sampleOverlaySafeLuminance(src, boardImage.width, boardImage.height, sx, sy);
            data[outIndex++] = lum;
            sum += lum;
            sumSq += lum * lum;
          }
        }

        const pixelCount = tileSize * tileSize;
        const mean = sum / pixelCount;
        const variance = Math.max(0, sumSq / pixelCount - mean * mean);
        occupancy[rank * 8 + file] = Math.sqrt(variance);
      }
    }

    return { tensorData: data, occupancy };
  }

  private sampleOverlaySafeLuminance(
    src: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number,
  ): number {
    const baseIdx = (y * width + x) * 4;
    const r = src[baseIdx];
    const g = src[baseIdx + 1];
    const b = src[baseIdx + 2];

    if (!this.isLikelyOverlayColor(r, g, b)) {
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    const neighbors: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    let sum = 0;
    let count = 0;

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }

      const idx = (ny * width + nx) * 4;
      const nr = src[idx];
      const ng = src[idx + 1];
      const nb = src[idx + 2];
      if (this.isLikelyOverlayColor(nr, ng, nb)) {
        continue;
      }

      sum += (0.299 * nr + 0.587 * ng + 0.114 * nb) / 255;
      count += 1;
    }

    if (count > 0) {
      return sum / count;
    }

    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  private isLikelyOverlayColor(r: number, g: number, b: number): boolean {
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const delta = max - min;

    if (delta < 0.2 || max < 0.35) {
      return false;
    }

    const saturation = max === 0 ? 0 : delta / max;
    if (saturation < 0.45) {
      return false;
    }

    let hue = 0;
    if (delta > 0) {
      if (max === rf) {
        hue = ((gf - bf) / delta) % 6;
      } else if (max === gf) {
        hue = (bf - rf) / delta + 2;
      } else {
        hue = (rf - gf) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) {
        hue += 360;
      }
    }

    return (
      (hue >= 0 && hue <= 60) ||
      (hue >= 170 && hue <= 240) ||
      (hue >= 85 && hue <= 145)
    );
  }

  private async runInference(input: Float32Array): Promise<Float32Array | null> {
    if (!this.session) {
      return null;
    }

    const inputName = this.session.inputNames[0];
    const outputName = this.session.outputNames[0];

    const tensor = new Tensor('float32', input, [64, 1, this.options.tileSize, this.options.tileSize]);
    const outputs = await this.session.run({ [inputName]: tensor });
    const raw = outputs[outputName];
    if (!raw?.data) {
      return null;
    }

    const logits = raw.data as Float32Array;
    if (logits.length !== 64 * PIECE_LABELS.length) {
      console.warn('[PieceClassifier] Unexpected model output shape, using fallback.', raw.dims);
      return null;
    }

    return logits;
  }

  private logitsToPieces(logits: Float32Array): { pieces: string[]; confidences: Float32Array } {
    const pieces = new Array<string>(64);
    const confidences = new Float32Array(64);
    const classes = PIECE_LABELS.length;

    for (let square = 0; square < 64; square++) {
      let bestClass = 0;
      let bestScore = -Infinity;
      let secondScore = -Infinity;
      let expSum = 0;
      const offset = square * classes;

      for (let c = 0; c < classes; c++) {
        const score = logits[offset + c];
        if (score > bestScore) {
          secondScore = bestScore;
          bestScore = score;
          bestClass = c;
        } else if (score > secondScore) {
          secondScore = score;
        }
      }

      for (let c = 0; c < classes; c++) {
        expSum += Math.exp(logits[offset + c] - bestScore);
      }

      const bestProb = expSum > 0 ? 1 / expSum : 0;
      const margin = 1 / (1 + Math.exp(-(bestScore - secondScore)));
      confidences[square] = Math.max(bestProb, margin);
      pieces[square] = PIECE_LABELS[bestClass];
    }

    return { pieces, confidences };
  }

  private heuristicPiecesFromOccupancy(occupancy: Float32Array): { pieces: string[]; confidences: Float32Array } {
    const threshold = 0.08;
    const pieces = new Array<string>(64).fill('1');
    const confidences = new Float32Array(64);

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const idx = rank * 8 + file;
        const oc = occupancy[idx];

        if (oc < threshold) {
          pieces[idx] = '1';
          confidences[idx] = Math.max(0.2, 1 - oc / threshold);
          continue;
        }

        if (rank === 0) {
          pieces[idx] = BACK_RANK_BLACK[file];
          confidences[idx] = 0.8;
        } else if (rank === 1) {
          pieces[idx] = 'p';
          confidences[idx] = 0.75;
        } else if (rank === 6) {
          pieces[idx] = 'P';
          confidences[idx] = 0.75;
        } else if (rank === 7) {
          pieces[idx] = BACK_RANK_WHITE[file];
          confidences[idx] = 0.8;
        } else {
          pieces[idx] = 'P';
          confidences[idx] = 0.45;
        }
      }
    }

    return { pieces, confidences };
  }
}
