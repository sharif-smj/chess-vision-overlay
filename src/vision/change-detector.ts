// Compare FEN states to detect moves and new games
export class ChangeDetector {
  private lastFen: string | null = null;

  detect(currentFen: string): { type: 'no-change' | 'move' | 'new-game'; fen: string } {
    if (!this.lastFen) {
      this.lastFen = currentFen;
      return { type: 'new-game', fen: currentFen };
    }

    if (currentFen === this.lastFen) {
      return { type: 'no-change', fen: currentFen };
    }

    // Count how many squares differ
    const diff = this.countDifferences(this.lastFen, currentFen);
    this.lastFen = currentFen;

    // >10 squares changed = likely new game
    if (diff > 10) {
      return { type: 'new-game', fen: currentFen };
    }

    return { type: 'move', fen: currentFen };
  }

  private countDifferences(fen1: string, fen2: string): number {
    const board1 = fen1.split(' ')[0];
    const board2 = fen2.split(' ')[0];
    const expand = (f: string) => f.replace(/\d/g, (d) => '.'.repeat(parseInt(d)));
    const s1 = expand(board1).replace(/\//g, '');
    const s2 = expand(board2).replace(/\//g, '');
    let diff = 0;
    for (let i = 0; i < 64; i++) {
      if (s1[i] !== s2[i]) diff++;
    }
    return diff;
  }

  reset() {
    this.lastFen = null;
  }
}
