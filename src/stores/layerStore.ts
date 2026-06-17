import { create } from 'zustand';
import type { Layer, BlendMode } from '../types/layer';
import type { Keyframe, AnimatedProperty } from '../types/keyframe';
import { createDefaultTransform, generateId } from '../types/layer';
import { useHistoryStore } from './historyStore';
import { useProjectStore } from './projectStore';
import { interpolateValue } from './engine/keyframe';

/** レイヤーごとのアニメーションデータ */
type AnimationMap = Record<string, Record<string, AnimatedProperty>>;

/** プリコンポナビゲーションのスタックエントリ */
interface CompStackEntry {
  /** プリコンポレイヤーのID */
  precompLayerId: string;
  /** プリコンポレイヤーの名前 */
  precompName: string;
  /** プリコンポのpositionオフセット（入る時に絶対座標に変換するため） */
  precompOffset: [number, number];
  /** 保存されたルートレイヤー */
  savedLayers: Layer[];
  /** 保存された選択 */
  savedSelectedIds: string[];
  /** 保存されたアニメーション */
  savedAnimations: AnimationMap;
}

interface LayerState {
  /** レイヤー一覧（上が前面） */
  layers: Layer[];
  /** 選択中のレイヤーID */
  selectedLayerIds: string[];
  /** アニメーションデータ */
  animations: AnimationMap;
  /** クリップボード（コピー／ペースト用） */
  clipboard: { layers: Layer[]; animations: AnimationMap } | null;
  /** プリコンポナビゲーションスタック */
  compStack: CompStackEntry[];

  // -- レイヤー操作 --
  addLayer: (type: Layer['type'], options?: Partial<Layer>) => string;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorderLayer: (fromIndex: number, toIndex: number) => void;
  selectLayer: (id: string, multi?: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;

  // -- プロパティ更新 --
  updateLayer: (id: string, partial: Partial<Layer>) => void;
  updateTransform: (id: string, prop: string, value: number | [number, number] | Record<string, number> | undefined) => void;
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleSolo: (id: string) => void;
  setBlendMode: (id: string, mode: BlendMode) => void;

  // -- エクスプレッション --
  setExpression: (layerId: string, propName: string, expr: string) => void;
  removeExpression: (layerId: string, propName: string) => void;

  // -- 親子関係ユーティリティ --
  /** 指定レイヤーの祖先IDチェーン（循環参照検出用） */
  getAncestorIds: (layerId: string) => string[];
  /** 指定レイヤーを親に設定可能か（循環参照チェック） */
  canSetParent: (childId: string, parentId: string) => boolean;

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
  /** 選択レイヤーをヌルレイヤーの子にまとめる（プリコンポジション） */
  precompose: () => void;
  /** ラベルカラーを設定 */
  setLabelColor: (id: string, color: string) => void;

  // -- プリコンポナビゲーション --
  /** プリコンポの中に入る */
  enterPrecomp: (layerId: string) => void;
  /** プリコンポから出る（1段階戻る） */
  exitPrecomp: () => void;
  /** ルートに直接戻る */
  exitToRoot: () => void;
  /** 現在のコンポ名（ルートの場合はnull） */
  activeCompName: string | null;

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
    precomp: 'プリコンポ',
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
    precomp: '#0984E3',
  };
  return colors[type] || '#636E72';
}

