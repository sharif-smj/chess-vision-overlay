// Detect chessboard region within a video frame
// Uses ML model (ONNX) to locate the board bounding box
export class BoardDetector {
  // TODO: Load ONNX model, detect board region
  async detect(imageData: ImageData): Promise<{ x: number; y: number; width: number; height: number } | null> {
    throw new Error('Not implemented — pending model selection (Issue #1)');
  }
}
