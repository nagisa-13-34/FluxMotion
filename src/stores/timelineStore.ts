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

  /** ワークエリア開始フレーム（null = 未設定） */
  workAreaIn: number | null;
  /** ワークエリア終了フレーム（null = 未設定） */
  workAreaOut: number | null;

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

  /** ワークエリアIn点を現在フレームに設定 */
  setWorkAreaIn: () => void;
  /** ワークエリアOut点を現在フレームに設定 */
  setWorkAreaOut: () => void;
  /** ワークエリアをクリア */
  clearWorkArea: () => void;
  /** ワークエリアを直接設定（ドラッグ用） */
  setWorkArea: (inFrame: number | null, outFrame: number | null) => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  currentFrame: 0,
  isPlaying: false,
  zoom: 8,
  scrollFrame: 0,
  workAreaIn: null,
  workAreaOut: null,

  setCurrentFrame: (frame) =>
    set({ currentFrame: Math.max(0, Math.round(frame)) }),

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  goToStart: () => {
    const waIn = get().workAreaIn;
    set({ currentFrame: waIn !== null ? waIn : 0 });
  },
  goToEnd: (totalFrames) => {
    const waOut = get().workAreaOut;
    set({ currentFrame: waOut !== null ? waOut : totalFrames });
  },

  stepForward: () =>
    set((s) => ({ currentFrame: Math.min(s.currentFrame + 1, 999999) })),
  stepBackward: () =>
    set((s) => ({ currentFrame: Math.max(0, s.currentFrame - 1) })),

  setZoom: (zoom) =>
    set({ zoom: Math.max(0.1, zoom) }),
  setScrollFrame: (frame) =>
    set({ scrollFrame: Math.max(0, frame) }),

  setWorkAreaIn: () => set((s) => {
    const frame = s.currentFrame;
    // Out点が設定済みの場合、Out点より後には設定不可
    if (s.workAreaOut !== null && frame > s.workAreaOut) {
      return { workAreaIn: s.workAreaOut };
    }
    return { workAreaIn: frame };
  }),
  setWorkAreaOut: () => set((s) => {
    const frame = s.currentFrame;
    // In点が設定済みの場合、In点より前には設定不可
    if (s.workAreaIn !== null && frame < s.workAreaIn) {
      return { workAreaOut: s.workAreaIn };
    }
    return { workAreaOut: frame };
  }),
  clearWorkArea: () => set({ workAreaIn: null, workAreaOut: null }),
  setWorkArea: (inFrame, outFrame) => {
    // 両方nullの場合はそのまま
    if (inFrame === null || outFrame === null) {
      set({ workAreaIn: inFrame, workAreaOut: outFrame });
      return;
    }
    // In > Out の場合はスワップ
    if (inFrame > outFrame) {
      set({ workAreaIn: outFrame, workAreaOut: inFrame });
    } else {
      set({ workAreaIn: inFrame, workAreaOut: outFrame });
    }
  },
}));

