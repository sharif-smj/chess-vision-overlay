import type { Rect } from './frame-capture';

export type BoardRegion = Rect;

export interface BoardDetectorOptions {
  minCoverage: number;
  maxInputDimension: number;
  edgePercentile: number;
  occlusionPaddingRatio: number;
}

const DEFAULT_OPTIONS: BoardDetectorOptions = {
  minCoverage: 0.06,
  maxInputDimension: 360,
  edgePercentile: 0.88,
  occlusionPaddingRatio: 0.07,
};

// Heuristic board detector for MVP.
// Uses luminance edge map + connected components and picks the largest square-ish region.
export class BoardDetector {
  private readonly options: BoardDetectorOptions;

  constructor(options: Partial<BoardDetectorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async detect(imageData: ImageData): Promise<BoardRegion | null> {
    const { width, height } = imageData;
    if (width < 32 || height < 32) {
      return null;
    }

    const scale = Math.min(1, this.options.maxInputDimension / Math.max(width, height));
    const sw = Math.max(32, Math.floor(width * scale));
    const sh = Math.max(32, Math.floor(height * scale));

    const luminance = this.downsampleLuminance(imageData, sw, sh);
    const edges = this.computeEdgeStrength(luminance, sw, sh);
    const threshold = this.percentileThreshold(edges, this.options.edgePercentile);
    const mask = this.closeMask(this.binarize(edges, threshold), sw, sh);

    const candidate = this.findBestSquareComponent(mask, sw, sh);
    if (!candidate) {
      return null;
    }

    const adjusted = this.expandForCornerOcclusion(candidate, sw, sh);

    if (adjusted.coverage < this.options.minCoverage) {
      return null;
    }

    return {
      x: Math.floor(adjusted.x / scale),
      y: Math.floor(adjusted.y / scale),
      width: Math.floor(adjusted.width / scale),
      height: Math.floor(adjusted.height / scale),
    };
  }

  private downsampleLuminance(imageData: ImageData, sw: number, sh: number): Uint8Array {
    const out = new Uint8Array(sw * sh);
    const src = imageData.data;
    const xRatio = imageData.width / sw;
    const yRatio = imageData.height / sh;

    for (let y = 0; y < sh; y++) {
      const sy = Math.min(imageData.height - 1, Math.floor((y + 0.5) * yRatio));
      for (let x = 0; x < sw; x++) {
        const sx = Math.min(imageData.width - 1, Math.floor((x + 0.5) * xRatio));
        const idx = (sy * imageData.width + sx) * 4;
        const r = src[idx];
        const g = src[idx + 1];
        const b = src[idx + 2];
        out[y * sw + x] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }

    return out;
  }

  private computeEdgeStrength(luma: Uint8Array, width: number, height: number): Uint16Array {
    const edges = new Uint16Array(width * height);

    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const idx = y * width + x;
        const current = luma[idx];
        const dx = Math.abs(current - luma[idx + 1]);
        const dy = Math.abs(current - luma[idx + width]);
        edges[idx] = dx + dy;
      }
    }

    return edges;
  }

