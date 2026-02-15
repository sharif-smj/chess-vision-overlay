# Chess Board Recognition Models — Research

> Last updated: 2026-02-15

## Executive Summary

We need an in-browser model pipeline that can detect a chessboard within a YouTube video frame and classify all 64 squares in real-time (~5-15 FPS). This document surveys existing open-source projects, inference runtimes, training data, and recommends an architecture.

**Recommendation:** Use a lightweight two-stage pipeline — YOLOv8-nano (exported to ONNX) for board detection + a small CNN (MobileNetV3 or custom) for per-square piece classification — running on ONNX Runtime Web with WebGL backend. Alternatively, for screen-captured 2D boards (our primary use case), skip heavy detection entirely and use Hough-line / edge-based board localization with a TensorFlow.js piece classifier.

---

## 1. Existing GitHub Projects

### 1.1 chesscog (georg-wolflein/chesscog)
- **Paper:** "Determining Chess Game State From an Image" (Journal of Imaging, 2021)
- **Approach:** Traditional CV (corner/line detection for board localization) + CNN for occupancy classification + CNN for piece classification. Three-stage pipeline.
- **Framework:** PyTorch (ResNet-based classifiers)
- **Training data:** ~5,000 synthetically generated 3D-rendered chessboard images at various angles/lighting. Dataset on OSF.
- **Strengths:** Academic rigor, published paper, well-documented pipeline, synthetic data generation pipeline included
- **Weaknesses:** Designed for photos of physical boards (perspective correction), not 2D screen captures. PyTorch models need conversion for browser.
- **ONNX export:** Yes — PyTorch models export to ONNX via `torch.onnx.export()` straightforwardly.
- **Model size:** ResNet-based classifiers ~25-90 MB depending on variant

### 1.2 LiveChess2FEN (davidmallasen/LiveChess2FEN)
- **Paper:** "A Framework for Classifying Chess Pieces Based on CNNs" (arXiv, 2020)
- **Approach:** Board detection (LAPS algorithm — line detection + adaptive thresholding) + piece classification CNN. Optimized for Nvidia Jetson Nano.
- **Framework:** TensorFlow/Keras (uses Xception, InceptionV3, MobileNetV2, others)
- **Training data:** Real photos of physical chess pieces on boards
- **Strengths:** Benchmarked multiple CNN architectures with accuracy/speed tradeoffs. MobileNetV2 variant is small and fast.
- **Weaknesses:** Physical board focus, Jetson Nano optimized. Board detection is traditional CV (not ML), tuned for overhead camera.
- **ONNX export:** Yes — Keras/TF models export via `tf2onnx` or `keras2onnx`.
- **Model size:** MobileNetV2 ~14 MB, Xception ~88 MB

### 1.3 chessboard-recognizer (linrock/chessboard-recognizer)
- **Approach:** CNN that classifies 32×32 px tiles into 13 classes (6 white pieces, 6 black pieces, empty). Assumes a pre-cropped, aligned chessboard image split into 64 tiles.
- **Framework:** TensorFlow 2 / Keras
- **Training data:** Generated screenshots from Lichess/Chess.com with random positions (~hundreds of thousands of tile images)
- **Strengths:** Simple, effective for 2D digital boards. High accuracy (>99%) on Lichess/Chess.com screenshots. Pre-trained model available. **Most relevant to our use case.**
- **Weaknesses:** No board detection — requires pre-cropped aligned board. Only trained on specific piece styles.
- **ONNX export:** Yes — standard Keras model.
- **Model size:** Small CNN, ~1-5 MB

### 1.4 tensorflow_chessbot / ChessboardFenTensorflowJs (Elucidation)
- **Approach:** CNN on 32×32 grayscale tiles (5×5 conv layers → dense → 13-class softmax). **Has a working TensorFlow.js browser demo!**
- **Framework:** TensorFlow → TensorFlow.js (already converted)
- **Board detection:** Sobel gradients for edge detection to find board boundaries, then split into 256×256 aligned image.
- **Training data:** Screenshots from chess websites, auto-labeled from known positions
- **Strengths:** **Already runs in-browser with TF.js.** Proven architecture. Board detection + classification in JS. Closest existing solution to our needs.
- **Weaknesses:** Board detector is simplistic (requires board to mostly fill the frame, well-aligned). Old TF.js version. Grayscale only.
- **ONNX export:** Already has TF.js model; could also export to ONNX.
- **Model size:** ~1-2 MB (very small CNN)

