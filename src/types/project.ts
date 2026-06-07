/** プロジェクトの解像度プリセット */
export const RESOLUTION_PRESETS = {
  'HD 720p': { width: 1280, height: 720 },
  'Full HD 1080p': { width: 1920, height: 1080 },
  '2K': { width: 2560, height: 1440 },
  '4K UHD': { width: 3840, height: 2160 },
  'Instagram Square': { width: 1080, height: 1080 },
  'Instagram Story': { width: 1080, height: 1920 },
  'YouTube Shorts': { width: 1080, height: 1920 },
} as const;

/** FPSプリセット */
export const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

/** プロジェクト設定 */
export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** デュレーション（秒） */
  duration: number;
  /** 背景色 */
  backgroundColor: string;
}

/** デフォルトのプロジェクト設定 */
export function createDefaultProject(): ProjectSettings {
  return {
    name: 'Untitled Project',
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 10,
    backgroundColor: '#000000',
  };
}