  private percentileThreshold(edges: Uint16Array, percentile: number): number {
    const sorted = Array.from(edges).sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * percentile)));
    return sorted[index];
  }

  private binarize(edges: Uint16Array, threshold: number): Uint8Array {
    const mask = new Uint8Array(edges.length);
    for (let i = 0; i < edges.length; i++) {
      mask[i] = edges[i] >= threshold ? 1 : 0;
    }
    return mask;
  }

  private closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
    const dilated = new Uint8Array(mask.length);
    const eroded = new Uint8Array(mask.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] === 1) {
          dilated[idx] = 1;
          if (x > 0) dilated[idx - 1] = 1;
          if (x + 1 < width) dilated[idx + 1] = 1;
          if (y > 0) dilated[idx - width] = 1;
          if (y + 1 < height) dilated[idx + width] = 1;
        }
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const left = x > 0 ? dilated[idx - 1] : 0;
        const right = x + 1 < width ? dilated[idx + 1] : 0;
        const up = y > 0 ? dilated[idx - width] : 0;
        const down = y + 1 < height ? dilated[idx + width] : 0;
        eroded[idx] = dilated[idx] === 1 && left === 1 && right === 1 && up === 1 && down === 1 ? 1 : 0;
      }
    }

    return eroded;
  }

  private expandForCornerOcclusion(
    candidate: { x: number; y: number; width: number; height: number; coverage: number },
    width: number,
    height: number,
  ): { x: number; y: number; width: number; height: number; coverage: number } {
    const side = Math.round(Math.max(candidate.width, candidate.height));
    const pad = Math.round(side * this.options.occlusionPaddingRatio);
    const paddedSide = Math.min(Math.max(candidate.width, candidate.height) + pad * 2, Math.min(width, height));
    const centerX = candidate.x + candidate.width / 2;
    const centerY = candidate.y + candidate.height / 2;

    const x = Math.max(0, Math.min(width - paddedSide, Math.round(centerX - paddedSide / 2)));
    const y = Math.max(0, Math.min(height - paddedSide, Math.round(centerY - paddedSide / 2)));
    const area = paddedSide * paddedSide;

    return {
      x,
      y,
      width: paddedSide,
      height: paddedSide,
      coverage: area / (width * height),
    };
  }

  private findBestSquareComponent(mask: Uint8Array, width: number, height: number):
    | { x: number; y: number; width: number; height: number; coverage: number }
    | null {
    const visited = new Uint8Array(mask.length);
    const queueX = new Int32Array(mask.length);
    const queueY = new Int32Array(mask.length);

    let best: { x: number; y: number; width: number; height: number; coverage: number; score: number } | null = null;

    for (let startY = 0; startY < height; startY++) {
      for (let startX = 0; startX < width; startX++) {
        const startIdx = startY * width + startX;
        if (mask[startIdx] === 0 || visited[startIdx] === 1) {
          continue;
        }

        let qStart = 0;
        let qEnd = 0;
        queueX[qEnd] = startX;
        queueY[qEnd] = startY;
        qEnd++;
        visited[startIdx] = 1;

        let minX = startX;
        let maxX = startX;
        let minY = startY;
        let maxY = startY;
        let pixels = 0;

        while (qStart < qEnd) {
          const x = queueX[qStart];
          const y = queueY[qStart];
          qStart++;
          pixels++;

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          const neighbors: Array<[number, number]> = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ];

          for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              continue;
            }
            const nIdx = ny * width + nx;
            if (mask[nIdx] === 0 || visited[nIdx] === 1) {
              continue;
            }
            visited[nIdx] = 1;
            queueX[qEnd] = nx;
            queueY[qEnd] = ny;
            qEnd++;
          }
        }

        const boxWidth = maxX - minX + 1;
        const boxHeight = maxY - minY + 1;
        const aspect = boxWidth / boxHeight;
        const squareness = Math.max(0, 1 - Math.abs(1 - aspect));
        const area = boxWidth * boxHeight;
        const fill = pixels / area;
        const score = area * squareness * fill;
        const coverage = area / (width * height);

        if (!best || score > best.score) {
          best = {
            x: minX,
            y: minY,
            width: boxWidth,
            height: boxHeight,
            coverage,
            score,
          };
        }
      }
    }

    if (!best) {
      return null;
    }

    const side = Math.round((best.width + best.height) / 2);
    const centerX = best.x + best.width / 2;
    const centerY = best.y + best.height / 2;

    return {
      x: Math.max(0, Math.round(centerX - side / 2)),
      y: Math.max(0, Math.round(centerY - side / 2)),
      width: Math.min(width, side),
      height: Math.min(height, side),
      coverage: best.coverage,
    };
  }
}
