import type { VisionPipelineUpdate } from '../vision/pipeline';
import { InteractiveBoard, type BoardOrientation } from '../board/interactive-board';
import { StockfishEngine, type EvalResult } from '../engine/stockfish-worker';

const STORAGE_KEY = 'cvo:lastVisionUpdate';
const ANALYSIS_DEPTH = 20;

type VisionUpdateMessage = { type: 'cvo:vision-update'; payload: VisionPipelineUpdate };

class PanelController {
  private readonly boardHost: HTMLElement;
  private readonly moveHistoryElement: HTMLElement;
  private readonly scoreElement: HTMLElement;
  private readonly evalWhiteElement: HTMLElement;
  private readonly evalBlackElement: HTMLElement;
  private readonly evalMarkerElement: HTMLElement;
  private readonly engineLinesElement: HTMLElement;
  private readonly promptElement: HTMLElement;
  private readonly syncToggleButton: HTMLButtonElement;
  private readonly autoToggleButton: HTMLButtonElement;
  private readonly nextUpdateButton: HTMLButtonElement;
  private readonly flipButton: HTMLButtonElement;
  private readonly clearNotesButton: HTMLButtonElement;
  private readonly acceptGameButton: HTMLButtonElement;
  private readonly dismissGameButton: HTMLButtonElement;

  private readonly board: InteractiveBoard;
  private readonly engine = new StockfishEngine();

  private orientation: BoardOrientation = 'white';
  private syncEnabled = true;
  private autoAdvance = true;

  private lastFen = '8/8/8/8/8/8/8/8 w - - 0 1';
  private pendingSyncUpdate: VisionPipelineUpdate | null = null;
  private analysisGeneration = 0;

  constructor() {
    this.boardHost = this.getById('board');
    this.moveHistoryElement = this.getById('move-history');
    this.scoreElement = this.getById('eval-score');
    this.evalWhiteElement = this.getById('eval-white');
    this.evalBlackElement = this.getById('eval-black');
    this.evalMarkerElement = this.getById('eval-marker');
    this.engineLinesElement = this.getById('engine-lines');
    this.promptElement = this.getById('new-game-prompt');
    this.syncToggleButton = this.getById('sync-toggle') as HTMLButtonElement;
    this.autoToggleButton = this.getById('auto-toggle') as HTMLButtonElement;
    this.nextUpdateButton = this.getById('next-update') as HTMLButtonElement;
    this.flipButton = this.getById('flip-board') as HTMLButtonElement;
    this.clearNotesButton = this.getById('clear-notes') as HTMLButtonElement;
    this.acceptGameButton = this.getById('accept-new-game') as HTMLButtonElement;
    this.dismissGameButton = this.getById('dismiss-new-game') as HTMLButtonElement;

    this.board = new InteractiveBoard(this.boardHost, {
      orientation: this.orientation,
      onPositionChange: (fen) => {
        this.lastFen = fen;
        void this.analyzePosition(fen, 'Exploring position...');
      },
    });
  }

