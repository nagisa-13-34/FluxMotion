import { create } from 'zustand';
import type { Layer, BlendMode } from '../types/layer';
import type { Keyframe, AnimatedProperty } from '../types/keyframe';
import { createDefaultTransform, generateId } from '../types/layer';
import { useHistoryStore } from './historyStore';
import { interpolateValue } from './engine/keyframe';

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

  // -- クリップボード --
  cutLayers: () => void;
  copyLayers: () => void;
  pasteLayers: () => void;
  duplicateSelected: () => void;
  /** 選択レイヤーを指定フレームで分割 */
  splitLayer: (frame: number) => void;
  /** 選択レイヤーを削除 */
  deleteSelected: () => void;

  // -- Undo/Redo --
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

/** クリップボード（モジュールレベル） */
let clipboard: { layers: Layer[]; animations: AnimationMap } | null = null;

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
          letterSpacing: 0,
        },
      } : {}),
      ...(type === 'shape' ? {
        shapeData: {
          shapeType: 'rectangle' as const,
          fill: '#A29BFE',
          fillOpacity: 100,
          stroke: 'transparent',
          strokeWidth: 0,
          strokeLineCap: 'butt' as const,
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
    // アニメーションもコピー
    const newAnims = { ...state.animations };
    if (state.animations[id]) {
      newAnims[newId] = JSON.parse(JSON.stringify(state.animations[id]));
    }
    set({ layers: newLayers, selectedLayerIds: [newId], animations: newAnims });
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

  getAnimatedValue: (layerId, propName, time) => {
    const anim = get().animations[layerId]?.[propName];
    if (!anim || anim.keyframes.length === 0) return undefined;
    const val = interpolateValue(anim, time);
    return val ?? undefined;
  },

  // -- クリップボード --
  copyLayers: () => {
    const { layers, selectedLayerIds, animations } = get();
    const selected = layers.filter((l) => selectedLayerIds.includes(l.id));
    if (selected.length === 0) return;
    const animSnap: AnimationMap = {};
    for (const l of selected) {
      if (animations[l.id]) animSnap[l.id] = JSON.parse(JSON.stringify(animations[l.id]));
    }
    clipboard = { layers: JSON.parse(JSON.stringify(selected)), animations: animSnap };
  },

  cutLayers: () => {
    get().copyLayers();
    get().saveSnapshot();
    const { selectedLayerIds } = get();
    set((s) => ({
      layers: s.layers.filter((l) => !selectedLayerIds.includes(l.id)),
      selectedLayerIds: [],
    }));
  },

  pasteLayers: () => {
    if (!clipboard) return;
    get().saveSnapshot();
    const newLayers: Layer[] = [];
    const newAnims: AnimationMap = {};
    const idMap: Record<string, string> = {};
    for (const l of clipboard.layers) {
      const newId = generateId();
      idMap[l.id] = newId;
      newLayers.push({ ...JSON.parse(JSON.stringify(l)), id: newId, name: `${l.name}` });
      if (clipboard.animations[l.id]) {
        newAnims[newId] = JSON.parse(JSON.stringify(clipboard.animations[l.id]));
      }
    }
    set((s) => ({
      layers: [...newLayers, ...s.layers],
      animations: { ...s.animations, ...newAnims },
      selectedLayerIds: newLayers.map((l) => l.id),
    }));
  },

  duplicateSelected: () => {
    const { selectedLayerIds } = get();
    get().saveSnapshot();
    for (const id of selectedLayerIds) {
      get().duplicateLayer(id);
    }
  },

  splitLayer: (frame) => {
    const { layers, selectedLayerIds, animations } = get();
    if (selectedLayerIds.length === 0) return;
    get().saveSnapshot();
    const newLayers = [...layers];
    const newAnims = { ...animations };
    const newSelected: string[] = [];

    for (const id of selectedLayerIds) {
      const idx = newLayers.findIndex((l) => l.id === id);
      if (idx < 0) continue;
      const layer = newLayers[idx];
      // 分割ポイントがレイヤー範囲外なら無視
      if (frame <= layer.inPoint || frame >= layer.outPoint) {
        newSelected.push(id);
        continue;
      }
      // 前半: 元レイヤーのoutPointを分割フレームに
      const front = { ...layer, outPoint: frame };
      // 後半: 新レイヤー
      const backId = generateId();
      const back: Layer = {
        ...JSON.parse(JSON.stringify(layer)),
        id: backId,
        name: `${layer.name} (後半)`,
        inPoint: frame,
      };
      newLayers[idx] = front;
      newLayers.splice(idx + 1, 0, back);
      // アニメーションもコピー
      if (animations[id]) {
        newAnims[backId] = JSON.parse(JSON.stringify(animations[id]));
      }
      newSelected.push(id, backId);
    }
    set({ layers: newLayers, animations: newAnims, selectedLayerIds: newSelected });
  },

  deleteSelected: () => {
    const { selectedLayerIds } = get();
    if (selectedLayerIds.length === 0) return;
    get().saveSnapshot();
    set((s) => ({
      layers: s.layers.filter((l) => !selectedLayerIds.includes(l.id)),
      selectedLayerIds: [],
    }));
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
