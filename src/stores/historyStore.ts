/**
 * Undo/Redo 履歴管理
 * zustand ストアのスナップショットベースで実装
 *
 * 設計メモ:
 * - スナップショットは layers と animations のみ保存
 * - compStack（プリコンポナビゲーション状態）は保存しない
 * - layerStore.undo/redo は呼び出し前に exitToRoot() を実行し、
 *   常にルートコンポレベルで Undo/Redo を行う
 */
import type { Layer } from '../types/layer';
import type { AnimatedProperty } from '../types/keyframe';
import { create } from 'zustand';

type AnimationMap = Record<string, Record<string, AnimatedProperty>>;

interface HistorySnapshot {
  layers: Layer[];
  animations: AnimationMap;
  compStack?: any[]; // LayerStore's CompStackEntry array
  activeCompName?: string | null;
}

interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  maxSize: number;

  /** 現在の状態をスナップショットとして保存 */
  pushSnapshot: (snapshot: HistorySnapshot) => void;
  /** Undo */
  undo: (current: HistorySnapshot) => HistorySnapshot | null;
  /** Redo */
  redo: (current: HistorySnapshot) => HistorySnapshot | null;
  /** 履歴をリセット */
  clearHistory: () => void;
  /** Undoできるか */
  canUndo: () => boolean;
  /** Redoできるか */
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  maxSize: 50,

  pushSnapshot: (snapshot) =>
    set((s) => ({
      past: [...s.past.slice(-(s.maxSize - 1)), snapshot],
      future: [], // 新しい操作が入ったらredoはクリア
    })),

  undo: (current) => {
    const state = get();
    if (state.past.length === 0) return null;
    const previous = state.past[state.past.length - 1];
    set({
      past: state.past.slice(0, -1),
      future: [current, ...state.future],
    });
    return previous;
  },

  redo: (current) => {
    const state = get();
    if (state.future.length === 0) return null;
    const next = state.future[0];
    set({
      past: [...state.past, current],
      future: state.future.slice(1),
    });
    return next;
  },

  clearHistory: () => set({ past: [], future: [] }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
