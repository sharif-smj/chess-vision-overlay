export type BoardOrientation = 'white' | 'black';
export type BoardColorTheme = 'green' | 'brown' | 'blue' | 'gray';

type PieceCode =
  | 'P'
  | 'N'
  | 'B'
  | 'R'
  | 'Q'
  | 'K'
  | 'p'
  | 'n'
  | 'b'
  | 'r'
  | 'q'
  | 'k';

interface Arrow {
  from: string;
  to: string;
  color: string;
}

interface DragState {
  from: string;
  piece: PieceCode;
  x: number;
  y: number;
  moved: boolean;
}

interface RightDragState {
  from: string;
  to: string;
}

interface InteractiveBoardOptions {
  orientation?: BoardOrientation;
  theme?: BoardColorTheme;
  onPositionChange?: (fen: string) => void;
}

const PIECE_GLYPHS: Record<PieceCode, string> = {
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

const BOARD_THEMES: Record<BoardColorTheme, { light: string; dark: string }> = {
  green: { light: '#e8f0cf', dark: '#769656' },
  brown: { light: '#f0d9b5', dark: '#b58863' },
  blue: { light: '#dce9f7', dark: '#5d7fa3' },
  gray: { light: '#ececec', dark: '#969696' },
};

export class InteractiveBoard {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly onPositionChange?: (fen: string) => void;

  private board = new Map<string, PieceCode>();
  private fenMeta = 'w - - 0 1';
  private orientation: BoardOrientation;
  private theme: BoardColorTheme;

  private highlights = new Set<string>();
  private userArrows = new Map<string, Arrow>();
  private engineArrow: Arrow | null = null;

  private dragState: DragState | null = null;
  private rightDrag: RightDragState | null = null;

  constructor(host: HTMLElement, options: InteractiveBoardOptions = {}) {
    this.host = host;
    this.orientation = options.orientation ?? 'white';
    this.theme = options.theme ?? 'green';
    this.onPositionChange = options.onPositionChange;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'interactive-board-canvas';
    this.ctx = this.getContext(this.canvas);

    this.host.replaceChildren(this.canvas);
    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.render();
    });
    this.resizeObserver.observe(this.host);

    this.resize();
    this.setPosition('8/8/8/8/8/8/8/8 w - - 0 1');
  }

  destroy(): void {
    this.resizeObserver.disconnect();
  }

  setPosition(fen: string): void {
    this.board = this.parseBoardPart(fen);
    this.fenMeta = fen.trim().split(/\s+/).slice(1).join(' ') || 'w - - 0 1';
    this.highlights.clear();
    this.userArrows.clear();
    this.render();
  }

  getFen(): string {
    return `${this.boardToFen()} ${this.fenMeta}`;
  }

  setOrientation(orientation: BoardOrientation): void {
    this.orientation = orientation;
    this.render();
  }

  setTheme(theme: BoardColorTheme): void {
    this.theme = theme;
    this.render();
  }

  setEngineBestMove(uciMove: string | null): void {
    if (!uciMove || uciMove.length < 4) {
      this.engineArrow = null;
      this.render();
      return;
    }

    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    if (!this.isSquare(from) || !this.isSquare(to)) {
      this.engineArrow = null;
      this.render();
      return;
    }

    this.engineArrow = { from, to, color: '#35b67a' };
    this.render();
  }

  clearAnnotations(): void {
    this.highlights.clear();
    this.userArrows.clear();
    this.engineArrow = null;
    this.render();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    this.canvas.addEventListener('mousedown', (event) => {
      const square = this.eventToSquare(event);
      if (!square) {
        return;
      }

      if (event.button === 2) {
        this.rightDrag = { from: square, to: square };
        this.render();
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const piece = this.board.get(square);
      if (!piece) {
        this.toggleHighlight(square);
        return;
      }

      this.dragState = {
        from: square,
        piece,
        x: event.offsetX,
        y: event.offsetY,
        moved: false,
      };
      this.render();
    });

    this.canvas.addEventListener('mousemove', (event) => {
      if (this.dragState) {
        const dx = Math.abs(event.offsetX - this.dragState.x);
        const dy = Math.abs(event.offsetY - this.dragState.y);
        if (dx > 3 || dy > 3) {
          this.dragState.moved = true;
        }
        this.dragState.x = event.offsetX;
        this.dragState.y = event.offsetY;
        this.render();
      }

      if (this.rightDrag) {
        const to = this.eventToSquare(event);
        if (to) {
          this.rightDrag.to = to;
          this.render();
        }
      }
    });

    const finishPointer = (event: MouseEvent): void => {
      const square = this.eventToSquare(event);

      if (event.button === 2 && this.rightDrag) {
        const from = this.rightDrag.from;
        const to = square ?? this.rightDrag.to;
        this.rightDrag = null;

        if (from !== to && this.isSquare(from) && this.isSquare(to)) {
          this.toggleArrow(from, to);
        }

        this.render();
        return;
      }

      if (event.button !== 0 || !this.dragState) {
        return;
      }

      const drag = this.dragState;
      this.dragState = null;

      if (!drag.moved) {
        this.toggleHighlight(drag.from);
        this.render();
        return;
      }

      if (!square || !this.isSquare(square)) {
        this.render();
        return;
      }

      this.movePiece(drag.from, square, drag.piece);
      this.render();
      this.onPositionChange?.(this.getFen());
    };

    this.canvas.addEventListener('mouseup', finishPointer);
    this.canvas.addEventListener('mouseleave', (event) => {
      if (this.dragState) {
        this.dragState = null;
        this.render();
      }
      if (this.rightDrag) {
        this.rightDrag = null;
        this.render();
      }
      event.preventDefault();
    });
  }

  private movePiece(from: string, to: string, piece: PieceCode): void {
    this.board.delete(from);
    this.board.set(to, piece);
  }

  private toggleHighlight(square: string): void {
    if (this.highlights.has(square)) {
      this.highlights.delete(square);
      return;
    }
    this.highlights.add(square);
  }

  private toggleArrow(from: string, to: string): void {
    const key = `${from}-${to}`;
    if (this.userArrows.has(key)) {
      this.userArrows.delete(key);
      return;
    }
    this.userArrows.set(key, { from, to, color: '#f59e0b' });
  }

  private resize(): void {
    const size = Math.max(240, Math.min(this.host.clientWidth, 440));
    this.canvas.width = size;
    this.canvas.height = size;
  }

  private render(): void {
    const size = this.canvas.width;
    const squareSize = size / 8;

    this.ctx.clearRect(0, 0, size, size);

    const palette = BOARD_THEMES[this.theme];

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const isLight = (row + col) % 2 === 0;
        this.ctx.fillStyle = isLight ? palette.light : palette.dark;
        this.ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
      }
    }

    for (const square of this.highlights) {
      const coords = this.squareToCoords(square);
      if (!coords) {
        continue;
      }
      this.ctx.fillStyle = 'rgba(255, 228, 92, 0.45)';
      this.ctx.fillRect(coords.col * squareSize, coords.row * squareSize, squareSize, squareSize);
    }

    for (const arrow of this.userArrows.values()) {
      this.drawArrow(arrow, squareSize);
    }

    if (this.engineArrow) {
      this.drawArrow(this.engineArrow, squareSize, 4);
    }

    if (this.rightDrag) {
      this.drawArrow({ from: this.rightDrag.from, to: this.rightDrag.to, color: 'rgba(245, 158, 11, 0.75)' }, squareSize, 3);
    }

    this.ctx.font = `${Math.floor(squareSize * 0.76)}px serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (const [square, piece] of this.board.entries()) {
      if (this.dragState?.moved && this.dragState.from === square) {
        continue;
      }
      const coords = this.squareToCoords(square);
      if (!coords) {
        continue;
      }
      const x = coords.col * squareSize + squareSize / 2;
      const y = coords.row * squareSize + squareSize / 2;

      this.ctx.fillStyle = piece === piece.toUpperCase() ? '#f8f8f8' : '#111';
      this.ctx.strokeStyle = piece === piece.toUpperCase() ? '#111' : '#eee';
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeText(PIECE_GLYPHS[piece], x, y);
      this.ctx.fillText(PIECE_GLYPHS[piece], x, y);
    }

    if (this.dragState?.moved) {
      const glyph = PIECE_GLYPHS[this.dragState.piece];
      this.ctx.globalAlpha = 0.86;
      this.ctx.fillStyle = this.dragState.piece === this.dragState.piece.toUpperCase() ? '#f8f8f8' : '#111';
      this.ctx.strokeStyle = this.dragState.piece === this.dragState.piece.toUpperCase() ? '#111' : '#eee';
      this.ctx.strokeText(glyph, this.dragState.x, this.dragState.y);
      this.ctx.fillText(glyph, this.dragState.x, this.dragState.y);
      this.ctx.globalAlpha = 1;
    }
  }

  private drawArrow(arrow: Arrow, squareSize: number, width = 3): void {
    const from = this.squareCenter(arrow.from, squareSize);
    const to = this.squareCenter(arrow.to, squareSize);

    if (!from || !to || (from.x === to.x && from.y === to.y)) {
      return;
    }

    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLength = Math.max(10, squareSize * 0.22);

    this.ctx.strokeStyle = arrow.color;
    this.ctx.fillStyle = arrow.color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(to.x, to.y);
    this.ctx.lineTo(
      to.x - headLength * Math.cos(angle - Math.PI / 6),
      to.y - headLength * Math.sin(angle - Math.PI / 6),
    );
    this.ctx.lineTo(
      to.x - headLength * Math.cos(angle + Math.PI / 6),
      to.y - headLength * Math.sin(angle + Math.PI / 6),
    );
    this.ctx.closePath();
    this.ctx.fill();
  }

  private squareCenter(square: string, squareSize: number): { x: number; y: number } | null {
    const coords = this.squareToCoords(square);
    if (!coords) {
      return null;
    }
    return {
      x: coords.col * squareSize + squareSize / 2,
      y: coords.row * squareSize + squareSize / 2,
    };
  }

  private squareToCoords(square: string): { row: number; col: number } | null {
    if (!this.isSquare(square)) {
      return null;
    }

    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;

    if (file < 0 || file > 7 || rank < 0 || rank > 7) {
      return null;
    }

    if (this.orientation === 'white') {
      return { row: 7 - rank, col: file };
    }

    return { row: rank, col: 7 - file };
  }

  private coordsToSquare(row: number, col: number): string | null {
    if (row < 0 || row > 7 || col < 0 || col > 7) {
      return null;
    }

    let fileIndex = col;
    let rankIndex = 7 - row;

    if (this.orientation === 'black') {
      fileIndex = 7 - col;
      rankIndex = row;
    }

    const file = String.fromCharCode(97 + fileIndex);
    const rank = String(rankIndex + 1);
    const square = `${file}${rank}`;

    return this.isSquare(square) ? square : null;
  }

  private eventToSquare(event: MouseEvent): string | null {
    const squareSize = this.canvas.width / 8;
    const col = Math.floor(event.offsetX / squareSize);
    const row = Math.floor(event.offsetY / squareSize);
    return this.coordsToSquare(row, col);
  }

  private parseBoardPart(fen: string): Map<string, PieceCode> {
    const map = new Map<string, PieceCode>();
    const boardPart = fen.trim().split(/\s+/)[0] ?? '';
    const ranks = boardPart.split('/');

    if (ranks.length !== 8) {
      return map;
    }

    for (let rankIndex = 0; rankIndex < 8; rankIndex += 1) {
      let file = 0;
      const rankToken = ranks[rankIndex];

      for (const char of rankToken) {
        if (/^[1-8]$/.test(char)) {
          file += Number(char);
          continue;
        }

        if (!/[prnbqkPRNBQK]/.test(char) || file > 7) {
          continue;
        }

        const square = `${String.fromCharCode(97 + file)}${8 - rankIndex}`;
        map.set(square, char as PieceCode);
        file += 1;
      }
    }

    return map;
  }

  private boardToFen(): string {
    const ranks: string[] = [];

    for (let rank = 8; rank >= 1; rank -= 1) {
      let fenRank = '';
      let empty = 0;

      for (let file = 0; file < 8; file += 1) {
        const square = `${String.fromCharCode(97 + file)}${rank}`;
        const piece = this.board.get(square);

        if (!piece) {
          empty += 1;
          continue;
        }

        if (empty > 0) {
          fenRank += String(empty);
          empty = 0;
        }

        fenRank += piece;
      }

      if (empty > 0) {
        fenRank += String(empty);
      }

      ranks.push(fenRank);
    }

    return ranks.join('/');
  }

  private isSquare(value: string): boolean {
    return /^[a-h][1-8]$/.test(value);
  }

  private getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is unavailable');
    }
    return context;
  }
}
