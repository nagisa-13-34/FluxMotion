import { create } from 'zustand';
import type { Layer, BlendMode } from '../types/layer';
import type { Keyframe, AnimatedProperty } from '../types/keyframe';
import { createDefaultTransform, generateId } from '../types/layer';
import { useHistoryStore } from './historyStore';

/** レイヤーごとのアニメーションデータ */
type AnimationMap = Record<string, Record<string, AnimatedProperty>>;

interface LayerState {
  /** レイヤー一覧（上が前面） */
  layers: Layer[];
  /** 選択中のレイヤーID */
  selectedLayerIds: string[];
  /** アニメーションデータ */
  animations: AnimationMap;

  // -- レイヤー操作 --
  addLayer: (type: Layer['type'], options?: Partial<Layer>) => string;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayer: (fromIndex: number, toIndex: number) => void;
  selectLayer: (id: string, multi?: boolean) => void;
  deselectAll: () => void;

  // -- プロパティ更新 --
  updateLayer: (id: string, partial: Partial<Layer>) => void;
  updateTransform: (id: string, prop: string, value: number | [number, number]) => void;
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleSolo: (id: string) => void;
  setBlendMode: (id: string, mode: BlendMode) => void;

  // -- キーフレーム --
  addKeyframe: (layerId: string, propName: string, keyframe: Keyframe) => void;
  removeKeyframe: (layerId: string, propName: string, time: number) => void;
  getAnimatedValue: (layerId: string, propName: string, time: number) => number | number[] | undefined;

  // -- Undo/Redo --
  /** 現在の状態をスナップショットに記録 */
  saveSnapshot: () => void;
  undo: () => void;
  redo: () => void;
}

/** レイヤータイプに応じたデフォルト名を生成 */
function getLayerName(type: Layer['type'], index: number): string {
  const names: Record<string, string> = {
    solid: 'ソリッド',
    text: 'テキスト',
    image: '画像',
    video: '動画',
    shape: 'シェイプ',
    adjustment: '調整',
    null: 'ヌル',
  };
  return `${names[type] || type} ${index + 1}`;
}

/** レイヤータイプに応じたデフォルト色 */
function getLayerColor(type: Layer['type']): string {
  const colors: Record<string, string> = {
    solid: '#6C5CE7',
    text: '#00CEC9',
    image: '#FDCB6E',
    video: '#E17055',
    shape: '#A29BFE',
    adjustment: '#FD79A8',
    null: '#636E72',
  };
  return colors[type] || '#636E72';
}

