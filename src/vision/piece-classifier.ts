import { InferenceSession, Tensor } from 'onnxruntime-web';

const PIECE_LABELS = ['1', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'] as const;
const BACK_RANK_WHITE = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'] as const;
const BACK_RANK_BLACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'] as const;

export interface PieceClassifierOptions {
  modelPath: string;
  tileSize: number;
  forceMock: boolean;
}

const DEFAULT_OPTIONS: PieceClassifierOptions = {
  modelPath: 'models/piece-classifier.onnx',
  tileSize: 32,
  forceMock: false,
};

// ONNX-backed classifier with a deterministic heuristic fallback for MVP.
export class PieceClassifier {
  private readonly options: PieceClassifierOptions;
  private session: InferenceSession | null = null;
  private modelLoadPromise: Promise<void> | null = null;

  constructor(options: Partial<PieceClassifierOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async classify(boardImage: ImageData): Promise<string> {
    await this.ensureModelLoaded();

    const { tensorData, occupancy } = this.preprocessBoard(boardImage, this.options.tileSize);

    if (this.session) {
      const logits = await this.runInference(tensorData);
      if (logits) {
        return this.logitsToFen(logits);
      }
    }

    return this.heuristicFenFromOccupancy(occupancy);
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
            const idx = (sy * boardImage.width + sx) * 4;
            const lum = (0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2]) / 255;
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

  private logitsToFen(logits: Float32Array): string {
    const pieces = new Array<string>(64);
    const classes = PIECE_LABELS.length;

    for (let square = 0; square < 64; square++) {
      let bestClass = 0;
      let bestScore = -Infinity;
      const offset = square * classes;

      for (let c = 0; c < classes; c++) {
        const score = logits[offset + c];
        if (score > bestScore) {
          bestScore = score;
          bestClass = c;
        }
      }

      pieces[square] = PIECE_LABELS[bestClass];
    }

    return this.piecesToFen(pieces);
  }

  private heuristicFenFromOccupancy(occupancy: Float32Array): string {
    const threshold = 0.08;
    const pieces = new Array<string>(64).fill('1');

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const idx = rank * 8 + file;
        if (occupancy[idx] < threshold) {
          continue;
        }

        if (rank === 0) {
          pieces[idx] = BACK_RANK_BLACK[file];
        } else if (rank === 1) {
          pieces[idx] = 'p';
        } else if (rank === 6) {
          pieces[idx] = 'P';
        } else if (rank === 7) {
          pieces[idx] = BACK_RANK_WHITE[file];
        } else {
          pieces[idx] = 'P';
        }
      }
    }

    return this.piecesToFen(pieces);
  }

  private piecesToFen(pieces: string[]): string {
    const ranks: string[] = [];

    for (let rank = 0; rank < 8; rank++) {
      let fenRank = '';
      let empty = 0;

      for (let file = 0; file < 8; file++) {
        const piece = pieces[rank * 8 + file];
        if (piece === '1') {
          empty++;
        } else {
          if (empty > 0) {
            fenRank += String(empty);
            empty = 0;
          }
          fenRank += piece;
        }
      }

      if (empty > 0) {
        fenRank += String(empty);
      }

      ranks.push(fenRank);
    }

    return `${ranks.join('/')} w - - 0 1`;
  }
}
