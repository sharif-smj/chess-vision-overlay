// Content script — injected on YouTube pages
// Responsibilities:
// 1. Capture video frames via Canvas API
// 2. Inject side panel next to YouTube player
// 3. Communicate with vision pipeline (Web Worker)

console.log('[Chess Vision Overlay] Content script loaded');
