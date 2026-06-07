import { create } from 'zustand';
import type { ProjectSettings } from '../types/project';
import { createDefaultProject } from '../types/project';

interface ProjectState {
  settings: ProjectSettings;
  /** 総フレーム数を計算 */
  totalFrames: () => number;
  /** 設定を更新 */
  updateSettings: (partial: Partial<ProjectSettings>) => void;
  /** 新規プロジェクト */
  resetProject: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  settings: createDefaultProject(),

  totalFrames: () => {
    const s = get().settings;
    return Math.ceil(s.duration * s.fps);
  },

  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  resetProject: () =>
    set({ settings: createDefaultProject() }),
}));
