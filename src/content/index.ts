import type { VisionPipelineUpdate } from '../vision/pipeline';
import { VisionPipeline } from '../vision/pipeline';

const STORAGE_KEY = 'cvo:lastVisionUpdate';
const PANEL_ID = 'cvo-status-panel';
const VIDEO_SCAN_INTERVAL_MS = 1000;
const YOUTUBE_PLAYER_SELECTOR = '#movie_player, .html5-video-player, .ytp-chrome-controls, .ytp-player-content';

type ShortcutCommand = 'pause-sync' | 'flip-board' | 'toggle-eval-bar' | 'toggle-best-move' | 'toggle-settings';

class ContentController {
  private readonly pipeline = new VisionPipeline();
  private currentVideo: HTMLVideoElement | null = null;
  private scanIntervalId: number | null = null;
  private statusText: HTMLElement | null = null;
  private fenText: HTMLElement | null = null;
  private regionText: HTMLElement | null = null;

  init(): void {
    this.mountStatusPanel();
    this.bindKeyboardShortcuts();
    this.startVideoScanning();
    window.addEventListener('beforeunload', () => {
      this.teardown();
    });
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (event) => {
      if (event.repeat || !this.isYouTubePlayerFocused()) {
        return;
      }

      const tagName = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          this.sendShortcut('pause-sync');
          break;
        case 'KeyF':
          this.sendShortcut('flip-board');
          break;
        case 'KeyE':
          this.sendShortcut('toggle-eval-bar');
          break;
        case 'KeyA':
          this.sendShortcut('toggle-best-move');
          break;
        case 'KeyS':
          this.sendShortcut('toggle-settings');
          break;
        default:
          break;
      }
    });
  }

  private isYouTubePlayerFocused(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
      return false;
    }

    if (active.tagName.toLowerCase() === 'video') {
      return true;
    }

    return Boolean(active.closest(YOUTUBE_PLAYER_SELECTOR));
  }

  private sendShortcut(command: ShortcutCommand): void {
    chrome.runtime.sendMessage({ type: 'cvo:shortcut', command } as const, () => {
      if (chrome.runtime.lastError) {
        // Panel may be closed.
      }
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
