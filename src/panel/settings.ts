import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings,
} from '../shared/settings';

export interface SettingsControllerCallbacks {
  onSettingsChanged?: (settings: ExtensionSettings) => void;
}

export class SettingsController {
  private readonly panel: HTMLElement;
  private readonly scanFrequencyInput: HTMLInputElement;
  private readonly scanFrequencyValue: HTMLElement;
  private readonly engineDepthInput: HTMLInputElement;
  private readonly engineDepthValue: HTMLElement;
  private readonly boardThemeSelect: HTMLSelectElement;
  private readonly autoSyncInput: HTMLInputElement;
  private readonly showEvalBarInput: HTMLInputElement;
  private readonly showBestMoveInput: HTMLInputElement;
  private readonly darkThemeInput: HTMLInputElement;
  private readonly showPerformanceInput: HTMLInputElement;
  private readonly callbacks: SettingsControllerCallbacks;

  private settings: ExtensionSettings = DEFAULT_SETTINGS;

  constructor(callbacks: SettingsControllerCallbacks = {}) {
    this.callbacks = callbacks;
    this.panel = this.getById('settings-panel');
    this.scanFrequencyInput = this.getById('setting-scan-frequency') as HTMLInputElement;
    this.scanFrequencyValue = this.getById('setting-scan-frequency-value');
    this.engineDepthInput = this.getById('setting-engine-depth') as HTMLInputElement;
    this.engineDepthValue = this.getById('setting-engine-depth-value');
    this.boardThemeSelect = this.getById('setting-board-theme') as HTMLSelectElement;
    this.autoSyncInput = this.getById('setting-auto-sync') as HTMLInputElement;
    this.showEvalBarInput = this.getById('setting-show-eval-bar') as HTMLInputElement;
    this.showBestMoveInput = this.getById('setting-show-best-move') as HTMLInputElement;
    this.darkThemeInput = this.getById('setting-theme') as HTMLInputElement;
    this.showPerformanceInput = this.getById('setting-show-performance') as HTMLInputElement;
  }

  async init(): Promise<ExtensionSettings> {
    this.bindEvents();
    this.settings = await loadSettings();
    this.render(this.settings);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) {
        return;
      }

      const next = changes[SETTINGS_STORAGE_KEY].newValue as ExtensionSettings | undefined;
      if (!next) {
        return;
      }

      this.settings = next;
      this.render(next);
      this.callbacks.onSettingsChanged?.(next);
    });

    return this.settings;
  }

  getSettings(): ExtensionSettings {
    return this.settings;
  }

  openPanel(): void {
    this.panel.classList.remove('hidden');
  }

  togglePanel(): void {
    this.panel.classList.toggle('hidden');
  }

  private bindEvents(): void {
    this.scanFrequencyInput.addEventListener('input', () => {
      this.scanFrequencyValue.textContent = `${Number(this.scanFrequencyInput.value).toFixed(1)}s`;
    });

    this.engineDepthInput.addEventListener('input', () => {
      this.engineDepthValue.textContent = `${Math.round(Number(this.engineDepthInput.value))}`;
    });

    this.scanFrequencyInput.addEventListener('change', () => {
      void this.persist({ scanFrequencySec: Number(this.scanFrequencyInput.value) });
    });

    this.engineDepthInput.addEventListener('change', () => {
      void this.persist({ engineDepth: Number(this.engineDepthInput.value) });
    });

    this.boardThemeSelect.addEventListener('change', () => {
      void this.persist({ boardTheme: this.boardThemeSelect.value as ExtensionSettings['boardTheme'] });
    });

    this.autoSyncInput.addEventListener('change', () => {
      void this.persist({ autoSync: this.autoSyncInput.checked });
    });

    this.showEvalBarInput.addEventListener('change', () => {
      void this.persist({ showEvalBar: this.showEvalBarInput.checked });
    });

    this.showBestMoveInput.addEventListener('change', () => {
      void this.persist({ showBestMoveArrow: this.showBestMoveInput.checked });
    });

    this.darkThemeInput.addEventListener('change', () => {
      void this.persist({ uiTheme: this.darkThemeInput.checked ? 'dark' : 'light' });
    });

    this.showPerformanceInput.addEventListener('change', () => {
      void this.persist({ showPerformanceStats: this.showPerformanceInput.checked });
    });
  }

  private async persist(patch: Partial<ExtensionSettings>): Promise<void> {
    this.settings = await saveSettings(patch);
    this.render(this.settings);
    this.callbacks.onSettingsChanged?.(this.settings);
  }

  private render(settings: ExtensionSettings): void {
    this.scanFrequencyInput.value = String(settings.scanFrequencySec);
    this.scanFrequencyValue.textContent = `${settings.scanFrequencySec.toFixed(1)}s`;

    this.engineDepthInput.value = String(settings.engineDepth);
    this.engineDepthValue.textContent = String(settings.engineDepth);

    this.boardThemeSelect.value = settings.boardTheme;
    this.autoSyncInput.checked = settings.autoSync;
    this.showEvalBarInput.checked = settings.showEvalBar;
    this.showBestMoveInput.checked = settings.showBestMoveArrow;
    this.darkThemeInput.checked = settings.uiTheme === 'dark';
    this.showPerformanceInput.checked = settings.showPerformanceStats;

    document.body.dataset.theme = settings.uiTheme;
  }

  private getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing required settings element: ${id}`);
    }
    return element;
  }
}