### 1.5 Other Notable Projects

| Project | Notes |
|---------|-------|
| **Chessvision.ai** (commercial) | Chrome extension that does exactly what we want. Uses server-side inference. Closed source. Proves market demand. |
| **chess_board_segmentation** (various) | YOLOv5/v8 based board detection — good for finding the board region |
| **fen-reader** (pnrao/fen-reader) | OpenCV + template matching, no ML |
| **chess-ocr** (various) | OCR-style approaches, less relevant |

---

## 2. Two-Stage Architecture

### Stage 1: Board Detection (find the board region in the video frame)

| Method | Pros | Cons | Speed (browser) |
|--------|------|------|-----------------|
| **Hough lines + edge detection** (OpenCV.js) | No ML model needed, tiny footprint | Fragile with overlays/annotations, needs tuning | ~5-15ms |
| **YOLOv8-nano** (ONNX) | Robust, handles occlusion/overlays | 3-6 MB model, ~30-80ms inference | ~30-80ms |
| **Template matching** | Simple for known sites | Breaks with different themes/layouts | ~10-20ms |
| **Fixed regions / site-specific CSS selectors** | Zero inference cost | Only works for known sites, breaks with layout changes | ~0ms |

**Recommendation for Stage 1:** For YouTube chess videos, the board position varies significantly. Use a hybrid approach:
1. **Primary:** YOLOv8-nano trained on chess board detection (ONNX, ~4 MB). Run once per second, not every frame.
2. **Fallback:** Between detections, track the board region (it rarely moves in a video). Only re-detect on scene changes.

### Stage 2: Piece Classification (identify what's on each of the 64 squares)

Once the board region is extracted and split into 64 tiles:

| Method | Classes | Accuracy | Size | Speed (64 tiles) |
|--------|---------|----------|------|-------------------|
| **Small custom CNN** (à la chessboard-recognizer) | 13 | >99% on 2D boards | 1-5 MB | 10-30ms |
| **MobileNetV3-small** (fine-tuned) | 13 | >99% | 6-10 MB | 20-50ms |
| **EfficientNet-B0** | 13 | >99% | 15-20 MB | 40-100ms |
| **Batch CNN** (all 64 squares in one forward pass) | 13×64 | ~98% | 2-8 MB | 15-40ms |

**Recommendation for Stage 2:** A small custom CNN processing 64 tiles in a single batched inference call. The chessboard-recognizer architecture (2-3 conv layers, ~1-3 MB) is ideal. For 2D digital boards, accuracy is already excellent.

### Combined Pipeline Budget

| Component | Time | Frequency |
|-----------|------|-----------|
| Frame capture (canvas) | ~2ms | Every frame |
| Board detection (YOLO) | ~50ms | 1/second |
| Board crop + tile split | ~3ms | Every frame |
| Piece classification (batch) | ~20ms | Every frame |
| FEN generation + overlay | ~1ms | Every frame |
| **Total per frame** | **~26ms** | (with cached board region) |
| **Effective FPS** | **~30+ FPS** | |

---

## 3. Inference Runtimes: TensorFlow.js vs ONNX Runtime Web

| Feature | TensorFlow.js | ONNX Runtime Web |
|---------|---------------|------------------|
| **Model format** | TF.js layers/graph model | ONNX (.onnx) |
| **Backends** | WebGL, WebGPU, WASM, CPU | WebGL, WebGPU, WASM, CPU |
| **Bundle size** | ~800 KB - 1.5 MB (gzipped) | ~400-800 KB (gzipped) |
| **WebGPU support** | Yes (experimental) | Yes (more mature) |
| **Model ecosystem** | TF/Keras models convert easily | PyTorch, TF, Keras all export to ONNX |
| **Quantization** | Limited (uint8) | Excellent (int8, uint8, float16) |
| **Dynamic shapes** | Yes | Yes |
| **Operator coverage** | Good for TF models | Broader (standard ONNX ops) |
| **Chrome extension compat** | Works in content scripts & offscreen docs | Works in content scripts & offscreen docs |
| **Community/maintenance** | Google-backed, large community | Microsoft-backed, growing fast |
| **Performance (WebGL)** | Good | Slightly better for many models |
| **Performance (WASM)** | Good with SIMD | Excellent with SIMD+threads |

### Verdict

