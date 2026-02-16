export type BoardPerspective = 'white-bottom' | 'black-bottom';

export function piecesToFen(pieces: string[]): string {
  const ranks: string[] = [];

  for (let rank = 0; rank < 8; rank++) {
    let fenRank = '';
    let empty = 0;

    for (let file = 0; file < 8; file++) {
      const piece = pieces[rank * 8 + file] ?? '1';
      if (piece === '1') {
        empty += 1;
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

export function fenToPieces(fen: string): string[] {
  const boardPart = fen.trim().split(/\s+/)[0] ?? '';
  const ranks = boardPart.split('/');
  const pieces = new Array<string>(64).fill('1');

  if (ranks.length !== 8) {
    return pieces;
  }

  for (let rank = 0; rank < 8; rank++) {
    let file = 0;
    for (const token of ranks[rank]) {
      if (/^[1-8]$/.test(token)) {
        file += Number(token);
        continue;
      }

      if (!/[prnbqkPRNBQK]/.test(token) || file > 7) {
        continue;
      }

      pieces[rank * 8 + file] = token;
      file += 1;
    }
  }

  return pieces;
}

export function rotatePieces180(pieces: string[]): string[] {
  const out = new Array<string>(64);

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const src = rank * 8 + file;
      const dstRank = 7 - rank;
      const dstFile = 7 - file;
      const dst = dstRank * 8 + dstFile;
      out[dst] = pieces[src] ?? '1';
    }
  }

  return out;
}

export function detectBoardPerspective(pieces: string[]): BoardPerspective {
  let whiteBottomScore = 0;
  let blackBottomScore = 0;

  for (let rank = 0; rank < 8; rank++) {
    const topWeight = Math.max(0, 4 - rank);
    const bottomWeight = Math.max(0, rank - 3);

    for (let file = 0; file < 8; file++) {
      const piece = pieces[rank * 8 + file];
      if (!piece || piece === '1') {
        continue;
      }

      const isWhite = piece === piece.toUpperCase();
      if (isWhite) {
        whiteBottomScore += bottomWeight - topWeight;
        blackBottomScore += topWeight - bottomWeight;
      } else {
        whiteBottomScore += topWeight - bottomWeight;
        blackBottomScore += bottomWeight - topWeight;
      }
    }
  }

  return blackBottomScore > whiteBottomScore ? 'black-bottom' : 'white-bottom';
}
