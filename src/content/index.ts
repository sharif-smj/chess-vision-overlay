import type { VisionPipelineUpdate } from '../vision/pipeline';
import { VisionPipeline } from '../vision/pipeline';

const STORAGE_KEY = 'cvo:lastVisionUpdate';
const PANEL_ID = 'cvo-status-panel';
const VIDEO_SCAN_INTERVAL_MS = 1000;

class ContentController {
  private readonly pipeline = new VisionPipeline();
  private currentVideo: HTMLVideoElement | null = null;
  private scanIntervalId: number | null = null;
  private statusText: HTMLElement | null = null;
  private fenText: HTMLElement | null = null;
  private regionText: HTMLElement | null = null;

  init(): void {
    this.mountStatusPanel();
    this.startVideoScanning();
    window.addEventListener('beforeunload', () => {
      this.teardown();
    });
  }

  private mountStatusPanel(): void {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.className = 'cvo-panel';
    panel.innerHTML = `
      <div class="cvo-panel__title">Chess Vision Overlay</div>
      <div class="cvo-panel__row">
        <span class="cvo-panel__label">Status</span>
        <span id="cvo-status-value">Waiting for video...</span>
      </div>
      <div class="cvo-panel__row">
        <span class="cvo-panel__label">FEN</span>
        <code id="cvo-fen-value">-</code>
      </div>
      <div class="cvo-panel__row">
        <span class="cvo-panel__label">Board</span>
        <span id="cvo-region-value">-</span>
      </div>
    `;

    document.body.append(panel);
    this.statusText = panel.querySelector('#cvo-status-value');
    this.fenText = panel.querySelector('#cvo-fen-value');
    this.regionText = panel.querySelector('#cvo-region-value');
  }

  private startVideoScanning(): void {
    this.scanAndAttachVideo();
    this.scanIntervalId = window.setInterval(() => {
      this.scanAndAttachVideo();
    }, VIDEO_SCAN_INTERVAL_MS);
  }

  private scanAndAttachVideo(): void {
    const videoElement = document.querySelector('video') as HTMLVideoElement | null;

    if (!videoElement) {
      this.updateStatus('Waiting for video...');
      if (this.currentVideo) {
        this.pipeline.stop();
        this.currentVideo = null;
      }
      return;
    }

    if (this.currentVideo === videoElement) {
      return;
    }

    if (this.currentVideo) {
      this.pipeline.stop();
    }

    this.currentVideo = videoElement;
    this.updateStatus('Tracking board...');
    this.pipeline.start(videoElement, (update) => {
      this.onPipelineUpdate(update);
    });
  }

  private onPipelineUpdate(update: VisionPipelineUpdate): void {
    this.fenText?.replaceChildren(update.fen);
    this.regionText?.replaceChildren(
      `${update.boardRegion.x},${update.boardRegion.y} ${update.boardRegion.width}x${update.boardRegion.height}`,
    );
    this.updateStatus(`Change: ${update.change}`);

    const message = { type: 'cvo:vision-update', payload: update } as const;
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        // Panel may be closed; update is still persisted to storage.
      }
    });
    void chrome.storage.local.set({ [STORAGE_KEY]: update });
  }

  private updateStatus(text: string): void {
    this.statusText?.replaceChildren(text);
  }

  private teardown(): void {
    if (this.scanIntervalId !== null) {
      window.clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
    this.pipeline.stop();
    this.currentVideo = null;
  }
}

new ContentController().init();