**ONNX Runtime Web is the better choice** for our use case:
1. **Model source flexibility** — chesscog (PyTorch), LiveChess2FEN (Keras), chessboard-recognizer (TF) all export to ONNX
2. **Smaller bundle** — matters for Chrome extension size limits
3. **Better quantization** — int8 quantization halves model size with minimal accuracy loss
4. **WebGPU maturity** — future-proofing for faster inference
5. **WASM+SIMD** — reliable fallback when WebGL is unavailable

TF.js is viable too (tensorflow_chessbot already uses it), but ONNX gives us more flexibility in model sourcing.

---

## 4. Model Sizes & Expected Browser Inference Times

All times estimated for mid-range laptop GPU via WebGL backend:

| Model | Original Size | ONNX (float32) | ONNX (int8 quantized) | Inference (WebGL) | Inference (WASM) |
|-------|--------------|-----------------|----------------------|-------------------|------------------|
| Custom small CNN (tile classifier) | 1-3 MB | 1-3 MB | 0.5-1.5 MB | 0.3-0.5ms/tile | 0.5-1ms/tile |
| MobileNetV2 (tile classifier) | 14 MB | 14 MB | 3.5 MB | 2-5ms/tile | 5-10ms/tile |
| YOLOv8-nano (board detector) | 6.3 MB | 6.3 MB | 2-3 MB | 30-80ms | 80-200ms |
| YOLOv8-nano (320px input) | 6.3 MB | 6.3 MB | 2-3 MB | 15-40ms | 50-120ms |
| ResNet-18 (tile classifier) | 44 MB | 44 MB | 11 MB | 3-8ms/tile | 8-15ms/tile |
| Batched small CNN (64 tiles) | 2-5 MB | 2-5 MB | 1-2.5 MB | 15-30ms total | 30-60ms total |

**Key insight:** For 64 tiles, batching is critical. Individual tile inference has overhead per call. A single forward pass with batch=64 is 5-10x faster than 64 individual calls.

### Total Extension Size Budget

| Component | Size (gzipped) |
|-----------|----------------|
| ONNX Runtime Web (WASM) | ~400 KB |
| Board detector (YOLOv8-nano, int8) | ~2 MB |
| Piece classifier (small CNN, int8) | ~1 MB |
| Extension code (JS/CSS) | ~50 KB |
| **Total** | **~3.5 MB** |

This is well within Chrome Web Store limits (though models can be lazy-loaded from CDN).

---

## 5. Training Data & Datasets

### Existing Datasets

