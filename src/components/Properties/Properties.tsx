import type React from 'react';
import { useState, useCallback, useRef } from 'react';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useProjectStore } from '../../stores/projectStore';
import type { Keyframe } from '../../types/keyframe';
import { EASING_PRESETS } from '../../types/keyframe';
import { interpolateValue } from '../../stores/engine/keyframe';

/** トランスフォームのプロパティ定義 */
const TRANSFORM_PROPS = [
  { key: 'anchorPoint', label: 'アンカー', type: 'xy' as const },
  { key: 'position', label: '位置', type: 'xy' as const },
  { key: 'scale', label: 'スケール', type: 'xy' as const, suffix: '%' },
  { key: 'rotation', label: '回転', type: 'number' as const, suffix: '°' },
  { key: 'opacity', label: '不透明度', type: 'number' as const, suffix: '%', min: 0, max: 100 },
];

/** セレクトボックスの共通スタイル */
const selectStyle: React.CSSProperties = {
  background: 'var(--color-bg-input)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 4px',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-primary)',
  width: '100%',
};

export function Properties() {
  const layers = useLayerStore((s) => s.layers);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const updateTransform = useLayerStore((s) => s.updateTransform);
  const addKeyframe = useLayerStore((s) => s.addKeyframe);
  const removeKeyframe = useLayerStore((s) => s.removeKeyframe);
  const animations = useLayerStore((s) => s.animations);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    transform: true,
    text: true,
    shape: true,
    layer: true,
  });

  // スケールリンク（比率保持）
  const [scaleLinked, setScaleLinked] = useState(true);

  // 次元分割（0=統合, 1=X/Y, 2=上下左右 ※スケールのみ）
  const [splitDimensions, setSplitDimensions] = useState<Record<string, number>>({});

  // 方向別スケール値（独立管理）
  const [dirScaleValues, setDirScaleValues] = useState({ top: 100, bottom: 100, left: 100, right: 100 });

  // コンテキストメニュー
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; propKey: string; value: number | [number, number];
  } | null>(null);

  // クリップボード（値コピペ）
  const [clipboardValue, setClipboardValue] = useState<number | [number, number] | null>(null);

  const selectedLayer = layers.find((l) => l.id === selectedLayerIds[0]);

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  /** キーフレームを追加するヘルパー */
  const handleAddKeyframe = useCallback(
    (propName: string, value: number | number[]) => {
      if (!selectedLayer) return;
      const kf: Keyframe = {
        time: currentFrame,
        value,
        interpolation: 'bezier',
        bezierPoints: EASING_PRESETS.easeInOut,
      };
      addKeyframe(selectedLayer.id, propName, kf);
    },
    [selectedLayer, currentFrame, addKeyframe]
  );

  /** プロパティにキーフレームがあるか */
  const hasKeyframe = (propName: string): boolean => {
    if (!selectedLayer) return false;
    const propAnim = animations[selectedLayer.id]?.[propName];
    return propAnim?.keyframes.some((kf) => kf.time === currentFrame) || false;
  };

  /** プロパティにKFが1つでもあるか（ストップウォッチ状態） */
  const isAnimated = (propName: string): boolean => {
    if (!selectedLayer) return false;
    const propAnim = animations[selectedLayer.id]?.[propName];
    return (propAnim?.keyframes.length ?? 0) > 0;
  };

  /** 前のKF時間を取得 */
  const getPrevKfTime = (propName: string): number | null => {
    if (!selectedLayer) return null;
    const kfs = animations[selectedLayer.id]?.[propName]?.keyframes;
    if (!kfs) return null;
    const prev = kfs.filter(kf => kf.time < currentFrame).sort((a, b) => b.time - a.time);
    return prev.length > 0 ? prev[0].time : null;
  };

  /** 次のKF時間を取得 */
  const getNextKfTime = (propName: string): number | null => {
    if (!selectedLayer) return null;
    const kfs = animations[selectedLayer.id]?.[propName]?.keyframes;
    if (!kfs) return null;
    const next = kfs.filter(kf => kf.time > currentFrame).sort((a, b) => a.time - b.time);
    return next.length > 0 ? next[0].time : null;
  };

  const setCurrentFrame = useTimelineStore.getState().setCurrentFrame;

  /** ドラッグスクラブ用ref */
  const dragRef = useRef<{ startX: number; startVal: number; step: number; min?: number; max?: number } | null>(null);

  /** ラベルをドラッグしてスクラブ */
  const handleDragStart = (
    e: React.MouseEvent,
    currentVal: number,
    onChange: (v: number) => void,
    opts?: { step?: number; min?: number; max?: number },
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const step = opts?.step ?? 1;
    dragRef.current = { startX, startVal: currentVal, step, min: opts?.min, max: opts?.max };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      let newVal = dragRef.current.startVal + dx * dragRef.current.step * 0.5;
      if (dragRef.current.min !== undefined) newVal = Math.max(dragRef.current.min, newVal);
      if (dragRef.current.max !== undefined) newVal = Math.min(dragRef.current.max, newVal);
      // stepで丸める
      newVal = Math.round(newVal / step) * step;
      onChange(newVal);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** キーフレーム補間を考慮した値を返す */
  const getResolvedValue = (propName: string): number | number[] | undefined => {
    if (!selectedLayer) return undefined;
    const propAnim = animations[selectedLayer.id]?.[propName];
    if (!propAnim || propAnim.keyframes.length === 0) return undefined;
    return interpolateValue(propAnim, currentFrame) ?? undefined;
  };

  /** トランスフォームの表示値を取得（KF補間 > デフォルト） */
  const getDisplayValue = (propKey: string, defaultValue: number | [number, number]): number | [number, number] => {
    const resolved = getResolvedValue(propKey);
    if (resolved !== undefined) return resolved as any;
    return defaultValue;
  };

  /** 数値プロパティの表示値を取得（汎用） */
  const getDisplayNumeric = (propKey: string, defaultValue: number): number => {
    const resolved = getResolvedValue(propKey);
    if (resolved !== undefined && typeof resolved === 'number') return resolved;
    return defaultValue;
  };

  /** 値変更時、KFが有効なプロパティなら自動でKF更新 */
  const handleValueChange = (propKey: string, value: number | [number, number]) => {
    if (!selectedLayer) return;
    // スケールリンク対応（比率保持: 現在値からリアルタイム計算）
    if (propKey === 'scale' && scaleLinked && Array.isArray(value)) {
      const oldScale = selectedLayer.transform.scale;
      const resolved = getDisplayValue('scale', oldScale) as [number, number];
      // X/Yどちらが変わったかを判定し、比率を維持して連動
      if (value[0] !== resolved[0] && resolved[0] !== 0) {
        // Xが変わった → Y = newX × (oldY / oldX)
        value = [value[0], value[0] * (resolved[1] / resolved[0])];
      } else if (value[1] !== resolved[1] && resolved[1] !== 0) {
        // Yが変わった → X = newY × (oldX / oldY)
        value = [value[1] * (resolved[0] / resolved[1]), value[1]];
      }
    }
    updateTransform(selectedLayer.id, propKey, value);
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
  };

  /** テキストプロパティ変更（KF自動更新対応） */
  const handleTextValueChange = (field: string, propKey: string, value: number) => {
    if (!selectedLayer?.textStyle) return;
    updateLayer(selectedLayer.id, {
      textStyle: { ...selectedLayer.textStyle, [field]: value },
    });
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
  };

  /** シェイププロパティ変更（KF自動更新対応） */
  const handleShapeValueChange = (field: string, propKey: string, value: number) => {
    if (!selectedLayer?.shapeData) return;
    updateLayer(selectedLayer.id, {
      shapeData: { ...selectedLayer.shapeData, [field]: value },
    });
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
  };

  /** デフォルト値テーブル */
  const DEFAULT_VALUES: Record<string, number | [number, number]> = {
    anchorPoint: [0, 0], position: [960, 540], scale: [100, 100],
    rotation: 0, opacity: 100,
  };

  /** 右クリックメニューを開く */
  const openContextMenu = (e: React.MouseEvent, propKey: string, value: number | [number, number]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, propKey, value });
  };

  /** 右クリックメニューアクション */
  const contextMenuActions = {
    addKf: () => {
      if (!contextMenu || !selectedLayer) return;
      handleAddKeyframe(contextMenu.propKey, contextMenu.value);
      setContextMenu(null);
    },
    removeKf: () => {
      if (!contextMenu || !selectedLayer) return;
      removeKeyframe(selectedLayer.id, contextMenu.propKey, currentFrame);
      setContextMenu(null);
    },
    removeAllKf: () => {
      if (!contextMenu || !selectedLayer) return;
      const propAnim = animations[selectedLayer.id]?.[contextMenu.propKey];
      if (propAnim) {
        propAnim.keyframes.forEach(kf => {
          removeKeyframe(selectedLayer.id, contextMenu.propKey, kf.time);
        });
      }
      setContextMenu(null);
    },
    resetValue: () => {
      if (!contextMenu || !selectedLayer) return;
      const defaultVal = DEFAULT_VALUES[contextMenu.propKey];
      if (defaultVal !== undefined) {
        updateTransform(selectedLayer.id, contextMenu.propKey, defaultVal);
      }
      setContextMenu(null);
    },
    copyValue: () => {
      if (!contextMenu) return;
      setClipboardValue(contextMenu.value);
      setContextMenu(null);
    },
    pasteValue: () => {
      if (!contextMenu || !selectedLayer || clipboardValue === null) return;
      handleValueChange(contextMenu.propKey, clipboardValue);
      setContextMenu(null);
    },
    /** 次元分割を進める */
    splitUp: () => {
      if (!contextMenu) return;
      const parentKey = contextMenu.propKey.includes('.') ? contextMenu.propKey.split('.')[0] : contextMenu.propKey;
      const cur = splitDimensions[parentKey] || 0;
      const maxLevel = parentKey === 'scale' ? 2 : 1;
      if (cur >= maxLevel) return;
      const next = cur + 1;

      // キーフレーム分割ロジック (scale)
      if (parentKey === 'scale' && selectedLayer) {
        const layerId = selectedLayer.id;
        const anims = animations[layerId] || {};

        // 0→1: scale → scale.x / scale.y (イージングそのまま保持)
        if (cur === 0 && next === 1 && anims['scale']) {
          const scaleKfs = anims['scale'].keyframes;
          scaleKfs.forEach(kf => {
            const [x, y] = Array.isArray(kf.value) ? kf.value : [kf.value, kf.value];
            addKeyframe(layerId, 'scale.x', { time: kf.time, value: x as number, interpolation: kf.interpolation, bezierPoints: kf.bezierPoints ? [...kf.bezierPoints] as [number, number, number, number] : undefined });
            addKeyframe(layerId, 'scale.y', { time: kf.time, value: y as number, interpolation: kf.interpolation, bezierPoints: kf.bezierPoints ? [...kf.bezierPoints] as [number, number, number, number] : undefined });
          });
          scaleKfs.forEach(kf => removeKeyframe(layerId, 'scale', kf.time));
        }

        // 1→2: X/Y → directionals (top,bottom,left,right) (イージング保持)
        if (cur === 1 && next === 2) {
          const xKfs = anims['scale.x']?.keyframes || [];
          const yKfs = anims['scale.y']?.keyframes || [];

          // ★ 現在のX/Y値を取得してdirScaleValuesとtransform.directionalScaleを初期化
          const curX = xKfs.length > 0
            ? interpolateValue({ name: '', keyframes: xKfs }, currentFrame) as number ?? selectedLayer.transform.scale[0]
            : selectedLayer.transform.scale[0];
          const curY = yKfs.length > 0
            ? interpolateValue({ name: '', keyframes: yKfs }, currentFrame) as number ?? selectedLayer.transform.scale[1]
            : selectedLayer.transform.scale[1];
          const newDirValues = { top: curY, bottom: curY, left: curX, right: curX };
          setDirScaleValues(newDirValues);
          updateTransform(layerId, 'directionalScale', newDirValues);

          // キーフレーム変換
          const times = new Set([...xKfs.map(k => k.time), ...yKfs.map(k => k.time)]);
          times.forEach(t => {
            const xKf = xKfs.find(k => k.time === t);
            const yKf = yKfs.find(k => k.time === t);
            const xVal = xKf ? (xKf.value as number) : (xKfs.length > 0 ? interpolateValue({ name: '', keyframes: xKfs }, t) as number : curX);
            const yVal = yKf ? (yKf.value as number) : (yKfs.length > 0 ? interpolateValue({ name: '', keyframes: yKfs }, t) as number : curY);
            const srcKf = yKf || xKf;
            const interp = srcKf?.interpolation || 'bezier';
            const bp = srcKf?.bezierPoints ? [...srcKf.bezierPoints] as [number, number, number, number] : EASING_PRESETS.easeInOut;
            ['top', 'bottom'].forEach(dir => {
              addKeyframe(layerId, `scale.${dir}`, { time: t, value: yVal, interpolation: interp, bezierPoints: bp });
            });
            ['left', 'right'].forEach(dir => {
              addKeyframe(layerId, `scale.${dir}`, { time: t, value: xVal, interpolation: interp, bezierPoints: bp });
            });
          });
          xKfs.forEach(kf => removeKeyframe(layerId, 'scale.x', kf.time));
          yKfs.forEach(kf => removeKeyframe(layerId, 'scale.y', kf.time));
        }
      }

      // position / anchorPoint (0→1: array → x/y) (イージング保持)
      if ((parentKey === 'position' || parentKey === 'anchorPoint') && selectedLayer) {
        const layerId = selectedLayer.id;
        const anims = animations[layerId] || {};
        if (cur === 0 && next === 1 && anims[parentKey]) {
          const kfs = anims[parentKey].keyframes;
          kfs.forEach(kf => {
            const [x, y] = Array.isArray(kf.value) ? kf.value : [kf.value, kf.value];
            addKeyframe(layerId, `${parentKey}.x`, { time: kf.time, value: x as number, interpolation: kf.interpolation, bezierPoints: kf.bezierPoints ? [...kf.bezierPoints] as [number, number, number, number] : undefined });
            addKeyframe(layerId, `${parentKey}.y`, { time: kf.time, value: y as number, interpolation: kf.interpolation, bezierPoints: kf.bezierPoints ? [...kf.bezierPoints] as [number, number, number, number] : undefined });
          });
          kfs.forEach(kf => removeKeyframe(layerId, parentKey, kf.time));
        }
      }

      setSplitDimensions(prev => ({ ...prev, [parentKey]: next }));
      setContextMenu(null);

    },
    /** 次元統合 */
    mergeSplit: () => {
      if (!contextMenu) return;
      const parentKey = contextMenu.propKey.includes('.') ? contextMenu.propKey.split('.')[0] : contextMenu.propKey;
      const layerId = selectedLayer?.id;
      if (!layerId) return;
      const anims = animations[layerId] || {};
      const curLevel = splitDimensions[parentKey] || 0;
      const next = curLevel - 1;


      // level2 -> 1 : directionals -> X/Y (イージング保持)
      // top+bottomの平均→Y、left+rightの平均→X で見た目を維持
      if (parentKey === 'scale' && curLevel === 2) {
        const dirs = ['top', 'bottom', 'left', 'right'] as const;
        const dirKfs: Record<string, Keyframe[]> = {};
        dirs.forEach(dir => {
          dirKfs[dir] = anims[`scale.${dir}`]?.keyframes || [];
        });

        // 現在の方向別スケール値を取得（transform.directionalScale or transform.scale からフォールバック）
        const curDS = selectedLayer!.transform.directionalScale;
        const curTop = curDS?.top ?? selectedLayer!.transform.scale[1];
        const curBottom = curDS?.bottom ?? selectedLayer!.transform.scale[1];
        const curLeft = curDS?.left ?? selectedLayer!.transform.scale[0];
        const curRight = curDS?.right ?? selectedLayer!.transform.scale[0];

        // キーフレームを変換
        const allDirKfs = [...dirKfs.top, ...dirKfs.bottom, ...dirKfs.left, ...dirKfs.right];
        const times = new Set(allDirKfs.map(k => k.time));
        times.forEach(t => {
          const getVal = (dir: string, fallback: number): number => {
            const kf = dirKfs[dir].find(k => k.time === t);
            if (kf) return kf.value as number;
            if (dirKfs[dir].length > 0) return interpolateValue({ name: '', keyframes: dirKfs[dir] }, t) as number;
            return fallback;
          };
          const topVal = getVal('top', curTop);
          const bottomVal = getVal('bottom', curBottom);
          const leftVal = getVal('left', curLeft);
          const rightVal = getVal('right', curRight);
          const yVal = (topVal + bottomVal) / 2;
          const xVal = (leftVal + rightVal) / 2;
          const srcKf = dirKfs.top.find(k => k.time === t) || dirKfs.bottom.find(k => k.time === t)
                     || dirKfs.left.find(k => k.time === t) || dirKfs.right.find(k => k.time === t);
          const interp = srcKf?.interpolation || 'bezier';
          const bp = srcKf?.bezierPoints ? [...srcKf.bezierPoints] as [number, number, number, number] : EASING_PRESETS.easeInOut;
          addKeyframe(layerId, 'scale.x', { time: t, value: xVal, interpolation: interp, bezierPoints: bp });
          addKeyframe(layerId, 'scale.y', { time: t, value: yVal, interpolation: interp, bezierPoints: bp });
        });
        dirs.forEach(dir => {
          dirKfs[dir].forEach(kf => removeKeyframe(layerId, `scale.${dir}`, kf.time));
        });

        const newScaleX = (curLeft + curRight) / 2;
        const newScaleY = (curTop + curBottom) / 2;
        updateTransform(layerId, 'scale', [newScaleX, newScaleY] as [number, number]);
        updateTransform(layerId, 'directionalScale', undefined);

        // ★ Position補正: 非対称directional scaleの視覚的重心ずれを補正
        // コンテンツは原点中心(-w/2 to w/2)で描画されるので、
        // 非対称スケール時の視覚中心 = pos + (rightFactor - leftFactor) * w/4
        // 通常スケール時の視覚中心 = pos
        // → positionを (rightFactor - leftFactor) * w/4 だけオフセット
        const leftFactor = curLeft / 100;
        const rightFactor = curRight / 100;
        const topFactor = curTop / 100;
        const bottomFactor = curBottom / 100;
        const projSettings = useProjectStore.getState().settings;
        // レイヤータイプに応じたコンテンツサイズ
        const contentW = selectedLayer!.type === 'solid' ? projSettings.width : 200;
        const contentH = selectedLayer!.type === 'solid' ? projSettings.height : 200;
        const offsetX = (rightFactor - leftFactor) * contentW / 4;
        const offsetY = (bottomFactor - topFactor) * contentH / 4;
        if (Math.abs(offsetX) > 0.01 || Math.abs(offsetY) > 0.01) {
          const curPos = useLayerStore.getState().layers.find(l => l.id === layerId)?.transform.position || [960, 540];
          updateTransform(layerId, 'position', [
            curPos[0] + offsetX,
            curPos[1] + offsetY,
          ] as [number, number]);
        }
      }

      // level1 -> 0 : X/Y -> scale array (イージング保持)
      if (parentKey === 'scale' && curLevel === 1) {
        const xKfs = anims['scale.x']?.keyframes || [];
        const yKfs = anims['scale.y']?.keyframes || [];

        // 現在のX/Y値を取得（KFがあれば現フレームの補間値、なければtransform.scale）
        const curX = xKfs.length > 0
          ? interpolateValue({ name: '', keyframes: xKfs }, currentFrame) as number ?? selectedLayer!.transform.scale[0]
          : selectedLayer!.transform.scale[0];
        const curY = yKfs.length > 0
          ? interpolateValue({ name: '', keyframes: yKfs }, currentFrame) as number ?? selectedLayer!.transform.scale[1]
          : selectedLayer!.transform.scale[1];

        // キーフレーム変換
        const times = new Set([...xKfs.map(k => k.time), ...yKfs.map(k => k.time)]);
        times.forEach(t => {
          const xKf = xKfs.find(k => k.time === t);
          const yKf = yKfs.find(k => k.time === t);
          const xVal = xKf ? (xKf.value as number) : (xKfs.length > 0 ? interpolateValue({ name: '', keyframes: xKfs }, t) as number : curX);
          const yVal = yKf ? (yKf.value as number) : (yKfs.length > 0 ? interpolateValue({ name: '', keyframes: yKfs }, t) as number : curY);
          const srcKf = xKf || yKf;
          const interp = srcKf?.interpolation || 'bezier';
          const bp = srcKf?.bezierPoints ? [...srcKf.bezierPoints] as [number, number, number, number] : EASING_PRESETS.easeInOut;
          addKeyframe(layerId, 'scale', { time: t, value: [xVal, yVal], interpolation: interp, bezierPoints: bp });
        });
        xKfs.forEach(kf => removeKeyframe(layerId, 'scale.x', kf.time));
        yKfs.forEach(kf => removeKeyframe(layerId, 'scale.y', kf.time));

        // ★ transform.scale のベース値も更新
        updateTransform(layerId, 'scale', [curX, curY] as [number, number]);
      }

      // position / anchorPoint (1→0: x/y → array) (イージング保持)
      if ((parentKey === 'position' || parentKey === 'anchorPoint') && curLevel === 1) {
        const xKfs = anims[`${parentKey}.x`]?.keyframes || [];
        const yKfs = anims[`${parentKey}.y`]?.keyframes || [];
        const defaultVal = selectedLayer!.transform[parentKey as 'position' | 'anchorPoint'] as [number, number];

        // 現在のX/Y値
        const curX = xKfs.length > 0
          ? interpolateValue({ name: '', keyframes: xKfs }, currentFrame) as number ?? defaultVal[0]
          : defaultVal[0];
        const curY = yKfs.length > 0
          ? interpolateValue({ name: '', keyframes: yKfs }, currentFrame) as number ?? defaultVal[1]
          : defaultVal[1];

        const times = new Set([...xKfs.map(k => k.time), ...yKfs.map(k => k.time)]);
        times.forEach(t => {
          const xKf = xKfs.find(k => k.time === t);
          const yKf = yKfs.find(k => k.time === t);
          const xVal = xKf ? (xKf.value as number) : (xKfs.length > 0 ? interpolateValue({ name: '', keyframes: xKfs }, t) as number : curX);
          const yVal = yKf ? (yKf.value as number) : (yKfs.length > 0 ? interpolateValue({ name: '', keyframes: yKfs }, t) as number : curY);
          const srcKf = xKf || yKf;
          const interp = srcKf?.interpolation || 'bezier';
          const bp = srcKf?.bezierPoints ? [...srcKf.bezierPoints] as [number, number, number, number] : EASING_PRESETS.easeInOut;
          addKeyframe(layerId, parentKey, { time: t, value: [xVal, yVal], interpolation: interp, bezierPoints: bp });
        });
        xKfs.forEach(kf => removeKeyframe(layerId, `${parentKey}.x`, kf.time));
        yKfs.forEach(kf => removeKeyframe(layerId, `${parentKey}.y`, kf.time));

        // ★ transform ベース値を更新
        updateTransform(selectedLayer!.id, parentKey, [curX, curY]);
      }

      if (parentKey === 'scale' && next < 2 && curLevel !== 2) {
        updateTransform(layerId, 'directionalScale', undefined);
      }


      setSplitDimensions(prev => ({ ...prev, [parentKey]: next }));
      setContextMenu(null);

    },
  };

  /** 次元分割対象かどうか（子キーscale.top等も含む） */
  const canSplitDimension = (propKey: string) => {
    const parentKey = propKey.includes('.') ? propKey.split('.')[0] : propKey;
    return ['position', 'scale', 'anchorPoint'].includes(parentKey);
  };

  /** 親キー取得ヘルパー */
  const getParentKey = (propKey: string) => propKey.includes('.') ? propKey.split('.')[0] : propKey;

  /** 次元分割レベル取得 */
  const getSplitLevel = (propKey: string) => splitDimensions[getParentKey(propKey)] || 0;

  /** 分割可能か */
  const canSplitUp = (propKey: string) => {
    const parentKey = getParentKey(propKey);
    const maxLevel = parentKey === 'scale' ? 2 : 1;
    return getSplitLevel(propKey) < maxLevel;
  };

  /** 分割ラベル */
  const getSplitUpLabel = (propKey: string): string => {
    const parentKey = getParentKey(propKey);
    const level = getSplitLevel(propKey);
    if (parentKey === 'scale') {
      if (level === 0) return '次元を分割 (X/Y)';
      if (level === 1) return '次元を分割 (上下左右)';
    }
    return '次元を分割';
  };

  /** KFボタン付き数値プロパティ行（ナビ矢印+ドラッグスクラブ対応） */
  const renderKfNumericRow = (
    propKey: string,
    label: string,
    value: number,
    onChange: (v: number) => void,
    opts?: { min?: number; max?: number; step?: number; suffix?: string },
  ) => {
    const hasKf = hasKeyframe(propKey);
    const animated = isAnimated(propKey);
    const display = getDisplayNumeric(propKey, value);
    const prevTime = animated ? getPrevKfTime(propKey) : null;
    const nextTime = animated ? getNextKfTime(propKey) : null;
    return (
      <div key={propKey} className="prop-row prop-row-kf">
        <div className="prop-kf-controls">
          {animated && (
            <button
              className={`prop-kf-nav${prevTime !== null ? '' : ' disabled'}`}
              onClick={() => prevTime !== null && setCurrentFrame(prevTime)}
              title="前のキーフレーム"
            >
              <svg viewBox="0 0 10 12" width="8" height="10"><path d="M8 6L2 2L2 10Z" fill="currentColor" /></svg>
            </button>
          )}
          <button
            className={`prop-keyframe-btn${hasKf ? ' has-keyframe' : ''}${animated ? ' animated' : ''}`}
            onClick={() => {
              if (hasKf) {
                removeKeyframe(selectedLayer!.id, propKey, currentFrame);
              } else {
                handleAddKeyframe(propKey, display);
              }
            }}
            title={hasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
          >
            <svg viewBox="0 0 14 14" width="12" height="12">
              <circle cx="7" cy="8" r="4.5"
                fill={hasKf ? 'var(--color-keyframe)' : 'none'}
                stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.2"
              />
              <line x1="7" y1="8" x2="7" y2="5.5" stroke={hasKf ? '#fff' : 'currentColor'} strokeWidth="1" />
              <line x1="5" y1="2.5" x2="9" y2="2.5" stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1" />
            </svg>
          </button>
          {animated && (
            <button
              className={`prop-kf-nav${nextTime !== null ? '' : ' disabled'}`}
              onClick={() => nextTime !== null && setCurrentFrame(nextTime)}
              title="次のキーフレーム"
            >
              <svg viewBox="0 0 10 12" width="8" height="10"><path d="M2 6L8 2L8 10Z" fill="currentColor" /></svg>
            </button>
          )}
        </div>
        <span
          className={`prop-label scrub${animated ? ' animated' : ''}`}
          onMouseDown={(e) => handleDragStart(e, display, onChange, opts)}
          title="ドラッグで値を変更"
        >{label}</span>
        <div className="prop-value">
          <input
            type="number"
            value={Math.round(display * 100) / 100}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            readOnly
            onMouseDown={(e) => {
              if (!(e.currentTarget as HTMLInputElement).readOnly) return;
              handleDragStart(e, display, onChange, opts);
            }}
            onDoubleClick={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              el.readOnly = false;
              el.focus();
              el.select();
            }}
            onBlur={(e) => { (e.currentTarget as HTMLInputElement).readOnly = true; }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            min={opts?.min}
            max={opts?.max}
            step={opts?.step ?? 1}
          />
          {opts?.suffix && (
            <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>
              {opts.suffix}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (!selectedLayer) {
    return (
      <div className="properties">
        <div className="panel-header">
          <svg className="panel-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          プロパティ
        </div>
        <div className="panel-content">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l16 16M20 4L4 20" />
            </svg>
            <p>レイヤーを選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="properties">
      <div className="panel-header">
        プロパティ: {selectedLayer.name}
        <span style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: 'var(--font-size-sm)', opacity: 0.5 }}>≡</span>
      </div>
      <div className="panel-content">

        {/* トランスフォーム */}
        <div className="prop-group">
          <div
            className="prop-group-header"
            onClick={() => toggleGroup('transform')}
          >
            <svg className={`chevron${openGroups.transform ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            レイヤートランスフォーム
            <span className="reset-btn" onClick={(e) => {
              e.stopPropagation();
              updateTransform(selectedLayer.id, 'anchorPoint', [0, 0]);
              updateTransform(selectedLayer.id, 'position', [960, 540]);
              updateTransform(selectedLayer.id, 'scale', [100, 100]);
              updateTransform(selectedLayer.id, 'rotation', 0);
              updateTransform(selectedLayer.id, 'opacity', 100);
            }}>リセット</span>
          </div>
          {openGroups.transform && (
            <>
              {TRANSFORM_PROPS.map((prop) => {
                const rawValue = selectedLayer.transform[prop.key as keyof typeof selectedLayer.transform];
                const hasKf = hasKeyframe(prop.key);
                const animated = isAnimated(prop.key);
                const prevTime = animated ? getPrevKfTime(prop.key) : null;
                const nextTime = animated ? getNextKfTime(prop.key) : null;

                const kfControls = (
                  <div className="prop-kf-controls">
                    {animated && (
                      <button className={`prop-kf-nav${prevTime !== null ? '' : ' disabled'}`}
                        onClick={() => prevTime !== null && setCurrentFrame(prevTime)} title="前のキーフレーム">
                        <svg viewBox="0 0 10 12" width="8" height="10"><path d="M8 6L2 2L2 10Z" fill="currentColor" /></svg>
                      </button>
                    )}
                    <button
                      className={`prop-keyframe-btn${hasKf ? ' has-keyframe' : ''}${animated ? ' animated' : ''}`}
                      onClick={() => {
                        if (hasKf) { removeKeyframe(selectedLayer.id, prop.key, currentFrame); }
                        else {
                          const v = prop.type === 'xy'
                            ? (getDisplayValue(prop.key, rawValue as [number, number]) as [number, number])
                            : (getDisplayValue(prop.key, rawValue as number) as number);
                          handleAddKeyframe(prop.key, v);
                        }
                      }}
                      title={hasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12">
                        <circle cx="7" cy="8" r="4.5" fill={hasKf ? 'var(--color-keyframe)' : 'none'}
                          stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.2" />
                        <line x1="7" y1="8" x2="7" y2="5.5" stroke={hasKf ? '#fff' : 'currentColor'} strokeWidth="1" />
                        <line x1="5" y1="2.5" x2="9" y2="2.5" stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1" />
                      </svg>
                    </button>
                    {animated && (
                      <button className={`prop-kf-nav${nextTime !== null ? '' : ' disabled'}`}
                        onClick={() => nextTime !== null && setCurrentFrame(nextTime)} title="次のキーフレーム">
                        <svg viewBox="0 0 10 12" width="8" height="10"><path d="M2 6L8 2L8 10Z" fill="currentColor" /></svg>
                      </button>
                    )}
                  </div>
                );

                if (prop.type === 'xy') {
                  const defaultArr = rawValue as [number, number];
                  const displayArr = getDisplayValue(prop.key, defaultArr) as [number, number];
                  const splitLevel = splitDimensions[prop.key] || 0;

                  // ヘルパー: 数値入力 (readOnly + ドラッグ + ダブルクリック)
                  const numInput = (val: number, onChange: (v: number) => void, step: number, w?: string) => (
                    <input type="number" value={Math.round(val * 10) / 10}
                      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                      readOnly
                      onMouseDown={(e) => { if (!e.currentTarget.readOnly) return; handleDragStart(e, val, onChange, { step }); }}
                      onDoubleClick={(e) => { e.currentTarget.readOnly = false; e.currentTarget.focus(); e.currentTarget.select(); }}
                      onBlur={(e) => { e.currentTarget.readOnly = true; }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      step={step} style={w ? { width: w } : undefined} />
                  );

                  const stepVal = prop.key === 'scale' ? 1 : 0.5;

                  // ヘルパー: 分割行用KFコントロール生成（軸別propKey）
                  const makeSplitKfControls = (axisPropKey: string, axisValue: number) => {
                    const axisHasKf = hasKeyframe(axisPropKey);
                    const axisAnimated = isAnimated(axisPropKey);
                    const axisPrevTime = axisAnimated ? getPrevKfTime(axisPropKey) : null;
                    const axisNextTime = axisAnimated ? getNextKfTime(axisPropKey) : null;
                    return (
                      <div className="prop-kf-controls">
                        {axisAnimated && (
                          <button className={`prop-kf-nav${axisPrevTime !== null ? '' : ' disabled'}`}
                            onClick={() => axisPrevTime !== null && setCurrentFrame(axisPrevTime)} title="前のキーフレーム">
                            <svg viewBox="0 0 10 12" width="8" height="10"><path d="M8 6L2 2L2 10Z" fill="currentColor" /></svg>
                          </button>
                        )}
                        <button
                          className={`prop-keyframe-btn${axisHasKf ? ' has-keyframe' : ''}${axisAnimated ? ' animated' : ''}`}
                          onClick={() => {
                            if (axisHasKf) { removeKeyframe(selectedLayer.id, axisPropKey, currentFrame); }
                            else { handleAddKeyframe(axisPropKey, axisValue); }
                          }}
                          title={axisHasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
                        >
                          <svg viewBox="0 0 14 14" width="12" height="12">
                            <circle cx="7" cy="8" r="4.5" fill={axisHasKf ? 'var(--color-keyframe)' : 'none'}
                              stroke={axisAnimated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.2" />
                            <line x1="7" y1="8" x2="7" y2="5.5" stroke={axisHasKf ? '#fff' : 'currentColor'} strokeWidth="1" />
                            <line x1="5" y1="2.5" x2="9" y2="2.5" stroke={axisAnimated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1" />
                          </svg>
                        </button>
                        {axisAnimated && (
                          <button className={`prop-kf-nav${axisNextTime !== null ? '' : ' disabled'}`}
                            onClick={() => axisNextTime !== null && setCurrentFrame(axisNextTime)} title="次のキーフレーム">
                            <svg viewBox="0 0 10 12" width="8" height="10"><path d="M2 6L8 2L8 10Z" fill="currentColor" /></svg>
                          </button>
                        )}
                      </div>
                    );
                  };

                  // スケールチェーンアイコン（分割時のラベル横）
                  const scaleChainInline = prop.key === 'scale' ? (
                    <button
                      className={`prop-link-btn${scaleLinked ? ' linked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setScaleLinked(!scaleLinked);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      title={scaleLinked ? '縦横比を解除' : '縦横比を固定'}
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12">
                        {scaleLinked ? (<>
                          <rect x="2" y="3" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                          <rect x="2" y="8" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                          <line x1="7" y1="6" x2="7" y2="8" stroke="currentColor" strokeWidth="1.2" />
                        </>) : (<>
                          <rect x="2" y="3" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                          <rect x="2" y="8" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        </>)}
                      </svg>
                    </button>
                  ) : null;

                  // スケール段階2: 上下左右（4行）- 各方向が独立した値
                  if (prop.key === 'scale' && splitLevel === 2) {
                    type DirKey = 'top' | 'bottom' | 'left' | 'right';
                    const dirs: { label: string; kfKey: string; dirKey: DirKey }[] = [
                      { label: '上', kfKey: 'scale.top', dirKey: 'top' },
                      { label: '下', kfKey: 'scale.bottom', dirKey: 'bottom' },
                      { label: '左', kfKey: 'scale.left', dirKey: 'left' },
                      { label: '右', kfKey: 'scale.right', dirKey: 'right' },
                    ];

                    // KF補間値があればそちらを優先
                    const getDirValue = (dirKey: DirKey, kfKey: string): number => {
                      const resolved = getResolvedValue(kfKey);
                      if (resolved !== undefined && typeof resolved === 'number') return resolved;
                      return dirScaleValues[dirKey];
                    };

                    const handleDirChange = (dirKey: DirKey, kfKey: string, v: number) => {
                      let newDir: typeof dirScaleValues;
                      if (scaleLinked) {
                        // リンクON: 比率を維持して全方向を連動
                        const oldVal = dirScaleValues[dirKey];
                        if (oldVal !== 0) {
                          const ratio = v / oldVal;
                          newDir = {
                            top: dirScaleValues.top * ratio,
                            bottom: dirScaleValues.bottom * ratio,
                            left: dirScaleValues.left * ratio,
                            right: dirScaleValues.right * ratio,
                          };
                        } else {
                          newDir = { top: v, bottom: v, left: v, right: v };
                        }
                      } else {
                        newDir = { ...dirScaleValues, [dirKey]: v };
                      }
                      setDirScaleValues(newDir);
                      // transform.directionalScaleを更新（レンダラーが直接参照）
                      updateTransform(selectedLayer.id, 'directionalScale', newDir);
                      // 方向別KFも更新
                      if (scaleLinked) {
                        // リンク時は全方向のKFを比率維持で更新
                        for (const d of dirs) {
                          if (isAnimated(d.kfKey)) handleAddKeyframe(d.kfKey, newDir[d.dirKey]);
                        }
                      } else {
                        if (isAnimated(kfKey)) handleAddKeyframe(kfKey, v);
                      }
                    };

                    return (
                      <div key={prop.key}>
                        {dirs.map((d, i) => {
                          const val = getDirValue(d.dirKey, d.kfKey);
                          return (
                            <div key={d.kfKey} className="prop-row prop-row-kf"
                              onContextMenu={(e) => openContextMenu(e, d.kfKey, val)}>
                              {makeSplitKfControls(d.kfKey, val)}
                              <span className={`prop-label scrub${isAnimated(d.kfKey) ? ' animated' : ''}`}
                                onMouseDown={(e) => handleDragStart(e, val, (v) => handleDirChange(d.dirKey, d.kfKey, v), { step: stepVal })}
                              >
                                {`${prop.label} ${d.label}`}
                                {i === 0 && scaleChainInline}
                              </span>
                              <div className="prop-value">
                                {numInput(val, (v) => handleDirChange(d.dirKey, d.kfKey, v), stepVal)}
                                {prop.suffix && <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)' }}>{prop.suffix}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  // 段階1: X/Y分割
                  if (splitLevel === 1) {
                    return (
                      <div key={prop.key}>
                        {['X', 'Y'].map((axis, idx) => (
                          <div key={`${prop.key}_${axis}`} className="prop-row prop-row-kf"
                            onContextMenu={(e) => openContextMenu(e, prop.key, displayArr)}>
                            {makeSplitKfControls(`${prop.key}.${axis.toLowerCase()}`, displayArr[idx])}
                            <span className={`prop-label scrub${animated ? ' animated' : ''}`}
                              onMouseDown={(e) => handleDragStart(e, displayArr[idx], (v) => {
                                const a: [number, number] = [...displayArr];
                                a[idx] = v;
                                handleValueChange(prop.key, a);
                              }, { step: stepVal })}
                            >
                              {`${prop.label} ${axis}`}
                              {idx === 0 && scaleChainInline}
                            </span>
                            <div className="prop-value">
                              {numInput(displayArr[idx], (v) => {
                                const a: [number, number] = [...displayArr];
                                a[idx] = v;
                                handleValueChange(prop.key, a);
                              }, stepVal)}
                              {prop.suffix && <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)' }}>{prop.suffix}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // 段階0: 統合（通常表示）
                  return (
                    <div key={prop.key} className="prop-row prop-row-kf"
                      onContextMenu={(e) => openContextMenu(e, prop.key, displayArr)}>
                      {kfControls}
                      <span
                        className={`prop-label scrub${animated ? ' animated' : ''}`}
                        onMouseDown={(e) => handleDragStart(e, displayArr[0], (v) => handleValueChange(prop.key, [v, displayArr[1]]), { step: stepVal })}
                        title="ドラッグで値を変更"
                      >
                        {prop.label}
                        {/* スケールリンクアイコン（ラベル横） */}
                        {prop.key === 'scale' && (
                          <button
                            className={`prop-link-btn${scaleLinked ? ' linked' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setScaleLinked(!scaleLinked);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            title={scaleLinked ? '縦横比を解除' : '縦横比を固定'}
                          >
                            <svg viewBox="0 0 14 14" width="12" height="12">
                              {scaleLinked ? (<>
                                <rect x="2" y="3" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                                <rect x="2" y="8" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                                <line x1="7" y1="6" x2="7" y2="8" stroke="currentColor" strokeWidth="1.2" />
                              </>) : (<>
                                <rect x="2" y="3" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                                <rect x="2" y="8" width="10" height="3" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                              </>)}
                            </svg>
                          </button>
                        )}
                      </span>
                      <div className="prop-value">
                        {numInput(displayArr[0], (v) => handleValueChange(prop.key, [v, displayArr[1]]), stepVal, '50%')}
                        {numInput(displayArr[1], (v) => handleValueChange(prop.key, [displayArr[0], v]), stepVal, '50%')}
                      </div>
                    </div>
                  );
                }

                const defaultNum = rawValue as number;
                const displayNum = getDisplayValue(prop.key, defaultNum) as number;
                return (
                  <div key={prop.key} className="prop-row prop-row-kf"
                    onContextMenu={(e) => openContextMenu(e, prop.key, displayNum)}>
                    {kfControls}
                    <span
                      className={`prop-label scrub${animated ? ' animated' : ''}`}
                      onMouseDown={(e) => handleDragStart(e, displayNum, (v) => handleValueChange(prop.key, v), { step: prop.key === 'rotation' ? 1 : 0.5, min: prop.min, max: prop.max })}
                      title="ドラッグで値を変更"
                    >{prop.label}</span>
                    <div className="prop-value">
                      <input type="number" value={Math.round(displayNum * 10) / 10}
                        onChange={(e) => handleValueChange(prop.key, parseFloat(e.target.value) || 0)}
                        readOnly
                        onMouseDown={(e) => { if (!e.currentTarget.readOnly) return; handleDragStart(e, displayNum, (v) => handleValueChange(prop.key, v), { step: prop.key === 'rotation' ? 1 : 0.5, min: prop.min, max: prop.max }); }}
                        onDoubleClick={(e) => { e.currentTarget.readOnly = false; e.currentTarget.focus(); e.currentTarget.select(); }}
                        onBlur={(e) => { e.currentTarget.readOnly = true; }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        min={prop.min} max={prop.max} step={prop.key === 'rotation' ? 1 : 0.5} />
                      {prop.suffix && (
                        <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>{prop.suffix}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* テキスト固有プロパティ */}
        {selectedLayer.type === 'text' && selectedLayer.textStyle && (
          <div className="prop-group">
            <div
              className="prop-group-header"
              onClick={() => toggleGroup('text')}
            >
              <svg className={`chevron${openGroups.text ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6l6 6-6 6V6z" />
              </svg>
              テキスト
            </div>
            {openGroups.text && (
              <>
                {/* フォントファミリー */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">フォント</span>
                  <div className="prop-value">
                    <input
                      type="text"
                      value={selectedLayer.textStyle.fontFamily}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, fontFamily: e.target.value },
                        })
                      }
                      style={{ width: '100%' }}
                      list="font-list"
                    />
                    <datalist id="font-list">
                      <option value="Inter" />
                      <option value="Roboto" />
                      <option value="Noto Sans JP" />
                      <option value="Arial" />
                      <option value="Helvetica" />
                      <option value="Georgia" />
                      <option value="Times New Roman" />
                      <option value="monospace" />
                    </datalist>
                  </div>
                </div>
                {/* フォントサイズ */}
                {renderKfNumericRow(
                  'text.fontSize', 'サイズ',
                  selectedLayer.textStyle.fontSize,
                  (v) => handleTextValueChange('fontSize', 'text.fontSize', v),
                  { min: 1, step: 1, suffix: 'px' },
                )}
                {/* フォントウェイト */}
                {renderKfNumericRow(
                  'text.fontWeight', '太さ',
                  selectedLayer.textStyle.fontWeight,
                  (v) => handleTextValueChange('fontWeight', 'text.fontWeight', v),
                  { min: 100, max: 900, step: 100 },
                )}
                {/* 文字色 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">色</span>
                  <div className="prop-value">
                    <input
                      type="color"
                      value={selectedLayer.textStyle.color}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, color: e.target.value },
                        })
                      }
                      className="color-swatch"
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLayer.textStyle.color}
                    </span>
                  </div>
                </div>
                {/* 行間 */}
                {renderKfNumericRow(
                  'text.lineHeight', '行間',
                  selectedLayer.textStyle.lineHeight,
                  (v) => handleTextValueChange('lineHeight', 'text.lineHeight', v),
                  { min: 0.5, max: 5, step: 0.1 },
                )}
                {/* 文字間隔 */}
                {renderKfNumericRow(
                  'text.letterSpacing', '文字間隔',
                  selectedLayer.textStyle.letterSpacing,
                  (v) => handleTextValueChange('letterSpacing', 'text.letterSpacing', v),
                  { step: 0.5, suffix: 'px' },
                )}
                {/* テキスト揃え */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">揃え</span>
                  <div className="prop-value" style={{ gap: 2 }}>
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() =>
                          updateLayer(selectedLayer.id, {
                            textStyle: { ...selectedLayer.textStyle!, textAlign: align },
                          })
                        }
                        style={{
                          flex: 1,
                          padding: '3px',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-xs)',
                          background: selectedLayer.textStyle!.textAlign === align ? 'var(--color-accent-light)' : 'var(--color-bg-input)',
                          color: selectedLayer.textStyle!.textAlign === align ? 'var(--color-accent)' : 'var(--color-text-muted)',
                          cursor: 'pointer',
                          fontSize: 'var(--font-size-xxs)',
                          fontWeight: 600,
                        }}
                        title={align === 'left' ? '左揃え' : align === 'center' ? '中央揃え' : '右揃え'}
                      >
                        {align === 'left' ? '◁' : align === 'center' ? '◇' : '▷'}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ソリッド固有プロパティ */}
        {selectedLayer.type === 'solid' && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('shape')}>
              <svg className={`chevron${openGroups.shape ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6l6 6-6 6V6z" />
              </svg>
              ソリッド
            </div>
            {openGroups.shape && (
              <div className="prop-row">
                <div />
                <span className="prop-label">色</span>
                <div className="prop-value">
                  <input
                    type="color"
                    value={selectedLayer.solidColor || '#6C5CE7'}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { solidColor: e.target.value })
                    }
                    className="color-swatch"
                  />
                  <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {selectedLayer.solidColor || '#6C5CE7'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* シェイプ固有プロパティ */}
        {selectedLayer.type === 'shape' && selectedLayer.shapeData && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('shape')}>
              <svg className={`chevron${openGroups.shape ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6l6 6-6 6V6z" />
              </svg>
              シェイプ
            </div>
            {openGroups.shape && (
              <>
                {/* シェイプタイプ */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">タイプ</span>
                  <div className="prop-value">
                    <select
                      value={selectedLayer.shapeData.shapeType}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, shapeType: e.target.value as any },
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="rectangle">矩形</option>
                      <option value="ellipse">楕円</option>
                      <option value="star">★ 星</option>
                    </select>
                  </div>
                </div>
                {/* 塗り色 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">塗り</span>
                  <div className="prop-value">
                    <input
                      type="color"
                      value={selectedLayer.shapeData.fill}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, fill: e.target.value },
                        })
                      }
                      className="color-swatch"
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLayer.shapeData.fill}
                    </span>
                  </div>
                </div>
                {/* 塗り不透明度 */}
                {renderKfNumericRow(
                  'shape.fillOpacity', '塗り不透明度',
                  selectedLayer.shapeData.fillOpacity ?? 100,
                  (v) => handleShapeValueChange('fillOpacity', 'shape.fillOpacity', v),
                  { min: 0, max: 100, step: 1, suffix: '%' },
                )}
                {/* 線色 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">線色</span>
                  <div className="prop-value">
                    <input
                      type="color"
                      value={selectedLayer.shapeData.stroke === 'transparent' ? '#000000' : selectedLayer.shapeData.stroke}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, stroke: e.target.value },
                        })
                      }
                      className="color-swatch"
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLayer.shapeData.stroke}
                    </span>
                  </div>
                </div>
                {/* 線幅 */}
                {renderKfNumericRow(
                  'shape.strokeWidth', '線幅',
                  selectedLayer.shapeData.strokeWidth,
                  (v) => handleShapeValueChange('strokeWidth', 'shape.strokeWidth', v),
                  { min: 0, step: 0.5, suffix: 'px' },
                )}
                {/* 線端 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">線端</span>
                  <div className="prop-value">
                    <select
                      value={selectedLayer.shapeData.strokeLineCap ?? 'butt'}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, strokeLineCap: e.target.value as any },
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="butt">Butt</option>
                      <option value="round">Round</option>
                      <option value="square">Square</option>
                    </select>
                  </div>
                </div>
                {/* 角丸（矩形のみ） */}
                {selectedLayer.shapeData.shapeType === 'rectangle' &&
                  renderKfNumericRow(
                    'shape.cornerRadius', '角丸',
                    selectedLayer.shapeData.cornerRadius ?? 0,
                    (v) => handleShapeValueChange('cornerRadius', 'shape.cornerRadius', v),
                    { min: 0, step: 1, suffix: 'px' },
                  )
                }
              </>
            )}
          </div>
        )}

        {/* レイヤー共通プロパティ */}
        <div className="prop-group">
          <div className="prop-group-header" onClick={() => toggleGroup('layer')}>
            <svg className={`chevron${openGroups.layer ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            レイヤー
          </div>
          {openGroups.layer && (
            <>
              {/* ブレンドモード */}
              <div className="prop-row">
                <div />
                <span className="prop-label">ブレンド</span>
                <div className="prop-value">
                  <select
                    value={selectedLayer.blendMode}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { blendMode: e.target.value as any })
                    }
                    style={selectStyle}
                  >
                    <option value="normal">通常</option>
                    <option value="multiply">乗算</option>
                    <option value="screen">スクリーン</option>
                    <option value="overlay">オーバーレイ</option>
                    <option value="add">加算</option>
                    <option value="darken">比較（暗）</option>
                    <option value="lighten">比較（明）</option>
                  </select>
                </div>
              </div>
              {/* 親レイヤー */}
              <div className="prop-row">
                <div />
                <span className="prop-label">親</span>
                <div className="prop-value">
                  <select
                    value={selectedLayer.parentId || ''}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { parentId: e.target.value || null })
                    }
                    style={selectStyle}
                  >
                    <option value="">なし</option>
                    {layers
                      .filter((l) => l.id !== selectedLayer.id)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <>
          <div className="context-overlay" onClick={() => setContextMenu(null)} />
          <div className="prop-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {hasKeyframe(contextMenu.propKey) ? (
              <button onClick={contextMenuActions.removeKf}>キーフレーム削除</button>
            ) : (
              <button onClick={contextMenuActions.addKf}>キーフレーム追加</button>
            )}
            {isAnimated(contextMenu.propKey) && (
              <button onClick={contextMenuActions.removeAllKf}>全キーフレーム削除</button>
            )}
            <div className="context-divider" />
            <button onClick={contextMenuActions.resetValue}>値をリセット</button>
            <button onClick={contextMenuActions.copyValue}>値をコピー</button>
            <button onClick={contextMenuActions.pasteValue} disabled={clipboardValue === null}>
              値をペースト
            </button>
            {canSplitDimension(contextMenu.propKey) && (
              <>
                <div className="context-divider" />
                {canSplitUp(contextMenu.propKey) && (
                  <button onClick={contextMenuActions.splitUp}>
                    {getSplitUpLabel(contextMenu.propKey)}
                  </button>
                )}
                {getSplitLevel(contextMenu.propKey) > 0 && (
                  <button onClick={contextMenuActions.mergeSplit}>
                    次元を統合
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
