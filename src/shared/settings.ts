export const SETTINGS_STORAGE_KEY = 'cvo:settings';

export type BoardTheme = 'green' | 'brown' | 'blue' | 'gray';
export type UiTheme = 'dark' | 'light';

export interface ExtensionSettings {
  scanFrequencySec: number;
  engineDepth: number;
  boardTheme: BoardTheme;
  autoSync: boolean;
  showEvalBar: boolean;
  showBestMoveArrow: boolean;
  uiTheme: UiTheme;
  forceFlipBoard: boolean;
  showPerformanceStats: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  scanFrequencySec: 1.5,
  engineDepth: 20,
  boardTheme: 'green',
  autoSync: true,
  showEvalBar: true,
  showBestMoveArrow: true,
  uiTheme: 'dark',
  forceFlipBoard: false,
  showPerformanceStats: false,
};

const SCAN_MIN = 0.5;
const SCAN_MAX = 3;
const DEPTH_MIN = 10;
const DEPTH_MAX = 24;

const BOARD_THEMES = new Set<BoardTheme>(['green', 'brown', 'blue', 'gray']);
const UI_THEMES = new Set<UiTheme>(['dark', 'light']);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeSettings(candidate: Partial<ExtensionSettings> | undefined | null): ExtensionSettings {
  const value = candidate ?? {};

  const scanFrequencySec = typeof value.scanFrequencySec === 'number'
    ? Math.round(clamp(value.scanFrequencySec, SCAN_MIN, SCAN_MAX) * 10) / 10
    : DEFAULT_SETTINGS.scanFrequencySec;

  const engineDepth = typeof value.engineDepth === 'number'
    ? Math.round(clamp(value.engineDepth, DEPTH_MIN, DEPTH_MAX))
    : DEFAULT_SETTINGS.engineDepth;

  const boardTheme = value.boardTheme && BOARD_THEMES.has(value.boardTheme)
    ? value.boardTheme
    : DEFAULT_SETTINGS.boardTheme;

  const uiTheme = value.uiTheme && UI_THEMES.has(value.uiTheme)
    ? value.uiTheme
    : DEFAULT_SETTINGS.uiTheme;

  return {
    scanFrequencySec,
    engineDepth,
    boardTheme,
    autoSync: typeof value.autoSync === 'boolean' ? value.autoSync : DEFAULT_SETTINGS.autoSync,
    showEvalBar: typeof value.showEvalBar === 'boolean' ? value.showEvalBar : DEFAULT_SETTINGS.showEvalBar,
    showBestMoveArrow: typeof value.showBestMoveArrow === 'boolean'
      ? value.showBestMoveArrow
      : DEFAULT_SETTINGS.showBestMoveArrow,
    uiTheme,
    forceFlipBoard: typeof value.forceFlipBoard === 'boolean' ? value.forceFlipBoard : DEFAULT_SETTINGS.forceFlipBoard,
    showPerformanceStats: typeof value.showPerformanceStats === 'boolean'
      ? value.showPerformanceStats
      : DEFAULT_SETTINGS.showPerformanceStats,
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return sanitizeSettings(stored[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = sanitizeSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: merged });
  return merged;
}