| Dataset | Type | Size | Source |
|---------|------|------|--------|
| **chesscog synthetic** (OSF) | 3D rendered boards, varied angles/lighting | ~5,000 images | [OSF link](https://doi.org/10.17605/OSF.IO/XF3KA) |
| **chessboard-recognizer tiles** | 32×32 px tiles from Lichess/Chess.com screenshots | ~hundreds of thousands | Generated via script |
| **tensorflow_chessbot tiles** | 32×32 grayscale tiles from chess sites | ~50K+ tiles | Generated from screenshots |
| **Roboflow chess datasets** | YOLO-annotated board detection images | Various (1K-10K) | Roboflow Universe |
| **Chess Pieces Dataset** (Kaggle) | Individual piece images on boards | ~600 images, 6 classes | Kaggle |

### Our Data Strategy

For a **YouTube video overlay** use case, the training data must include:

1. **Board detection training:**
   - Screenshots from popular chess YouTube channels (Agadmator, GothamChess, Hikaru, chess24, Chess.com streams)
   - Various board themes, overlays, webcam positions, annotations
   - Annotate with bounding boxes around the board region
   - ~1,000-2,000 annotated frames should suffice for YOLOv8-nano fine-tuning

2. **Piece classification training:**
   - Tile images from all major chess site themes (Lichess default/brown/blue, Chess.com green/wood/etc.)
   - Include common video artifacts: compression, slight blur, color shifts
   - The chessboard-recognizer approach of generating tiles from known FEN positions is ideal
   - ~50K-100K tiles across all themes

3. **Data generation pipeline (recommended):**
   - Script that renders chess positions using known piece set SVGs onto board backgrounds
   - Apply video-like augmentations: JPEG compression, blur, brightness/contrast shifts, slight rotation
   - Automatically labeled from the generating FEN — no manual annotation needed

---

## 6. Project Comparison Table

| Feature | chesscog | LiveChess2FEN | chessboard-recognizer | tensorflow_chessbot/JS | **Our Approach** |
|---------|----------|---------------|----------------------|----------------------|------------------|
| **Target** | Physical boards (photos) | Physical boards (camera) | 2D digital boards | 2D digital boards | 2D boards in video |
| **Board detection** | CV (corners/lines) | LAPS (lines) | None (pre-cropped) | Sobel gradients | YOLO-nano + tracking |
| **Piece classifier** | ResNet (PyTorch) | MobileNetV2 (Keras) | Small CNN (Keras) | Small CNN (TF.js) | Small CNN (ONNX) |
| **Runs in browser** | No | No | No | **Yes** | **Yes** |
| **Model size** | ~50-90 MB | ~14-88 MB | ~1-5 MB | ~1-2 MB | ~3-4 MB total |
| **Real-time capable** | No | ~2-5 FPS (Jetson) | N/A | ~10-15 FPS | ~30+ FPS target |
| **Framework** | PyTorch | TensorFlow | TensorFlow | TensorFlow.js | ONNX Runtime Web |
| **ONNX exportable** | ✅ | ✅ | ✅ | ✅ (via TF) | Native |
| **Accuracy (2D)** | Overkill | Overkill | >99% | >99% | >99% target |
| **Relevance to us** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | — |

---

## 7. Final Recommendation

### Architecture

```
YouTube Video Frame (via canvas capture)
         │
         ▼
┌─────────────────────┐
│  Board Detector      │  ← YOLOv8-nano (ONNX, int8, ~2MB)
│  (runs 1x/second)   │    OR Hough-line CV (no model)
└────────┬────────────┘
         │ board bounding box (cached between detections)
         ▼
┌─────────────────────┐
│  Perspective/Crop    │  ← Extract & align 256×256 board image
│  + Tile Split        │    Split into 64 × 32×32 tiles
└────────┬────────────┘
         │ 64 tile images
         ▼
┌─────────────────────┐
│  Piece Classifier    │  ← Small CNN (ONNX, int8, ~1MB)
│  (batched, 64 tiles) │    13 classes per tile
└────────┬────────────┘
         │ 64 predictions
         ▼
┌─────────────────────┐
│  FEN Assembly        │  ← Assemble FEN string
│  + Overlay Render    │    Draw interactive overlay on video
└─────────────────────┘
```

### Implementation Plan

1. **Phase 1 — MVP (simplest possible, 1-2 weeks):**
   - Fork the ChessboardFenTensorflowJs approach
   - Use its existing TF.js model for piece classification
   - Manual board region selection (user draws rectangle on video) — skip auto-detection
   - This alone is useful and shippable

2. **Phase 2 — Auto-detection (2-3 weeks):**
   - Train YOLOv8-nano on chess board detection from YouTube frames
   - Export to ONNX, integrate with ONNX Runtime Web
   - Automatic board finding, re-detect on scene changes

3. **Phase 3 — Robustness (ongoing):**
   - Train piece classifier on more board themes
   - Add video-specific augmentations
   - WebGPU backend for newer browsers
   - Handle animated boards, move highlights, arrows

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Inference runtime | **ONNX Runtime Web** | Smaller bundle, better quantization, model flexibility |
| Board detection | **YOLOv8-nano → ONNX** | Robust, small, well-supported export pipeline |
| Piece classification | **Custom small CNN → ONNX** | Based on chessboard-recognizer architecture, <2MB |
| Quantization | **int8 (static)** | Halves model size, minimal accuracy loss on classification |
| Frame capture | **OffscreenCanvas + canvas.drawImage** | Works in Chrome extension offscreen document |
| Detection frequency | **Board: 1/sec, Pieces: every frame** | Board rarely moves; pieces need real-time updates |
| Inference location | **Web Worker (offscreen doc)** | Keep main thread free, ONNX WASM runs in workers |

### References

- chesscog: https://github.com/georg-wolflein/chesscog
- LiveChess2FEN: https://github.com/davidmallasen/LiveChess2FEN
- chessboard-recognizer: https://github.com/linrock/chessboard-recognizer
- ChessboardFenTensorflowJs: https://github.com/Elucidation/ChessboardFenTensorflowJs
- ONNX Runtime Web: https://onnxruntime.ai/docs/get-started/with-javascript.html
- TensorFlow.js: https://www.tensorflow.org/js
- YOLOv8 ONNX export: https://docs.ultralytics.com/modes/export/
