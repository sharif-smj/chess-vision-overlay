import type { VisionPipelineUpdate } from '../vision/pipeline';

const STORAGE_KEY = 'cvo:lastVisionUpdate';

const PIECE_GLYPHS: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

type Orientation = 'white' | 'black';

class PanelController {
  private readonly boardElement: HTMLElement;
  private readonly moveHistoryElement: HTMLElement;
  private readonly scoreElement: HTMLElement;
  private readonly evalFillElement: HTMLElement;
  private readonly engineLinesElement: HTMLElement;
  private readonly promptElement: HTMLElement;
  private readonly syncToggleButton: HTMLButtonElement;
  private readonly flipButton: HTMLButtonElement;
  private readonly acceptGameButton: HTMLButtonElement;
  private readonly dismissGameButton: HTMLButtonElement;

  private orientation: Orientation = 'white';
  private syncEnabled = true;
  private lastFen = '';

  constructor() {
    this.boardElement = this.getById('board');
    this.moveHistoryElement = this.getById('move-history');
    this.scoreElement = this.getById('eval-score');
    this.evalFillElement = this.getById('eval-fill');
    this.engineLinesElement = this.getById('engine-lines');
    this.promptElement = this.getById('new-game-prompt');
    this.syncToggleButton = this.getById('sync-toggle') as HTMLButtonElement;
    this.flipButton = this.getById('flip-board') as HTMLButtonElement;
    this.acceptGameButton = this.getById('accept-new-game') as HTMLButtonElement;
    this.dismissGameButton = this.getById('dismiss-new-game') as HTMLButtonElement;
  }

  init(): void {
    this.bindControls();
    this.renderBoardFromFen('8/8/8/8/8/8/8/8 w - - 0 1');
    this.engineLinesElement.textContent = 'Waiting for vision updates...';
    this.scoreElement.textContent = '0.0';
    this.evalFillElement.style.height = '50%';

    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (!this.syncEnabled) {
        return;
      }
      if (this.isVisionUpdateMessage(message)) {
        this.applyUpdate(message.payload);
      }
    });

    void this.loadLastUpdate();
  }

  private bindControls(): void {
    this.syncToggleButton.addEventListener('click', () => {
      this.syncEnabled = !this.syncEnabled;
      this.syncToggleButton.textContent = this.syncEnabled ? '⏸ Pause Sync' : '▶ Resume Sync';
      this.engineLinesElement.textContent = this.syncEnabled
        ? 'Sync resumed. Waiting for next update...'
        : 'Sync paused.';
    });

    this.flipButton.addEventListener('click', () => {
      this.orientation = this.orientation === 'white' ? 'black' : 'white';
      if (this.lastFen) {
        this.renderBoardFromFen(this.lastFen);
      }
    });

    this.acceptGameButton.addEventListener('click', () => {
      this.promptElement.classList.add('hidden');
      this.moveHistoryElement.textContent = '';
    });

    this.dismissGameButton.addEventListener('click', () => {
      this.promptElement.classList.add('hidden');
    });
  }

  private async loadLastUpdate(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const maybeUpdate = stored[STORAGE_KEY] as unknown;
    if (this.isVisionUpdate(maybeUpdate)) {
      this.applyUpdate(maybeUpdate);
    }
  }

  private applyUpdate(update: VisionPipelineUpdate): void {
    this.lastFen = update.fen;
    this.renderBoardFromFen(update.fen);

    this.engineLinesElement.textContent = [
      `Change: ${update.change}`,
      `Board region: ${update.boardRegion.x},${update.boardRegion.y} ${update.boardRegion.width}x${update.boardRegion.height}`,
      `Updated: ${new Date(update.timestamp).toLocaleTimeString()}`,
    ].join('\n');

    if (update.change !== 'no-change') {
      const item = document.createElement('div');
      item.textContent = `${new Date(update.timestamp).toLocaleTimeString()} - ${update.fen}`;
      this.moveHistoryElement.prepend(item);
    }

    if (update.change === 'new-game') {
      this.promptElement.classList.remove('hidden');
    }
  }

  private renderBoardFromFen(fen: string): void {
    const board = this.extractBoardFromFen(fen);
    const oriented = this.orientation === 'white' ? board : [...board].reverse().map((rank) => [...rank].reverse());

    this.boardElement.replaceChildren();

    oriented.forEach((rank, rankIndex) => {
      rank.forEach((piece, fileIndex) => {
        const square = document.createElement('div');
        square.className = 'board-square';
        const isLight = (rankIndex + fileIndex) % 2 === 0;
        square.classList.add(isLight ? 'light' : 'dark');
        square.textContent = piece === '1' ? '' : PIECE_GLYPHS[piece] ?? '';
        this.boardElement.append(square);
      });
    });
  }

  private extractBoardFromFen(fen: string): string[][] {
    const boardPart = fen.trim().split(/\s+/)[0] ?? '';
    const ranks = boardPart.split('/');
    if (ranks.length !== 8) {
      return Array.from({ length: 8 }, () => Array<string>(8).fill('1'));
    }

    return ranks.map((rank) => {
      const squares: string[] = [];
      for (const char of rank) {
        if (/[1-8]/.test(char)) {
          squares.push(...Array<string>(Number(char)).fill('1'));
        } else {
          squares.push(char);
        }
      }
      return squares.slice(0, 8).concat(Array<string>(Math.max(0, 8 - squares.length)).fill('1'));
    });
  }

  private getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }
    return element;
  }

  private isVisionUpdateMessage(value: unknown): value is { type: 'cvo:vision-update'; payload: VisionPipelineUpdate } {
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

new PanelController().init();
