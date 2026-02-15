import stockfishWasmUrl from 'stockfish/src/stockfish-nnue-16-no-Worker.wasm?url';

export interface EvalLine {
  multipv: number;
  scoreCp: number | null;
  mate: number | null;
  depth: number;
  pv: string[];
}

export interface EvalResult {
  score: number;
  mate: number | null;
  bestMove: string;
  pv: string[];
  depth: number;
  topLines: EvalLine[];
}

interface PendingEval {
  requestId: number;
  fen: string;
  depth: number;
  lines: Map<number, EvalLine>;
  resolve: (result: EvalResult) => void;
  reject: (reason?: unknown) => void;
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((reason?: unknown) => void) | null = null;
  private pendingEval: PendingEval | null = null;
  private requestId = 0;

  async init(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const workerUrl = new URL('./stockfish-engine.worker.ts', import.meta.url);
    workerUrl.hash = encodeURIComponent(stockfishWasmUrl);

    this.worker = new Worker(workerUrl, { type: 'module' });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker.addEventListener('message', (event: MessageEvent<string>) => {
      this.handleLine(String(event.data));
    });

    this.worker.addEventListener('error', (event) => {
      this.rejectReady?.(event.error ?? new Error('Stockfish worker failed'));
      this.rejectReady = null;
      this.resolveReady = null;
    });

    this.send('uci');
    return this.readyPromise;
  }

  async evaluate(fen: string, depth: number = 20): Promise<EvalResult> {
    await this.init();

    this.cancelPending();

    return new Promise<EvalResult>((resolve, reject) => {
      const requestId = ++this.requestId;
      this.pendingEval = {
        requestId,
        fen,
        depth,
        lines: new Map<number, EvalLine>(),
        resolve,
        reject,
      };

      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  cancelPending(): void {
    if (!this.pendingEval) {
      return;
    }

    const pending = this.pendingEval;
    this.pendingEval = null;
    this.send('stop');
    pending.reject(new DOMException('Evaluation canceled', 'AbortError'));
  }

  stop(): void {
    this.cancelPending();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private handleLine(line: string): void {
    if (line === 'uciok') {
      this.send('setoption name MultiPV value 3');
      this.send('isready');
      return;
    }

    if (line === 'readyok') {
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }

    const pending = this.pendingEval;
    if (!pending) {
      return;
    }

    if (line.startsWith('info ')) {
      const parsed = this.parseInfoLine(line);
      if (!parsed) {
        return;
      }
      pending.lines.set(parsed.multipv, parsed);
      return;
    }

    if (!line.startsWith('bestmove ')) {
      return;
    }

    const bestMove = line.split(/\s+/)[1] ?? '(none)';
    const topLines = [...pending.lines.values()]
      .sort((a, b) => a.multipv - b.multipv)
      .slice(0, 3);

    const primary = topLines[0];
    const result: EvalResult = {
      score: primary?.scoreCp ?? 0,
      mate: primary?.mate ?? null,
      bestMove,
      pv: primary?.pv ?? [],
      depth: primary?.depth ?? pending.depth,
      topLines,
    };

    const requestId = pending.requestId;
    this.pendingEval = null;

    if (requestId === this.requestId) {
      pending.resolve(result);
    }
  }

  private parseInfoLine(line: string): EvalLine | null {
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
    const pvMatch = line.match(/\bpv\s+(.+)$/);
    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);

    if (!depthMatch || !pvMatch) {
      return null;
    }

    const multipv = multipvMatch ? Number(multipvMatch[1]) : 1;
    const depth = Number(depthMatch[1]);

    if (!Number.isFinite(multipv) || !Number.isFinite(depth)) {
      return null;
    }

    return {
      multipv,
      depth,
      scoreCp: cpMatch ? Number(cpMatch[1]) : null,
      mate: mateMatch ? Number(mateMatch[1]) : null,
      pv: pvMatch[1].trim().split(/\s+/),
    };
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }
}