  async init(): Promise<void> {
    this.bindControls();
    this.engineLinesElement.textContent = 'Waiting for vision updates...';

    void this.engine.init().catch((error) => {
      console.error('[Panel] Stockfish init failed', error);
      this.engineLinesElement.textContent = 'Engine failed to initialize.';
    });

    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (this.isVisionUpdateMessage(message)) {
        this.onVisionUpdate(message.payload);
      }
    });

    await this.loadLastUpdate();
  }

  private bindControls(): void {
    this.syncToggleButton.addEventListener('click', () => {
      this.syncEnabled = !this.syncEnabled;
      this.syncToggleButton.textContent = this.syncEnabled ? 'Pause Sync' : 'Resume Sync';

      if (this.syncEnabled && this.autoAdvance && this.pendingSyncUpdate) {
        const update = this.pendingSyncUpdate;
        this.pendingSyncUpdate = null;
        this.applyVisionUpdate(update);
      }
    });

    this.autoToggleButton.addEventListener('click', () => {
      this.autoAdvance = !this.autoAdvance;
      this.autoToggleButton.textContent = this.autoAdvance ? 'Auto-Advance: On' : 'Auto-Advance: Off';

      if (this.autoAdvance && this.syncEnabled && this.pendingSyncUpdate) {
        const update = this.pendingSyncUpdate;
        this.pendingSyncUpdate = null;
        this.applyVisionUpdate(update);
      }
    });

    this.nextUpdateButton.addEventListener('click', () => {
      if (!this.pendingSyncUpdate) {
        return;
      }
      const update = this.pendingSyncUpdate;
      this.pendingSyncUpdate = null;
      this.applyVisionUpdate(update);
    });

    this.flipButton.addEventListener('click', () => {
      this.orientation = this.orientation === 'white' ? 'black' : 'white';
      this.board.setOrientation(this.orientation);
    });

    this.clearNotesButton.addEventListener('click', () => {
      this.board.clearAnnotations();
    });

    this.acceptGameButton.addEventListener('click', () => {
      this.moveHistoryElement.textContent = '';
      this.promptElement.classList.add('hidden');
    });

    this.dismissGameButton.addEventListener('click', () => {
      this.promptElement.classList.add('hidden');
    });

    window.addEventListener('beforeunload', () => {
      this.board.destroy();
      this.engine.stop();
    });
  }

  private async loadLastUpdate(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const maybeUpdate = stored[STORAGE_KEY] as unknown;

    if (this.isVisionUpdate(maybeUpdate)) {
      this.applyVisionUpdate(maybeUpdate);
      return;
    }

    this.board.setPosition(this.lastFen);
    await this.analyzePosition(this.lastFen, 'Analyzing initial board...');
  }

  private onVisionUpdate(update: VisionPipelineUpdate): void {
    if (!this.syncEnabled || !this.autoAdvance) {
      this.pendingSyncUpdate = update;
      this.engineLinesElement.textContent = this.syncEnabled
        ? 'Update queued. Click "Apply Latest" to load it.'
        : 'Sync paused. Resume sync or apply latest manually.';
      return;
    }

    this.applyVisionUpdate(update);
  }

  private applyVisionUpdate(update: VisionPipelineUpdate): void {
    this.pendingSyncUpdate = null;
    this.lastFen = update.fen;
    this.board.setPosition(update.fen);

    if (update.change !== 'no-change') {
      const line = document.createElement('div');
      line.textContent = `${new Date(update.timestamp).toLocaleTimeString()} - ${update.change}`;
      this.moveHistoryElement.prepend(line);
    }

    if (update.change === 'new-game') {
      this.promptElement.classList.remove('hidden');
    }

    void this.analyzePosition(update.fen, `Analyzing depth ${ANALYSIS_DEPTH}...`);
  }

  private async analyzePosition(fen: string, loadingText: string): Promise<void> {
    this.analysisGeneration += 1;
    const generation = this.analysisGeneration;

    this.engine.cancelPending();
    this.engineLinesElement.textContent = loadingText;

    try {
      const result = await this.engine.evaluate(fen, ANALYSIS_DEPTH);
      if (generation !== this.analysisGeneration) {
        return;
      }
      this.renderEval(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('[Panel] Analysis failed', error);
      this.engineLinesElement.textContent = 'Engine analysis failed.';
      this.board.setEngineBestMove(null);
    }
  }

  private renderEval(result: EvalResult): void {
    this.scoreElement.textContent = this.formatScore(result);
    this.updateEvalBar(result);
    this.board.setEngineBestMove(result.bestMove);

    const lines = result.topLines.length > 0
      ? result.topLines
          .slice(0, 3)
          .map((line) => `#${line.multipv} ${this.formatLineScore(line.scoreCp, line.mate)} ${line.pv.join(' ')}`)
      : ['No PV lines returned.'];

    this.engineLinesElement.textContent = lines.join('\n');
  }

  private updateEvalBar(result: EvalResult): void {
    let whitePercent = 50;

    if (result.mate !== null) {
      whitePercent = result.mate > 0 ? 100 : 0;
    } else {
      const clamped = Math.max(-900, Math.min(900, result.score));
      whitePercent = 50 + clamped / 18;
    }

    whitePercent = Math.max(0, Math.min(100, whitePercent));
    const blackPercent = 100 - whitePercent;

    this.evalWhiteElement.style.height = `${whitePercent}%`;
    this.evalBlackElement.style.height = `${blackPercent}%`;
    this.evalMarkerElement.style.top = `${blackPercent}%`;
  }

  private formatScore(result: EvalResult): string {
    if (result.mate !== null) {
      return result.mate > 0 ? `M${result.mate}` : `-M${Math.abs(result.mate)}`;
    }

    const score = result.score / 100;
    const sign = score > 0 ? '+' : '';
    return `${sign}${score.toFixed(1)}`;
  }

  private formatLineScore(scoreCp: number | null, mate: number | null): string {
    if (mate !== null) {
      return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
    }

    if (scoreCp === null) {
      return '0.0';
    }

    const score = scoreCp / 100;
    const sign = score > 0 ? '+' : '';
    return `${sign}${score.toFixed(1)}`;
  }

  private getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }
    return element;
  }

  private isVisionUpdateMessage(value: unknown): value is VisionUpdateMessage {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const message = value as { type?: string; payload?: unknown };
    return message.type === 'cvo:vision-update' && this.isVisionUpdate(message.payload);
  }

  private isVisionUpdate(value: unknown): value is VisionPipelineUpdate {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const update = value as Partial<VisionPipelineUpdate>;
    return (
      typeof update.fen === 'string' &&
      typeof update.timestamp === 'number' &&
      (update.change === 'no-change' || update.change === 'move' || update.change === 'new-game') &&
      !!update.boardRegion &&
      typeof update.boardRegion.x === 'number' &&
      typeof update.boardRegion.y === 'number' &&
      typeof update.boardRegion.width === 'number' &&
      typeof update.boardRegion.height === 'number'
    );
  }
}

void new PanelController().init();
