# ♟️ Chess Vision Overlay

A Chrome extension that uses computer vision to detect chess positions from YouTube videos in real-time, syncs to an interactive analysis board with Stockfish evaluation.

## The Idea

Watching Eric Rosen, Magnus Carlsen, or GothamChess? This extension:

1. **Detects the chess board** from the video frame using ML
2. **Recognizes all pieces** and generates the board position (FEN)
3. **Syncs to an interactive board** in a side panel
4. **Runs Stockfish eval** (depth 18-22) with best move arrows
5. **Auto-advances** as the game progresses in the video
6. **Detects new games** when the streamer moves to the next game

## Features

- 🔍 Real-time board detection from YouTube video frames
- ♟️ Interactive side panel board (drag pieces, explore "what if" lines)
- 📊 Classic eval bar (Stockfish WASM, depth 18-22)
- ➡️ Best move arrows drawn on the board
- 🎯 Arrow & square annotations (right-click drag)
- 🔄 Auto-advance with manual override
- 🆕 Smart new game detection
- ⚡ Runs entirely in-browser (no server needed)

## Tech Stack

- **Chrome Extension** (Manifest V3)
- **TypeScript**
- **ONNX Runtime Web** (WASM) — chess piece recognition model
- **Stockfish WASM** — in a Web Worker
- **chessboard.js + chess.js** — interactive board
- **Canvas API** — video frame capture

## Architecture

```
YouTube Video Frame (captured every 1-2s)
       ↓
Board Detector (locate chessboard region)
       ↓
Piece Classifier (identify 64 squares → FEN)
       ↓
Change Detector (same position? new game?)
       ↓
┌─────────────────────────────────┐
│  Side Panel                     │
│  ┌───────────────────────────┐  │
│  │  Interactive Board        │  │
│  │  + Best move arrows       │  │
│  │  + Annotations            │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │  Eval Bar + Engine Line   │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │  Move History + Games     │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## Development

```bash
npm install
npm run dev        # Build with watch mode
npm run build      # Production build
npm run test       # Run tests
```

Load unpacked extension from `dist/` in Chrome.

## Project Status

🚧 **Under active development** — See [Issues](../../issues) for current progress.

## License

MIT
