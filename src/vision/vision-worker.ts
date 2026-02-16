/// <reference lib="webworker" />

import { BoardDetector, type BoardRegion } from './board-detector';
import { piecesToFen } from './fen-utils';
import { PieceClassifier } from './piece-classifier';

interface ProcessMessage {
  type: 'process';
  requestId: number;
  frame: ImageData;
  now: number;
  boardRefreshMs: number;
  confidenceThreshold: number;
  forceFlip: boolean;
}

interface CancelMessage {
  type: 'cancel';
  requestId: number;
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = ProcessMessage | CancelMessage | DisposeMessage;

interface ProcessResult {
  type: 'result';
  requestId: number;
  fen: string;
  boardRegion: BoardRegion;
  confidenceAverage: number;
  lowConfidenceSquares: number;
  detectorMs: number;
  classifierMs: number;
  processingMs: number;
  wasFlipped: boolean;
}

interface ErrorResult {
  type: 'error';
  requestId: number;
  message: string;
}

const boardDetector = new BoardDetector();
const pieceClassifier = new PieceClassifier();

let cachedBoardRegion: BoardRegion | null = null;
let lastBoardDetectionAt = 0;
let canceledRequestId = 0;
let previousPieces: string[] | null = null;

function cropImageData(imageData: ImageData, rect: BoardRegion): ImageData {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const maxWidth = imageData.width - x;
  const maxHeight = imageData.height - y;
  const width = Math.max(1, Math.min(Math.floor(rect.width), maxWidth));
  const height = Math.max(1, Math.min(Math.floor(rect.height), maxHeight));

  const output = new ImageData(width, height);
  const src = imageData.data;
  const dst = output.data;

  for (let row = 0; row < height; row++) {
    const srcOffset = ((y + row) * imageData.width + x) * 4;
    const dstOffset = row * width * 4;
    dst.set(src.subarray(srcOffset, srcOffset + width * 4), dstOffset);
  }

  return output;
}

function isCanceled(requestId: number): boolean {
  return requestId <= canceledRequestId;
}

async function handleProcess(message: ProcessMessage): Promise<void> {
  if (isCanceled(message.requestId)) {
    return;
  }

  const start = performance.now();
  let detectorMs = 0;
  let classifierMs = 0;

  try {
    if (!cachedBoardRegion || message.now - lastBoardDetectionAt >= message.boardRefreshMs) {
      const detectStart = performance.now();
      cachedBoardRegion = await boardDetector.detect(message.frame);
      detectorMs = performance.now() - detectStart;
      lastBoardDetectionAt = message.now;
    }

    if (!cachedBoardRegion || isCanceled(message.requestId)) {
      return;
    }

    const boardImage = cropImageData(message.frame, cachedBoardRegion);

    const classifyStart = performance.now();
    const classification = await pieceClassifier.classifyDetailed(boardImage, {
      forceFlip: message.forceFlip,
    });
    classifierMs = performance.now() - classifyStart;

    if (isCanceled(message.requestId)) {
      return;
    }

    const pieces = classification.pieces.slice();
    let lowConfidenceSquares = 0;

    if (previousPieces) {
      for (let i = 0; i < 64; i++) {
        if (classification.confidences[i] < message.confidenceThreshold) {
          pieces[i] = previousPieces[i];
          lowConfidenceSquares += 1;
        }
      }
    }

    previousPieces = pieces;

    const response: ProcessResult = {
      type: 'result',
      requestId: message.requestId,
      fen: piecesToFen(pieces),
      boardRegion: cachedBoardRegion,
      confidenceAverage: classification.averageConfidence,
      lowConfidenceSquares,
      detectorMs,
      classifierMs,
      processingMs: performance.now() - start,
      wasFlipped: classification.wasFlipped,
    };

    if (!isCanceled(message.requestId)) {
      self.postMessage(response);
    }
  } catch (error) {
    const response: ErrorResult = {
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    };

    if (!isCanceled(message.requestId)) {
      self.postMessage(response);
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    canceledRequestId = Math.max(canceledRequestId, message.requestId);
    return;
  }

  if (message.type === 'dispose') {
    canceledRequestId = Number.MAX_SAFE_INTEGER;
    cachedBoardRegion = null;
    previousPieces = null;
    void pieceClassifier.dispose();
    return;
  }

  void handleProcess(message);
});
