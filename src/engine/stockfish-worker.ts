// Stockfish WASM Web Worker wrapper
export class StockfishEngine {
  private worker: Worker | null = null;
  private resolveEval: ((result: EvalResult) => void) | null = null;

  async init() {
    // TODO: Load Stockfish WASM worker
  }

  async evaluate(fen: string, depth: number = 20): Promise<EvalResult> {
    // TODO: Send position to Stockfish, parse bestmove + eval
    throw new Error('Not implemented (Issue #4)');
  }

  stop() {
    this.worker?.terminate();
  }
}

export interface EvalResult {
  score: number; // centipawns (+ = white advantage)
  mate: number | null; // moves to mate (null if not mate)
  bestMove: string; // UCI format e.g. "e2e4"
  pv: string[]; // principal variation (top lines)
  depth: number;
}