export const useLayerStore = create<LayerState>((set, get) => ({
  layers: [],
  selectedLayerIds: [],
  animations: {},

  addLayer: (type, options = {}) => {
    const id = generateId();
    const state = get();
    const newLayer: Layer = {
      id,
      name: getLayerName(type, state.layers.length),
      type,
      visible: true,
      locked: false,
      solo: false,
      inPoint: 0,
      outPoint: 300, // 10秒 × 30fps
      transform: createDefaultTransform(),
      blendMode: 'normal',
      parentId: null,
      ...(type === 'solid' ? { solidColor: options.solidColor || '#6C5CE7' } : {}),
      ...(type === 'text' ? {
        textStyle: {
          text: 'テキスト',
          fontFamily: 'Inter',
          fontSize: 48,
          fontWeight: 400,
          color: '#FFFFFF',
          textAlign: 'center' as const,
          lineHeight: 1.2,
        },
      } : {}),
      ...(type === 'shape' ? {
        shapeData: {
          shapeType: 'rectangle' as const,
          fill: '#A29BFE',
          stroke: 'transparent',
          strokeWidth: 0,
          cornerRadius: 0,
        },
      } : {}),
      ...options,
    };
    set((s) => ({
      layers: [newLayer, ...s.layers],
      selectedLayerIds: [id],
    }));
    return id;
  },

  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      selectedLayerIds: s.selectedLayerIds.filter((sid) => sid !== id),
    })),

  duplicateLayer: (id) => {
    const state = get();
    const original = state.layers.find((l) => l.id === id);
    if (!original) return;
    const newId = generateId();
    const clone: Layer = {
      ...JSON.parse(JSON.stringify(original)),
      id: newId,
      name: `${original.name} コピー`,
    };
    const idx = state.layers.findIndex((l) => l.id === id);
    const newLayers = [...state.layers];
    newLayers.splice(idx, 0, clone);
    set({ layers: newLayers, selectedLayerIds: [newId] });
  },

  reorderLayer: (fromIndex, toIndex) =>
    set((s) => {
      const newLayers = [...s.layers];
      const [moved] = newLayers.splice(fromIndex, 1);
      newLayers.splice(toIndex, 0, moved);
      return { layers: newLayers };
    }),

  selectLayer: (id, multi = false) =>
    set((s) => {
      if (multi) {
        const isSelected = s.selectedLayerIds.includes(id);
        return {
          selectedLayerIds: isSelected
            ? s.selectedLayerIds.filter((sid) => sid !== id)
            : [...s.selectedLayerIds, id],
        };
      }
      return { selectedLayerIds: [id] };
    }),

  deselectAll: () => set({ selectedLayerIds: [] }),

  updateLayer: (id, partial) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, ...partial } : l
      ),
    })),

  updateTransform: (id, prop, value) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id
          ? { ...l, transform: { ...l.transform, [prop]: value } }
          : l
      ),
    })),

  toggleVisibility: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
    })),

  toggleLock: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, locked: !l.locked } : l
      ),
    })),

  toggleSolo: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, solo: !l.solo } : l
      ),
    })),

  setBlendMode: (id, mode) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, blendMode: mode } : l
      ),
    })),

  // -- キーフレーム --
  addKeyframe: (layerId, propName, keyframe) =>
    set((s) => {
      const anim = { ...s.animations };
      if (!anim[layerId]) anim[layerId] = {};
      if (!anim[layerId][propName]) {
        anim[layerId][propName] = { name: propName, keyframes: [] };
      }
      const kfs = [...anim[layerId][propName].keyframes];
      const existingIdx = kfs.findIndex((k) => k.time === keyframe.time);
      if (existingIdx >= 0) {
        kfs[existingIdx] = keyframe;
      } else {
        kfs.push(keyframe);
        kfs.sort((a, b) => a.time - b.time);
      }
      anim[layerId][propName] = { ...anim[layerId][propName], keyframes: kfs };
      return { animations: anim };
    }),

  removeKeyframe: (layerId, propName, time) =>
    set((s) => {
      const anim = { ...s.animations };
      if (!anim[layerId]?.[propName]) return s;
      const kfs = anim[layerId][propName].keyframes.filter((k) => k.time !== time);
      anim[layerId][propName] = { ...anim[layerId][propName], keyframes: kfs };
      return { animations: anim };
    }),

  getAnimatedValue: (layerId, propName, _time) => {
    const anim = get().animations[layerId]?.[propName];
    if (!anim || anim.keyframes.length === 0) return undefined;
    // キーフレーム補間はエンジン側で処理
    return undefined;
  },

  // -- Undo/Redo --
  saveSnapshot: () => {
    const { layers, animations } = get();
    useHistoryStore.getState().pushSnapshot({
      layers: JSON.parse(JSON.stringify(layers)),
      animations: JSON.parse(JSON.stringify(animations)),
    });
  },

  undo: () => {
    const { layers, animations } = get();
    const snapshot = useHistoryStore.getState().undo({
      layers: JSON.parse(JSON.stringify(layers)),
      animations: JSON.parse(JSON.stringify(animations)),
    });
    if (snapshot) {
      set({ layers: snapshot.layers, animations: snapshot.animations });
    }
  },

  redo: () => {
    const { layers, animations } = get();
    const snapshot = useHistoryStore.getState().redo({
      layers: JSON.parse(JSON.stringify(layers)),
      animations: JSON.parse(JSON.stringify(animations)),
    });
    if (snapshot) {
      set({ layers: snapshot.layers, animations: snapshot.animations });
    }
  },
}));

export { getLayerColor };
