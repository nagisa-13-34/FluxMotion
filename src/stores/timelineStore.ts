import { create } from 'zustand';

interface TimelineState {
  /** 現在のフレーム */
  currentFrame: number;
  /** 再生中かどうか */
  isPlaying: boolean;
  /** ズーム（px/frame） */
  zoom: number;
  /** 左スクロール位置（フレーム） */
  scrollFrame: number;

  setCurrentFrame: (frame: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  goToStart: () => void;
  goToEnd: (totalFrames: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  setZoom: (zoom: number) => void;
  setScrollFrame: (frame: number) => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  currentFrame: 0,
  isPlaying: false,
  zoom: 8,
  scrollFrame: 0,

  setCurrentFrame: (frame) =>
    set({ currentFrame: Math.max(0, Math.round(frame)) }),

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  goToStart: () => set({ currentFrame: 0 }),
  goToEnd: (totalFrames) => set({ currentFrame: totalFrames }),

  stepForward: () =>
    set((s) => ({ currentFrame: s.currentFrame + 1 })),
  stepBackward: () =>
    set((s) => ({ currentFrame: Math.max(0, s.currentFrame - 1) })),

  setZoom: (zoom) =>
    set({ zoom: Math.max(1, Math.min(30, zoom)) }),
  setScrollFrame: (frame) =>
    set({ scrollFrame: Math.max(0, frame) }),
}));