/** レイヤーのディープクローン（precompLayers内のIDも再生成） */
function deepCloneLayer(layer: Layer): Layer {
  const cloned = structuredClone(layer);
  // precompLayersがある場合、内部レイヤーのIDも再生成
  if (cloned.precompLayers) {
    const idMap: Record<string, string> = {};
    cloned.precompLayers = cloned.precompLayers.map(inner => {
      const newInnerId = generateId();
      idMap[inner.id] = newInnerId;
      return { ...inner, id: newInnerId };
    });
    // 内部の親子関係も更新
    cloned.precompLayers = cloned.precompLayers.map(inner => ({
      ...inner,
      parentId: inner.parentId && idMap[inner.parentId] ? idMap[inner.parentId] : inner.parentId,
    }));
  }
  return cloned;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  layers: [],
  selectedLayerIds: [],
  animations: {},
  clipboard: null,
  compStack: [],
  activeCompName: null,

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
      transform: {
        ...createDefaultTransform(),
        position: [
          Math.round(useProjectStore.getState().settings.width / 2),
          Math.round(useProjectStore.getState().settings.height / 2),
        ] as [number, number],
      },
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
    set((s) => {
      let insertIndex = 0; // デフォルトは先頭（最前面）
      if (s.selectedLayerIds.length > 0) {
        const topSelectedId = s.selectedLayerIds[0];
        const idx = s.layers.findIndex((l) => l.id === topSelectedId);
        if (idx !== -1) insertIndex = idx;
      }
      const newLayers = [...s.layers];
      newLayers.splice(insertIndex, 0, newLayer);
      
      return {
        layers: newLayers,
        selectedLayerIds: [id],
      };
    });
    return id;
  },

  removeLayer: (id) => {
    const layer = get().layers.find((l) => l.id === id);
    // ObjectURL のメモリリーク防止
    if (layer?.mediaSource?.startsWith('blob:')) {
      URL.revokeObjectURL(layer.mediaSource);
    }
    set((s) => {
      const { [id]: _, ...restAnimations } = s.animations;
      return {
        // 親レイヤー削除時、子レイヤーのparentIdをnullにリセット
        layers: s.layers
          .filter((l) => l.id !== id)
          .map((l) => l.parentId === id ? { ...l, parentId: null } : l),
        selectedLayerIds: s.selectedLayerIds.filter((sid) => sid !== id),
        animations: restAnimations,
      };
    });
  },

  duplicateLayer: (id) => {
    const state = get();
    const original = state.layers.find((l) => l.id === id);
    if (!original) return;
    const newId = generateId();
    const clone: Layer = {
      ...deepCloneLayer(original),
      id: newId,
      name: `${original.name} コピー`,
    };
    const idx = state.layers.findIndex((l) => l.id === id);
    const newLayers = [...state.layers];
    newLayers.splice(idx, 0, clone);
    // アニメーションもコピー
    const newAnims = { ...state.animations };
    if (state.animations[id]) {
      newAnims[newId] = structuredClone(state.animations[id]);
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

  selectAll: () => set((s) => ({ selectedLayerIds: s.layers.map(l => l.id) })),

  updateLayer: (id, partial) =>
    set((s) => {
      // parentId変更時の循環参照チェック
      if (partial.parentId !== undefined && partial.parentId !== null) {
        if (!get().canSetParent(id, partial.parentId)) {
          console.warn('[LayerStore] 循環参照を検出: parentId設定をキャンセル');
          const { parentId: _, ...rest } = partial;
          if (Object.keys(rest).length === 0) return s;
          return {
            layers: s.layers.map((l) =>
              l.id === id ? { ...l, ...rest } : l
            ),
          };
        }
      }

      // parentId変更時: 子のpositionを親のローカル座標系に変換（見た目の位置を維持するAE挙動）
      if (partial.parentId !== undefined) {
        const child = s.layers.find((l) => l.id === id);
        if (child) {
          const oldParentId = child.parentId;
          const newParentId = partial.parentId;

          // まず現在のワールド座標を計算（旧親がある場合）
          let worldPos: [number, number] = [...child.transform.position];
          if (oldParentId) {
            const oldParent = s.layers.find((l) => l.id === oldParentId);
            if (oldParent) {
              const pRad = (oldParent.transform.rotation * Math.PI) / 180;
              const pSx = oldParent.transform.scale[0] / 100;
              const pSy = oldParent.transform.scale[1] / 100;
              const dx = worldPos[0] - oldParent.transform.anchorPoint[0];
              const dy = worldPos[1] - oldParent.transform.anchorPoint[1];
              const cos = Math.cos(pRad);
              const sin = Math.sin(pRad);
              worldPos = [
                oldParent.transform.position[0] + (dx * pSx * cos - dy * pSy * sin),
                oldParent.transform.position[1] + (dx * pSx * sin + dy * pSy * cos),
              ];
            }
          }

          // 新しい親のローカル座標系に変換
          if (newParentId) {
            const newParent = s.layers.find((l) => l.id === newParentId);
            if (newParent) {
              const pRad = (newParent.transform.rotation * Math.PI) / 180;
              const pSx = newParent.transform.scale[0] / 100;
              const pSy = newParent.transform.scale[1] / 100;
              const cos = Math.cos(pRad);
              const sin = Math.sin(pRad);
              // ワールド座標から親基準のオフセットを逆算
              const relX = worldPos[0] - newParent.transform.position[0];
              const relY = worldPos[1] - newParent.transform.position[1];
              // 回転の逆変換 + スケールの逆変換
              const localDx = pSx !== 0 ? (relX * cos + relY * sin) / pSx : 0;
              const localDy = pSy !== 0 ? (-relX * sin + relY * cos) / pSy : 0;
              const newPos: [number, number] = [
                newParent.transform.anchorPoint[0] + localDx,
                newParent.transform.anchorPoint[1] + localDy,
              ];
              partial = { ...partial, transform: { ...child.transform, position: newPos } };
            }
          } else {
            // 親を解除: ワールド座標をそのままpositionに
            if (oldParentId) {
              partial = { ...partial, transform: { ...child.transform, position: worldPos } };
            }
          }
        }
      }

      return {
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, ...partial } : l
        ),
      };
    }),

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

  // -- エクスプレッション --
  setExpression: (layerId, propName, expr) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId
          ? { ...l, expressions: { ...(l.expressions || {}), [propName]: expr } }
          : l
      ),
    })),

  removeExpression: (layerId, propName) =>
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId || !l.expressions) return l;
        const { [propName]: _, ...rest } = l.expressions;
        return { ...l, expressions: Object.keys(rest).length > 0 ? rest : undefined };
      }),
    })),

  // -- 親子関係ユーティリティ --
  getAncestorIds: (layerId) => {
    const { layers } = get();
    const ancestors: string[] = [];
    let current = layers.find(l => l.id === layerId);
    const visited = new Set<string>();
    while (current?.parentId) {
      if (visited.has(current.parentId)) break; // 循環ガード
      visited.add(current.parentId);
      ancestors.push(current.parentId);
      current = layers.find(l => l.id === current!.parentId);
    }
    return ancestors;
  },

  canSetParent: (childId, parentId) => {
    if (childId === parentId) return false; // 自分自身
    // parentIdの祖先にchildIdが含まれていないかチェック
    const { layers } = get();
    let current = layers.find(l => l.id === parentId);
    const visited = new Set<string>([childId]);
    while (current) {
      if (visited.has(current.id)) return false;
      visited.add(current.id);
      if (!current.parentId) break;
      current = layers.find(l => l.id === current!.parentId);
    }
    return true;
  },

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
        ...deepCloneLayer(layer),
        id: backId,
        name: `${layer.name} (後半)`,
        inPoint: frame,
      };
      newLayers[idx] = front;
      newLayers.splice(idx + 1, 0, back);
      // アニメーションもコピー
      if (animations[id]) {
        newAnims[backId] = structuredClone(animations[id]);
      }
      newSelected.push(id, backId);
    }
    set({ layers: newLayers, animations: newAnims, selectedLayerIds: newSelected });
  },

  deleteSelected: () => {
    const { selectedLayerIds, layers } = get();
    if (selectedLayerIds.length === 0) return;
    get().saveSnapshot();
    // ObjectURL のメモリリーク防止
    for (const id of selectedLayerIds) {
      const layer = layers.find((l) => l.id === id);
      if (layer?.mediaSource?.startsWith('blob:')) {
        URL.revokeObjectURL(layer.mediaSource);
      }
    }
    set((s) => {
      const cleanedAnimations = { ...s.animations };
      for (const id of selectedLayerIds) {
        delete cleanedAnimations[id];
      }
      return {
        layers: s.layers
          .filter((l) => !selectedLayerIds.includes(l.id))
          .map((l) =>
            // 削除されるレイヤーを親に持つ子のparentIdをリセット
            l.parentId && selectedLayerIds.includes(l.parentId)
              ? { ...l, parentId: null }
              : l
          ),
        selectedLayerIds: [],
        animations: cleanedAnimations,
      };
    });
  },

  // -- クリップボード --
  copyLayers: () => {
    const { selectedLayerIds, layers, animations } = get();
    if (selectedLayerIds.length === 0) return;
    const copied = layers.filter(l => selectedLayerIds.includes(l.id));
    const copiedAnims: Record<string, Record<string, AnimatedProperty>> = {};
    for (const id of selectedLayerIds) {
      if (animations[id]) copiedAnims[id] = structuredClone(animations[id]);
    }
    set({
      clipboard: {
        layers: structuredClone(copied),
        animations: copiedAnims,
      },
    });
  },

  cutLayers: () => {
    get().copyLayers();
    get().deleteSelected();
  },

  pasteLayers: () => {
    const { clipboard } = get();
    if (!clipboard || clipboard.layers.length === 0) return;
    get().saveSnapshot();
    const newIds: string[] = [];
    const idMap: Record<string, string> = {};

    // IDを再生成してペースト
    const pastedLayers = clipboard.layers.map(l => {
      const newId = generateId();
      idMap[l.id] = newId;
      newIds.push(newId);
      return {
        ...l,
        id: newId,
        name: `${l.name} コピー`,
      };
    });

    // 親子関係のIDを更新
    for (const layer of pastedLayers) {
      if (layer.parentId && idMap[layer.parentId]) {
        layer.parentId = idMap[layer.parentId];
      } else if (layer.parentId) {
        // コピー元の親がペースト対象外ならnullにリセット
        layer.parentId = null;
      }
      // 念のため循環参照チェック
      if (layer.parentId && !get().canSetParent(layer.id, layer.parentId)) {
        layer.parentId = null;
      }
    }

    // アニメーションもIDを更新してコピー
    const newAnims = { ...get().animations };
    for (const [oldId, anim] of Object.entries(clipboard.animations)) {
      if (idMap[oldId]) {
        newAnims[idMap[oldId]] = structuredClone(anim);
      }
    }

    set((s) => ({
      layers: [...pastedLayers, ...s.layers],
      animations: newAnims,
      selectedLayerIds: newIds,
    }));
  },

  duplicateSelected: () => {
    get().copyLayers();
    get().pasteLayers();
  },

  // -- Undo/Redo --
  saveSnapshot: () => {
    const state = get();
    useHistoryStore.getState().pushSnapshot({
      layers: structuredClone(state.layers),
      animations: structuredClone(state.animations),
      compStack: structuredClone(state.compStack),
      activeCompName: state.activeCompName,
    });
  },

  undo: () => {
    const state = get();
    const snapshot = useHistoryStore.getState().undo({
      layers: structuredClone(state.layers),
      animations: structuredClone(state.animations),
      compStack: structuredClone(state.compStack),
      activeCompName: state.activeCompName,
    });
    if (snapshot) {
      set({ 
        layers: snapshot.layers, 
        animations: snapshot.animations,
        compStack: snapshot.compStack || [],
        activeCompName: snapshot.activeCompName || null,
      });
    }
  },

  redo: () => {
    const state = get();
    const snapshot = useHistoryStore.getState().redo({
      layers: structuredClone(state.layers),
      animations: structuredClone(state.animations),
      compStack: structuredClone(state.compStack),
      activeCompName: state.activeCompName,
    });
    if (snapshot) {
      set({ 
        layers: snapshot.layers, 
        animations: snapshot.animations,
        compStack: snapshot.compStack || [],
        activeCompName: snapshot.activeCompName || null,
      });
    }
  },

  precompose: () => {
    const state = get();
    const selectedIds = state.selectedLayerIds;
    if (selectedIds.length === 0) return;

    get().saveSnapshot();

    // 選択レイヤーを取得（レイヤーリストの順序を維持）
    const selectedLayers = state.layers.filter(l => selectedIds.includes(l.id));
    if (selectedLayers.length === 0) return;

    // 選択レイヤーの中央位置を計算
    const avgX = selectedLayers.reduce((sum, l) => sum + l.transform.position[0], 0) / selectedLayers.length;
    const avgY = selectedLayers.reduce((sum, l) => sum + l.transform.position[1], 0) / selectedLayers.length;

    // プリコンポ内のレイヤー: positionをプリコンポの中心からの相対座標に変換
    const innerLayers: Layer[] = selectedLayers.map(l => {
      const cloned = structuredClone(l);
      // 親がプリコンポ内のレイヤーでない場合はparentIdをリセット
      if (cloned.parentId && !selectedIds.includes(cloned.parentId)) {
        cloned.parentId = null;
      }
      // positionをプリコンポのanchorPoint（=中心）基準の相対座標に変換
      // プリコンポのanchorPointはデフォルト[0,0]なので、
      // 内部レイヤーのpositionは (元のpos - プリコンポのpos) + anchorPoint(0,0) となる
      cloned.transform = {
        ...cloned.transform,
        position: [
          cloned.transform.position[0] - Math.round(avgX),
          cloned.transform.position[1] - Math.round(avgY),
        ] as [number, number],
      };
      return cloned;
    });

    // プリコンポレイヤーを作成
    const precompId = generateId();
    const precompLayer: Layer = {
      id: precompId,
      name: `プリコンポ ${state.layers.filter(l => l.type === 'precomp').length + 1}`,
      type: 'precomp',
      visible: true,
      locked: false,
      solo: false,
      inPoint: Math.min(...selectedLayers.map(l => l.inPoint)),
      outPoint: Math.max(...selectedLayers.map(l => l.outPoint)),
      transform: { ...createDefaultTransform(), position: [Math.round(avgX), Math.round(avgY)] },
      blendMode: 'normal',
      parentId: null,
      precompLayers: innerLayers,
    };

    // 選択レイヤーのアニメーションを元のanimationsから削除
    const cleanedAnimations = { ...state.animations };
    for (const id of selectedIds) {
      delete cleanedAnimations[id];
    }

    // 元のレイヤーリストから選択レイヤーを除去し、プリコンプレイヤーで置換
    const firstSelectedIdx = state.layers.findIndex(l => selectedIds.includes(l.id));
    const remainingLayers = state.layers.filter(l => !selectedIds.includes(l.id));
    // 選択レイヤーを親に持つ子のparentIdをリセット
    const updatedLayers = remainingLayers.map(l =>
      l.parentId && selectedIds.includes(l.parentId) ? { ...l, parentId: null } : l
    );

    // プリコンポレイヤーを元の最初の選択レイヤーの位置に挿入
    const insertIdx = Math.min(firstSelectedIdx, updatedLayers.length);
    const newLayers = [...updatedLayers];
    newLayers.splice(insertIdx, 0, precompLayer);

    set({ layers: newLayers, selectedLayerIds: [precompId], animations: cleanedAnimations });
  },

  setLabelColor: (id, color) => {
    set((s) => ({
      layers: s.layers.map(l => l.id === id ? { ...l, labelColor: color } : l),
    }));
  },

  // -- プリコンポナビゲーション --
  enterPrecomp: (layerId) => {
    const state = get();
    const precompLayer = state.layers.find(l => l.id === layerId);
    if (!precompLayer || precompLayer.type !== 'precomp' || !precompLayer.precompLayers) return;

    // プリコンポのpositionオフセットを保存
    const offsetX = precompLayer.transform.position[0];
    const offsetY = precompLayer.transform.position[1];

    // 内部レイヤーのpositionを絶対座標に変換（相対座標 + プリコンポ位置）
    const absoluteLayers = structuredClone(precompLayer.precompLayers).map((l: Layer) => ({
      ...l,
      transform: {
        ...l.transform,
        position: [
          l.transform.position[0] + offsetX,
          l.transform.position[1] + offsetY,
        ] as [number, number],
      },
    }));

    // アニメーションのposition KF値も絶対座標に変換
    const offsetAnimations = structuredClone(state.animations);
    for (const innerLayer of absoluteLayers) {
      const layerAnim = offsetAnimations[innerLayer.id];
      if (!layerAnim) continue;
      // 統合 position KF
      if (layerAnim['position']?.keyframes.length) {
        layerAnim['position'].keyframes = layerAnim['position'].keyframes.map(kf => ({
          ...kf,
          value: Array.isArray(kf.value)
            ? [kf.value[0] + offsetX, kf.value[1] + offsetY]
            : kf.value,
        }));
      }
      // 分割 position.x / position.y KF
      if (layerAnim['position.x']?.keyframes.length) {
        layerAnim['position.x'].keyframes = layerAnim['position.x'].keyframes.map(kf => ({
          ...kf,
          value: typeof kf.value === 'number' ? kf.value + offsetX : kf.value,
        }));
      }
      if (layerAnim['position.y']?.keyframes.length) {
        layerAnim['position.y'].keyframes = layerAnim['position.y'].keyframes.map(kf => ({
          ...kf,
          value: typeof kf.value === 'number' ? kf.value + offsetY : kf.value,
        }));
      }
    }

    const entry: CompStackEntry = {
      precompLayerId: layerId,
      precompName: precompLayer.name,
      precompOffset: [offsetX, offsetY],
      savedLayers: structuredClone(state.layers),
      savedSelectedIds: [...state.selectedLayerIds],
      savedAnimations: structuredClone(state.animations),
    };

    set({
      compStack: [...state.compStack, entry],
      layers: absoluteLayers,
      animations: offsetAnimations,
      selectedLayerIds: [],
      activeCompName: precompLayer.name,
    });
  },

  exitPrecomp: () => {
    const state = get();
    if (state.compStack.length === 0) return;

    const entry = state.compStack[state.compStack.length - 1];
    const newStack = state.compStack.slice(0, -1);
    const [offX, offY] = entry.precompOffset;

    // 現在のレイヤーのpositionを相対座標に戻す（絶対座標 - プリコンポ位置）
    const relativeLayers = state.layers.map(l => ({
      ...l,
      transform: {
        ...l.transform,
        position: [
          l.transform.position[0] - offX,
          l.transform.position[1] - offY,
        ] as [number, number],
      },
    }));

    // アニメーションのposition KF値も相対座標に逆変換
    const restoredAnimations = structuredClone(entry.savedAnimations);
    // 内部レイヤーの変更されたアニメーションを保持（position KFは逆変換して保存）
    for (const innerLayer of state.layers) {
      const layerAnim = state.animations[innerLayer.id];
      if (!layerAnim) continue;
      const clonedAnim = structuredClone(layerAnim);
      // position KF値を逆変換
      if (clonedAnim['position']?.keyframes.length) {
        clonedAnim['position'].keyframes = clonedAnim['position'].keyframes.map(kf => ({
          ...kf,
          value: Array.isArray(kf.value)
            ? [kf.value[0] - offX, kf.value[1] - offY]
            : kf.value,
        }));
      }
      if (clonedAnim['position.x']?.keyframes.length) {
        clonedAnim['position.x'].keyframes = clonedAnim['position.x'].keyframes.map(kf => ({
          ...kf,
          value: typeof kf.value === 'number' ? kf.value - offX : kf.value,
        }));
      }
      if (clonedAnim['position.y']?.keyframes.length) {
        clonedAnim['position.y'].keyframes = clonedAnim['position.y'].keyframes.map(kf => ({
          ...kf,
          value: typeof kf.value === 'number' ? kf.value - offY : kf.value,
        }));
      }
      restoredAnimations[innerLayer.id] = clonedAnim;
    }

    // プリコンポの内部レイヤーを更新
    const updatedLayers = entry.savedLayers.map(l => {
      if (l.id === entry.precompLayerId) {
        return { ...l, precompLayers: relativeLayers };
      }
      return l;
    });

    set({
      compStack: newStack,
      layers: updatedLayers,
      selectedLayerIds: entry.savedSelectedIds,
      animations: restoredAnimations,
      activeCompName: newStack.length > 0 ? newStack[newStack.length - 1].precompName : null,
    });
  },

  exitToRoot: () => {
    const state = get();
    if (state.compStack.length === 0) return;

    // 最後のエントリから順にレイヤーを復元（position変換付き）
    let currentLayers = structuredClone(state.layers) as Layer[];
    let currentAnimations = structuredClone(state.animations);
    let rootLayers: Layer[] = [];
    let rootSelected: string[] = [];
    let rootAnimations: AnimationMap = {};

    for (let i = state.compStack.length - 1; i >= 0; i--) {
      const entry = state.compStack[i];
      const [offX, offY] = entry.precompOffset;

      // 絶対座標→相対座標に変換
      const relativeLayers = currentLayers.map(l => ({
        ...l,
        transform: {
          ...l.transform,
          position: [
            l.transform.position[0] - offX,
            l.transform.position[1] - offY,
          ] as [number, number],
        },
      }));

      // アニメーションのposition KF値も相対座標に逆変換
      const restoredAnimations = structuredClone(entry.savedAnimations);
      for (const innerLayer of currentLayers) {
        const layerAnim = currentAnimations[innerLayer.id];
        if (!layerAnim) continue;
        const clonedAnim = structuredClone(layerAnim);
        if (clonedAnim['position']?.keyframes.length) {
          clonedAnim['position'].keyframes = clonedAnim['position'].keyframes.map(kf => ({
            ...kf,
            value: Array.isArray(kf.value)
              ? [kf.value[0] - offX, kf.value[1] - offY]
              : kf.value,
          }));
        }
        if (clonedAnim['position.x']?.keyframes.length) {
          clonedAnim['position.x'].keyframes = clonedAnim['position.x'].keyframes.map(kf => ({
            ...kf,
            value: typeof kf.value === 'number' ? kf.value - offX : kf.value,
          }));
        }
        if (clonedAnim['position.y']?.keyframes.length) {
          clonedAnim['position.y'].keyframes = clonedAnim['position.y'].keyframes.map(kf => ({
            ...kf,
            value: typeof kf.value === 'number' ? kf.value - offY : kf.value,
          }));
        }
        restoredAnimations[innerLayer.id] = clonedAnim;
      }

      const updatedLayers = entry.savedLayers.map(l => {
        if (l.id === entry.precompLayerId) {
          return { ...l, precompLayers: relativeLayers };
        }
        return l;
      });
      currentLayers = updatedLayers;
      currentAnimations = restoredAnimations;
      if (i === 0) {
        rootLayers = updatedLayers;
        rootSelected = entry.savedSelectedIds;
        rootAnimations = restoredAnimations;
      }
    }

    set({
      compStack: [],
      layers: rootLayers,
      selectedLayerIds: rootSelected,
      animations: rootAnimations,
      activeCompName: null,
    });
  },
}));

export { getLayerColor };
