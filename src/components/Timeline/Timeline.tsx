import React, { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { useLayerStore, getLayerColor } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { Keyframe } from '../../types/keyframe';
import { EASING_PRESETS } from '../../types/keyframe';

export function Timeline() {
  const layers = useLayerStore((s) => s.layers);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const selectLayer = useLayerStore((s) => s.selectLayer);
  const toggleVisibility = useLayerStore((s) => s.toggleVisibility);
  const toggleLock = useLayerStore((s) => s.toggleLock);
  const addLayer = useLayerStore((s) => s.addLayer);
  const addKeyframe = useLayerStore((s) => s.addKeyframe);
  const removeKeyframe = useLayerStore((s) => s.removeKeyframe);
  const animations = useLayerStore((s) => s.animations);

  const expandedLayerIds = useUIStore((s) => s.expandedLayerIds);
  const toggleExpandLayer = useUIStore((s) => s.toggleExpandLayer);
  const showOnlyKeyframed = useUIStore((s) => s.showOnlyKeyframed);
  const showContextMenu = useUIStore((s) => s.showContextMenu);

  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const zoom = useTimelineStore((s) => s.zoom);
  const setZoom = useTimelineStore((s) => s.setZoom);
  const workAreaIn = useTimelineStore((s) => s.workAreaIn);
  const workAreaOut = useTimelineStore((s) => s.workAreaOut);


  const settings = useProjectStore((s) => s.settings);
  const totalFrames = useProjectStore((s) => s.totalFrames);

  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  // 縦スクロール同期のループ防止フラグ
  const scrollSyncSource = useRef<'layers' | 'tracks' | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  // レイヤー並べ替え用
  const [dragLayerIndex, setDragLayerIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [navScrollLeft, setNavScrollLeft] = useState(0);

  // レイヤーバー（inPoint/outPoint）ドラッグ用
  const [clipDrag, setClipDrag] = useState<{
    layerId: string;
    type: 'move' | 'trimLeft' | 'trimRight';
    startX: number;
    origIn: number;
    origOut: number;
  } | null>(null);

  // キーフレームドラッグ移動用
  const [kfDrag, setKfDrag] = useState<{
    layerId: string;
    propName: string;
    origTime: number;
    startX: number;
    kfData: Keyframe;
  } | null>(null);

  // 選択中のキーフレーム（複数選択対応）
  type KfSelection = { layerId: string; propName: string; time: number };
  const [selectedKfs, setSelectedKfs] = useState<KfSelection[]>([]);

  const isKfSelected = (layerId: string, propName: string, time: number) =>
    selectedKfs.some(s => s.layerId === layerId && s.propName === propName && s.time === time);

  const toggleKfSelection = (kf: KfSelection, multi: boolean) => {
    if (multi) {
      setSelectedKfs(prev =>
        prev.some(s => s.layerId === kf.layerId && s.propName === kf.propName && s.time === kf.time)
          ? prev.filter(s => !(s.layerId === kf.layerId && s.propName === kf.propName && s.time === kf.time))
          : [...prev, kf]
      );
    } else {
      setSelectedKfs([kf]);
    }
  };

  // フレーム→ピクセル変換（絶対位置）
  const frameToX = useCallback(
    (frame: number) => frame * zoom,
    [zoom],
  );

  // ピクセル→フレーム変換（コンテナ内クリック位置 + スクロールオフセット）
  const xToFrame = useCallback(
    (x: number) => {
      const scrollLeft = trackContainerRef.current?.scrollLeft || 0;
      return Math.round((x + scrollLeft) / zoom);
    },
    [zoom],
  );

  // コンポ全長のピクセル幅
  const totalContentWidth = totalFrames() * zoom;

  // トラックコンテナ ref
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const userZoomedRef = useRef(false);

  // フィットzoom計算
  const calcFitZoom = useCallback(() => {
    const el = trackContainerRef.current;
    if (!el) return 2;
    const total = totalFrames();
    if (total <= 0) return 2;
    const w = el.clientWidth;
    if (w <= 0) return 2;
    return Math.max(0.5, w / total);
  }, [totalFrames]);

  // 初期化 & リサイズ時のみ自動フィット（手動ズーム中はスキップ）
  useEffect(() => {
    const el = trackContainerRef.current;
    if (!el) return;

    // 初期化時はフィット + scrollLeftリセット
    if (!userZoomedRef.current) {
      setZoom(calcFitZoom());
      el.scrollLeft = 0;
      setNavScrollLeft(0);
    }

    const ro = new ResizeObserver(() => {
      if (!userZoomedRef.current) {
        setZoom(calcFitZoom());
        el.scrollLeft = 0;
        setNavScrollLeft(0);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [calcFitZoom, setZoom]);



  // ルーラークリック → プレイヘッド移動
  const handleRulerMouseDown = (e: React.MouseEvent) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const frame = Math.max(0, Math.min(xToFrame(x), totalFrames()));
    setCurrentFrame(frame);
    setIsDraggingPlayhead(true);
  };

  // プレイヘッドドラッグ
  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMove = (e: MouseEvent) => {
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const frame = Math.max(0, Math.min(xToFrame(x), totalFrames()));
      setCurrentFrame(frame);
    };

    const handleUp = () => setIsDraggingPlayhead(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingPlayhead, xToFrame, setCurrentFrame, totalFrames]);

  // レイヤーバー（クリップ）のドラッグ
  useEffect(() => {
    if (!clipDrag) return;

    const handleMove = (e: MouseEvent) => {
      const rect = tracksRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - clipDrag.startX;
      const frameDelta = Math.round(dx / zoom);

      const layerState = useLayerStore.getState();
      const layer = layerState.layers.find((l) => l.id === clipDrag.layerId);
      if (!layer) return;

      if (clipDrag.type === 'move') {
        const newIn = Math.max(0, clipDrag.origIn + frameDelta);
        const duration = clipDrag.origOut - clipDrag.origIn;
        layerState.updateLayer(clipDrag.layerId, {
          inPoint: newIn,
          outPoint: newIn + duration,
        });
      } else if (clipDrag.type === 'trimLeft') {
        const newIn = Math.max(0, Math.min(clipDrag.origIn + frameDelta, clipDrag.origOut - 1));
        layerState.updateLayer(clipDrag.layerId, { inPoint: newIn });
      } else if (clipDrag.type === 'trimRight') {
        const newOut = Math.max(clipDrag.origIn + 1, clipDrag.origOut + frameDelta);
        layerState.updateLayer(clipDrag.layerId, { outPoint: newOut });
      }
    };

    const handleUp = () => {
      setClipDrag(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [clipDrag, zoom]);

  // キーフレームドラッグ移動（複数選択対応 + スナップ）
  useEffect(() => {
    if (!kfDrag) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - kfDrag.startX;
      let frameDelta = Math.round(dx / zoom);
      let newTime = Math.max(0, kfDrag.origTime + frameDelta);

      // スナップ（Shiftで無効化）
      if (!e.shiftKey) {
        const snapThreshold = Math.max(1, Math.round(4 / zoom)); // 4px相当のフレーム数
        const store = useLayerStore.getState();

        // ドラッグ中のKF自身を除いた全KF時間を収集
        const movingTimes = new Set(
          (selectedKfs.length > 0 ? selectedKfs : [{ layerId: kfDrag.layerId, propName: kfDrag.propName, time: kfDrag.origTime }])
            .map(s => s.time + frameDelta)
        );
        const allTimes: number[] = [currentFrame]; // 再生ヘッドにもスナップ
        for (const [, propAnims] of Object.entries(store.animations)) {
          for (const [, prop] of Object.entries(propAnims)) {
            for (const kf of prop.keyframes) {
              if (!movingTimes.has(kf.time)) allTimes.push(kf.time);
            }
          }
        }

        // 最も近いスナップ先を見つける
        let bestSnap = newTime;
        let bestDist = Infinity;
        for (const t of allTimes) {
          const dist = Math.abs(newTime - t);
          if (dist < snapThreshold && dist < bestDist) {
            bestSnap = t;
            bestDist = dist;
          }
        }
        newTime = bestSnap;
        frameDelta = newTime - kfDrag.origTime;
      }

      const actualDelta = newTime - kfDrag.origTime;
      if (actualDelta === (kfDrag.kfData.time - kfDrag.origTime)) return;

      const store = useLayerStore.getState();

      // 選択中の全KFを移動
      const kfsToMove = selectedKfs.length > 0 ? selectedKfs : [{ layerId: kfDrag.layerId, propName: kfDrag.propName, time: kfDrag.origTime }];
      const newSelections: typeof selectedKfs = [];

      for (const sel of kfsToMove) {
        const anim = store.animations[sel.layerId]?.[sel.propName];

        const origKfTime = sel.time;
        const currentKfTime = origKfTime + actualDelta;
        const prevDelta = kfDrag.kfData.time - kfDrag.origTime;
        const prevKfTime = origKfTime + prevDelta;

        const kfInStore = anim?.keyframes.find(k => k.time === prevKfTime);
        if (kfInStore) {
          store.removeKeyframe(sel.layerId, sel.propName, prevKfTime);
          store.addKeyframe(sel.layerId, sel.propName, { ...kfInStore, time: Math.max(0, currentKfTime) });
        }
        newSelections.push({ layerId: sel.layerId, propName: sel.propName, time: origKfTime });
      }

      setKfDrag(prev => prev ? { ...prev, kfData: { ...prev.kfData, time: newTime } } : null);
      setCurrentFrame(newTime);
    };

    const handleUp = () => {
      // ドラッグ終了時に選択を更新
      if (kfDrag) {
        const actualDelta = kfDrag.kfData.time - kfDrag.origTime;
        setSelectedKfs(prev => prev.map(s => ({ ...s, time: s.time + actualDelta })));
      }
      setKfDrag(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [kfDrag, zoom, setCurrentFrame, selectedKfs, currentFrame]);

  // キーフレームクリップボード
  const [kfClipboard, setKfClipboard] = useState<{
    kfs: { layerId: string; propName: string; kf: Keyframe; relativeTime: number }[];
  } | null>(null);

  // 選択中KFのDelete削除 + コピー&ペースト（captureフェーズでレイヤー削除を防ぐ）
  useEffect(() => {
    if (selectedKfs.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Delete/Backspace: キーフレーム削除
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        useLayerStore.getState().saveSnapshot();
        for (const sel of selectedKfs) {
          removeKeyframe(sel.layerId, sel.propName, sel.time);
        }
        setSelectedKfs([]);
        return;
      }

      // Ctrl+C: キーフレームコピー
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        const store = useLayerStore.getState();
        const minTime = Math.min(...selectedKfs.map(s => s.time));
        const copied = selectedKfs.map(sel => {
          const kf = store.animations[sel.layerId]?.[sel.propName]?.keyframes
            .find(k => k.time === sel.time);
          return kf ? {
            layerId: sel.layerId,
            propName: sel.propName,
            kf: JSON.parse(JSON.stringify(kf)) as Keyframe,
            relativeTime: sel.time - minTime,
          } : null;
        }).filter(Boolean) as { layerId: string; propName: string; kf: Keyframe; relativeTime: number }[];
        if (copied.length > 0) {
          setKfClipboard({ kfs: copied });
        }
        return;
      }

      // Ctrl+V: キーフレームペースト（現在フレームを基準にオフセット）
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && kfClipboard) {
        e.preventDefault();
        e.stopPropagation();
        useLayerStore.getState().saveSnapshot();
        const pasteFrame = useTimelineStore.getState().currentFrame;
        for (const item of kfClipboard.kfs) {
          const newKf: Keyframe = {
            ...JSON.parse(JSON.stringify(item.kf)),
            time: pasteFrame + item.relativeTime,
          };
          useLayerStore.getState().addKeyframe(item.layerId, item.propName, newKf);
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedKfs, removeKeyframe, kfClipboard]);

  // ズーム後のscrollLeft調整用ref
  const pendingScrollLeftRef = useRef<number | null>(null);

  // DOMコミット直後に同期的にscrollLeftを適用（ちらつき防止）
  useLayoutEffect(() => {
    const el = trackContainerRef.current;
    if (!el) return;
    if (pendingScrollLeftRef.current !== null) {
      el.scrollLeft = pendingScrollLeftRef.current;
      setNavScrollLeft(pendingScrollLeftRef.current);
      pendingScrollLeftRef.current = null;
    } else if (Math.abs(el.scrollLeft - navScrollLeft) > 1) {
      // ブラウザの自動クランプを検出して同期
      setNavScrollLeft(el.scrollLeft);
    }
  });

  // ズーム（ホイール） - プレイヘッド基準
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const el = trackContainerRef.current;
      if (!el) return;

      const fitZoom = calcFitZoom();
      const newZoom = Math.max(fitZoom, zoom + (e.deltaY > 0 ? -1 : 1));
      if (Math.abs(newZoom - zoom) < 0.01) return;

      // フィットzoomに戻ったら自動フィットを再有効化
      userZoomedRef.current = newZoom > fitZoom + 0.01;

      // プレイヘッドのビューポート内位置を保持
      const playheadOldX = currentFrame * zoom;
      const viewOffset = playheadOldX - el.scrollLeft;
      const playheadNewX = currentFrame * newZoom;
      pendingScrollLeftRef.current = Math.max(0, playheadNewX - viewOffset);
      setNavScrollLeft(pendingScrollLeftRef.current);

      setZoom(newZoom);
    }
  };

  // ── 縦スクロール同期 ──
  const handleLayersScroll = useCallback(() => {
    if (scrollSyncSource.current === 'tracks') {
      scrollSyncSource.current = null;
      return;
    }
    scrollSyncSource.current = 'layers';
    const layers = layersScrollRef.current;
    const tracks = tracksRef.current;
    if (layers && tracks) {
      tracks.scrollTop = layers.scrollTop;
    }
  }, []);

  const handleTracksScroll = useCallback(() => {
    if (scrollSyncSource.current === 'layers') {
      scrollSyncSource.current = null;
      return;
    }
    scrollSyncSource.current = 'tracks';
    const layers = layersScrollRef.current;
    const tracks = tracksRef.current;
    if (layers && tracks) {
      layers.scrollTop = tracks.scrollTop;
    }
  }, []);

  // ── 再生時オートスクロール（全体表示のため不要だが将来用に残す） ──

  // ルーラーの目盛り生成
  const renderRuler = () => {
    const ticks: React.JSX.Element[] = [];
    const endFrame = totalFrames();
    const startFrame = 0;

    // 目盛り間隔を自動調整
    let step = 1;
    const pixelsPerFrame = zoom;
    if (pixelsPerFrame < 2) step = 30;
    else if (pixelsPerFrame < 4) step = 15;
    else if (pixelsPerFrame < 8) step = 10;
    else if (pixelsPerFrame < 15) step = 5;

    for (let f = startFrame - (startFrame % step); f <= endFrame; f += step) {
      if (f < 0) continue;
      const x = frameToX(f);
      const isMajor = f % (step * 5) === 0 || f % Math.round(settings.fps) === 0;

      ticks.push(
        <div
          key={f}
          className={`ruler-tick ${isMajor ? 'ruler-tick-major' : 'ruler-tick-minor'}`}
          style={{ left: x }}
        />,
      );

      if (isMajor) {
        const sec = f / settings.fps;
        const label = sec >= 60
          ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
          : `${sec.toFixed(sec % 1 === 0 ? 0 : 1)}s`;
        ticks.push(
          <span key={`label-${f}`} className="ruler-label" style={{ left: x }}>
            {label}
          </span>,
        );
      }
    }
    return ticks;
  };

  // マウスベースのレイヤー並べ替え
  const layersScrollRef = useRef<HTMLDivElement>(null);
  const dragFromRef = useRef<number | null>(null);
  const dragToRef = useRef<number | null>(null);

  const handleLayerReorderStart = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    setDragLayerIndex(index);
    dragFromRef.current = index;
    dragToRef.current = index;

    const scrollEl = layersScrollRef.current;
    if (!scrollEl) return;
    const rows = scrollEl.querySelectorAll('.layer-row-wrap');
    const rowHeight = (rows[0] as HTMLElement)?.offsetHeight || 28;
    const scrollRect = scrollEl.getBoundingClientRect();

    const onMove = (me: MouseEvent) => {
      const relY = me.clientY - scrollRect.top + scrollEl.scrollTop;
      const targetIdx = Math.max(0, Math.min(layers.length - 1, Math.floor(relY / rowHeight)));
      dragToRef.current = targetIdx;
      setDragOverIndex(targetIdx);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const from = dragFromRef.current;
      const to = dragToRef.current;
      if (from !== null && to !== null && from !== to) {
        useLayerStore.getState().saveSnapshot();
        useLayerStore.getState().reorderLayer(from, to);
      }
      setDragLayerIndex(null);
      setDragOverIndex(null);
      dragFromRef.current = null;
      dragToRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // クリップのマウスダウン（移動 or トリム開始）
  const handleClipMouseDown = (e: React.MouseEvent, layer: typeof layers[0]) => {
    e.stopPropagation();
    selectLayer(layer.id);

    if (layer.locked) return;

    useLayerStore.getState().saveSnapshot();

    const clipWidth = (layer.outPoint - layer.inPoint) * zoom;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = e.clientX - rect.left;

    // 左端5pxはトリムエリア
    let type: 'move' | 'trimLeft' | 'trimRight' = 'move';
    if (relX < 5) type = 'trimLeft';
    else if (relX > clipWidth - 5) type = 'trimRight';

    setClipDrag({
      layerId: layer.id,
      type,
      startX: e.clientX,
      origIn: layer.inPoint,
      origOut: layer.outPoint,
    });
  };


  // レイヤーのアニメーションプロパティ名を取得
  const getAnimatedProps = (layerId: string): string[] => {
    const layerAnim = animations[layerId];
    if (!layerAnim) return [];
    return Object.entries(layerAnim)
      .filter(([, prop]) => prop.keyframes.length > 0)
      .map(([name]) => name);
  };

  // 全トランスフォームプロパティ
  const TRANSFORM_PROPS = ['anchorPoint', 'position', 'scale', 'rotation', 'opacity'];
  const TEXT_PROPS = ['text.fontSize', 'text.fontWeight', 'text.lineHeight', 'text.letterSpacing'];
  const SHAPE_PROPS = ['shape.fillOpacity', 'shape.strokeWidth', 'shape.cornerRadius'];

  // レイヤータイプに応じたプロパティ一覧を取得
  const getAllPropsForLayer = (layerId: string): string[] => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return TRANSFORM_PROPS;
    const props = [...TRANSFORM_PROPS];
    if (layer.type === 'text' && layer.textStyle) props.push(...TEXT_PROPS);
    if (layer.type === 'shape' && layer.shapeData) props.push(...SHAPE_PROPS);
    return props;
  };

  // 表示するプロパティ一覧を取得（Uキー対応）
  const getDisplayProps = (layerId: string): string[] => {
    if (showOnlyKeyframed) {
      return getAnimatedProps(layerId);
    }
    return getAllPropsForLayer(layerId);
  };

  // プロパティ名の日本語ラベル
  const propLabel = (name: string): string => {
    const map: Record<string, string> = {
      position: '位置', scale: 'スケール', rotation: '回転',
      opacity: '不透明度', anchorPoint: 'アンカー',
      'text.fontSize': 'サイズ', 'text.fontWeight': '太さ',
      'text.lineHeight': '行間', 'text.letterSpacing': '文字間隔',
      'shape.fillOpacity': '塗り不透明度', 'shape.strokeWidth': '線幅',
      'shape.cornerRadius': '角丸',
    };
    return map[name] || name;
  };

  // プロパティ名から現在の値を取得
  const getPropValue = (layer: typeof layers[0], propName: string): number | number[] => {
    // テキスト系
    if (propName.startsWith('text.') && layer.textStyle) {
      const field = propName.replace('text.', '') as keyof typeof layer.textStyle;
      return layer.textStyle[field] as number;
    }
    // シェイプ系
    if (propName.startsWith('shape.') && layer.shapeData) {
      const field = propName.replace('shape.', '') as keyof typeof layer.shapeData;
      return (layer.shapeData[field] as number) ?? 0;
    }
    // トランスフォーム
    const transform = layer.transform;
    const val = transform[propName as keyof typeof transform];
    return Array.isArray(val) ? [...val] : val as number;
  };

  const handleAddLayerWithSnapshot = (type: Parameters<typeof addLayer>[0]) => {
    useLayerStore.getState().saveSnapshot();
    addLayer(type);
  };

  return (
    <div className="timeline" onWheel={handleWheel}>
      <div className="timeline-header">
        <span className="timeline-header-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <line x1="2" y1="8" x2="22" y2="8" />
            <line x1="8" y1="2" x2="8" y2="22" />
          </svg>
          タイムライン
        </span>
        <div className="timeline-header-spacer" />
        <div className="add-layer-area">
          <button className="add-layer-btn" onClick={() => handleAddLayerWithSnapshot('solid')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            ソリッド
          </button>
          <button className="add-layer-btn" onClick={() => handleAddLayerWithSnapshot('text')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            テキスト
          </button>
          <button className="add-layer-btn" onClick={() => handleAddLayerWithSnapshot('shape')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            シェイプ
          </button>
        </div>
      </div>

      {/* ナビゲーター（ズームスライダー） - スクロールコンテナの外 */}
      <div className="timeline-navigator-row">
        <div className="timeline-navigator-spacer" />
        <TimelineNavigator
          trackContainerRef={trackContainerRef}
          totalFrames={totalFrames()}
          zoom={zoom}
          setZoom={setZoom}
          userZoomedRef={userZoomedRef}
          calcFitZoom={calcFitZoom}
          pendingScrollLeftRef={pendingScrollLeftRef}
          navScrollLeft={navScrollLeft}
        />
      </div>

      <div className="timeline-body">
        {/* 左側: レイヤーリスト */}
        <div className="timeline-layers">
          <div className="timeline-layers-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)' }}>
              レイヤー ({layers.length})
            </span>
          </div>
          <div className="timeline-layers-scroll" ref={layersScrollRef} onScroll={handleLayersScroll}>
            {layers.map((layer, idx) => (
            <React.Fragment key={layer.id}>
              <div className="layer-row-wrap">
              <div
                className={`layer-row${selectedLayerIds.includes(layer.id) ? ' selected' : ''}${dragOverIndex === idx ? ' drag-over' : ''}${dragLayerIndex === idx ? ' dragging' : ''}${layer.parentId ? ' has-parent' : ''}`}
                onClick={(e) => selectLayer(layer.id, e.ctrlKey || e.metaKey)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!selectedLayerIds.includes(layer.id)) selectLayer(layer.id);
                  const store = useLayerStore.getState();
                  const tl = useTimelineStore.getState();
                  showContextMenu(e.clientX, e.clientY, [
                    { label: '複製', shortcut: 'Ctrl+D', action: () => { store.saveSnapshot(); store.duplicateLayer(layer.id); } },
                    { label: '削除', shortcut: 'Delete', action: () => { store.saveSnapshot(); store.removeLayer(layer.id); }, separator: true },
                    { label: '分割', shortcut: 'Ctrl+Shift+D', action: () => { store.splitLayer(tl.currentFrame); }, separator: true },
                    { label: layer.solo ? 'ソロ解除' : 'ソロ', action: () => store.toggleSolo(layer.id) },
                    { label: layer.locked ? 'ロック解除' : 'ロック', action: () => store.toggleLock(layer.id) },
                  ]);
                }}
              >
                <div
                  className="layer-color-tag"
                  style={{ background: layer.labelColor || getLayerColor(layer.type) }}
                />
                <button
                  className={`layer-visibility-btn${layer.visible ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
                  title={layer.visible ? '非表示にする' : '表示する'}
                >
                  {layer.visible ? (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z" />
                    </svg>
                  )}
                </button>
                <button
                  className={`layer-lock-btn${layer.locked ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleLock(layer.id); }}
                  title={layer.locked ? 'ロック解除' : 'ロック'}
                >
                  {layer.locked ? (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                      <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z" />
                    </svg>
                  )}
                </button>
                <span
                  className="layer-name"
                  onMouseDown={(e) => handleLayerReorderStart(e, idx)}
                  style={{ cursor: 'grab' }}
                >
                  {layer.name}
                  {layer.parentId && (
                    <span className="layer-parent-badge" title={`親: ${layers.find(l => l.id === layer.parentId)?.name || '?'}`}>
                      ↗
                    </span>
                  )}
                  {layers.some(l => l.parentId === layer.id) && (
                    <span className="layer-children-count" title="子レイヤーあり">
                      {layers.filter(l => l.parentId === layer.id).length}
                    </span>
                  )}
                </span>
                {/* モーションブラートグル */}
                <button
                  className={`layer-lock-btn${layer.motionBlur ? ' active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    useLayerStore.getState().updateLayer(layer.id, { motionBlur: !layer.motionBlur });
                  }}
                  title={layer.motionBlur ? 'モーションブラー OFF' : 'モーションブラー ON'}
                  style={layer.motionBlur ? { color: '#60a5fa' } : undefined}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                </button>
                {/* 展開トグル */}
                <button
                  className="layer-expand-btn"
                  onClick={(e) => { e.stopPropagation(); toggleExpandLayer(layer.id); }}
                  title="プロパティを展開"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"
                    style={{ transform: expandedLayerIds.includes(layer.id) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                    <path d="M10 6L16 12L10 18" />
                  </svg>
                </button>
              </div>
              {/* 展開されたプロパティ行 */}
              {expandedLayerIds.includes(layer.id) && getDisplayProps(layer.id)
                .map((propName) => {
                  const hasKf = (animations[layer.id]?.[propName]?.keyframes.length ?? 0) > 0;
                  const hasKfAtCurrent = animations[layer.id]?.[propName]?.keyframes.some(kf => kf.time === currentFrame) || false;
                  return (
                    <div key={`${layer.id}-${propName}`} className="layer-prop-row">
                      <div className="layer-prop-indent" />
                      <button
                        className={`layer-prop-stopwatch${hasKf ? ' active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasKfAtCurrent) {
                            // 現在フレームのKFを削除
                            removeKeyframe(layer.id, propName, currentFrame);
                          } else {
                            // 現在フレームにKFを追加
                            const val = getPropValue(layer, propName);
                            const kf: Keyframe = {
                              time: currentFrame,
                              value: Array.isArray(val) ? [...val] : val as number,
                              interpolation: 'bezier',
                              bezierPoints: EASING_PRESETS.easeInOut,
                            };
                            addKeyframe(layer.id, propName, kf);
                          }
                        }}
                        title={hasKfAtCurrent ? 'キーフレーム削除' : 'キーフレーム追加'}
                      >
                        <svg viewBox="0 0 12 12" width="8" height="8">
                          <rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)"
                            fill={hasKfAtCurrent ? 'var(--color-keyframe)' : 'none'}
                            stroke={hasKf ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.5"
                          />
                        </svg>
                      </button>
                      <span className={`layer-prop-name${hasKf ? ' animated' : ''}`}>{propLabel(propName)}</span>
                    </div>
                  );
                })
              }
              </div>
            </React.Fragment>
            ))}
            {layers.length === 0 && (
              <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <p>レイヤーを追加してスタート</p>
              </div>
            )}
          </div>
        </div>

        {/* 右側: トラック */}
        <div className="timeline-tracks" ref={trackContainerRef} onScroll={() => setNavScrollLeft(trackContainerRef.current?.scrollLeft || 0)}>
          <div
            ref={rulerRef}
            className="timeline-ruler"
            style={{ minWidth: totalContentWidth }}
            onMouseDown={handleRulerMouseDown}
          >
            {renderRuler()}
            {/* ワークエリアバー */}
            {workAreaIn !== null && workAreaOut !== null && workAreaIn < workAreaOut && (
              <div
                className="work-area-bar"
                style={{
                  position: 'absolute',
                  left: frameToX(workAreaIn),
                  width: (workAreaOut - workAreaIn) * zoom,
                  top: 0,
                  height: '100%',
                  background: 'rgba(59, 130, 246, 0.2)',
                  borderLeft: '2px solid #3b82f6',
                  borderRight: '2px solid #3b82f6',
                  pointerEvents: 'auto',
                  cursor: 'grab',
                  zIndex: 1,
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  useTimelineStore.getState().clearWorkArea();
                }}
                title="ワークエリア（ダブルクリックでクリア）"
              />
            )}
            {/* プレイヘッド（ルーラー上） */}
            <div
              className="playhead"
              style={{ left: frameToX(currentFrame), top: 0, bottom: 0 }}
            />
          </div>

          <div ref={tracksRef} className="timeline-tracks-scroll" style={{ minWidth: totalContentWidth }} onScroll={handleTracksScroll}>
            {layers.map((layer) => {
              const clipLeft = frameToX(layer.inPoint);
              const clipWidth = (layer.outPoint - layer.inPoint) * zoom;

              return (
                <React.Fragment key={layer.id}>
                <div className="track-row">
                  <div
                    className={`track-clip${selectedLayerIds.includes(layer.id) ? ' selected' : ''}`}
                    style={{
                      left: clipLeft,
                      width: Math.max(clipWidth, 4),
                      background: `${getLayerColor(layer.type)}44`,
                      borderLeftColor: getLayerColor(layer.type),
                      borderLeftWidth: 3,
                      borderLeftStyle: 'solid',
                      cursor: layer.locked ? 'default' : 'move',
                    }}
                    onMouseDown={(e) => handleClipMouseDown(e, layer)}
                  >
                    {/* トリムハンドル左 */}
                    {!layer.locked && (
                      <div
                        className="trim-handle trim-handle-left"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          selectLayer(layer.id);
                          useLayerStore.getState().saveSnapshot();
                          setClipDrag({
                            layerId: layer.id,
                            type: 'trimLeft',
                            startX: e.clientX,
                            origIn: layer.inPoint,
                            origOut: layer.outPoint,
                          });
                        }}
                      />
                    )}
                    <span className="track-clip-label">{layer.name}</span>
                    {/* トリムハンドル右 */}
                    {!layer.locked && (
                      <div
                        className="trim-handle trim-handle-right"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          selectLayer(layer.id);
                          useLayerStore.getState().saveSnapshot();
                          setClipDrag({
                            layerId: layer.id,
                            type: 'trimRight',
                            startX: e.clientX,
                            origIn: layer.inPoint,
                            origOut: layer.outPoint,
                          });
                        }}
                      />
                    )}
                  </div>

                </div>

                {/* 展開されたプロパティ行のトラック */}
                {expandedLayerIds.includes(layer.id) && getDisplayProps(layer.id)
                  .map((propName) => {
                    const propAnim = animations[layer.id]?.[propName];
                    return (
                      <div key={`track-${layer.id}-${propName}`} className="track-row track-prop-row">
                        {propAnim && propAnim.keyframes.map((kf) => {
                          const x = frameToX(kf.time);
                          const selected = isKfSelected(layer.id, propName, kf.time);
                          const interpClass = kf.interpolation === 'hold' ? ' kf-hold' : kf.interpolation === 'linear' ? ' kf-linear' : '';
                          return (
                            <div
                              key={`pkf-${layer.id}-${propName}-${kf.time}`}
                              className={`keyframe-diamond prop-diamond${interpClass}${kf.time === currentFrame ? ' at-playhead' : ''}${selected ? ' selected' : ''}`}
                              style={{ left: x - 4 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentFrame(kf.time);
                                toggleKfSelection({ layerId: layer.id, propName, time: kf.time }, e.shiftKey || e.ctrlKey || e.metaKey);
                              }}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                const kfSel = { layerId: layer.id, propName, time: kf.time };
                                if (!selected && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                                  setSelectedKfs([kfSel]);
                                } else if (!selected) {
                                  setSelectedKfs(prev => [...prev, kfSel]);
                                }
                                useLayerStore.getState().saveSnapshot();
                                setKfDrag({
                                  layerId: layer.id,
                                  propName,
                                  origTime: kf.time,
                                  startX: e.clientX,
                                  kfData: { ...kf },
                                });
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const kfSel = { layerId: layer.id, propName, time: kf.time };
                                if (!selected) setSelectedKfs([kfSel]);
                                const targetKfs = selected ? selectedKfs : [kfSel];
                                useUIStore.getState().showContextMenu(e.clientX, e.clientY, [
                                  {
                                    label: `削除 (${targetKfs.length})`,
                                    shortcut: 'Del',
                                    action: () => {
                                      for (const s of targetKfs) {
                                        removeKeyframe(s.layerId, s.propName, s.time);
                                      }
                                      setSelectedKfs([]);
                                    },
                                  },
                                  { label: '', action: () => {}, separator: true },
                                  {
                                    label: 'リニア',
                                    action: () => {
                                      for (const s of targetKfs) {
                                        const a = animations[s.layerId]?.[s.propName];
                                        const k = a?.keyframes.find(k2 => k2.time === s.time);
                                        if (k) addKeyframe(s.layerId, s.propName, { ...k, interpolation: 'linear', bezierPoints: undefined });
                                      }
                                    },
                                  },
                                  {
                                    label: 'ベジェ',
                                    action: () => {
                                      for (const s of targetKfs) {
                                        const a = animations[s.layerId]?.[s.propName];
                                        const k = a?.keyframes.find(k2 => k2.time === s.time);
                                        if (k) addKeyframe(s.layerId, s.propName, { ...k, interpolation: 'bezier', bezierPoints: EASING_PRESETS.easeInOut });
                                      }
                                    },
                                  },
                                  {
                                    label: 'ホールド',
                                    action: () => {
                                      for (const s of targetKfs) {
                                        const a = animations[s.layerId]?.[s.propName];
                                        const k = a?.keyframes.find(k2 => k2.time === s.time);
                                        if (k) addKeyframe(s.layerId, s.propName, { ...k, interpolation: 'hold', bezierPoints: undefined });
                                      }
                                    },
                                  },
                                  { label: '', action: () => {}, separator: true },
                                  {
                                    label: 'イージングを編集',
                                    action: () => {
                                      useUIStore.getState().openPanel('easing');
                                    },
                                  },
                                ]);
                              }}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
            {/* プレイヘッド（トラック上） */}
            <div
              className="playhead"
              style={{ left: frameToX(currentFrame) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** ナビゲーターコンポーネント */
function TimelineNavigator({
  trackContainerRef,
  totalFrames,
  zoom,
  setZoom,
  userZoomedRef,
  calcFitZoom,
  pendingScrollLeftRef,
  navScrollLeft,
}: {
  trackContainerRef: React.RefObject<HTMLDivElement | null>;
  totalFrames: number;
  zoom: number;
  setZoom: (z: number) => void;
  userZoomedRef: React.MutableRefObject<boolean>;
  calcFitZoom: () => number;
  pendingScrollLeftRef: React.MutableRefObject<number | null>;
  navScrollLeft: number;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    type: 'left' | 'right' | 'pan';
    startX: number;
    origViewStart: number;
    origViewEnd: number;
  } | null>(null);
  const [, setTick] = useState(0);

  // ナビゲーター用のコンテナ幅を状態で管理（レンダー中にrefを参照しないため）
  const [navContainerW, setNavContainerW] = useState(1);
  useEffect(() => {
    const el = trackContainerRef.current;
    if (el) setNavContainerW(el.clientWidth || 1);
  });

  // 現在の表示範囲（フレーム単位）
  const viewStart = zoom > 0 ? navScrollLeft / zoom : 0;
  const viewEnd = zoom > 0 ? (navScrollLeft + navContainerW) / zoom : totalFrames;

  // ナビゲーター上のバー位置・幅を計算（%ベース）
  const barLeftPct = totalFrames > 0 ? (viewStart / totalFrames) * 100 : 0;
  const barWidthPct = totalFrames > 0 ? Math.max(2, ((viewEnd - viewStart) / totalFrames) * 100) : 100;

  // viewStart/viewEnd からzoom+scrollLeftを適用
  const applyView = useCallback((start: number, end: number) => {
    const el = trackContainerRef.current;
    if (!el) return;
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(totalFrames, end);
    const viewFrames = Math.max(10, clampedEnd - clampedStart);
    const newZoom = Math.max(calcFitZoom(), el.clientWidth / viewFrames);
    userZoomedRef.current = newZoom > calcFitZoom() + 0.01;
    pendingScrollLeftRef.current = clampedStart * newZoom;
    setZoom(newZoom);
  }, [trackContainerRef, totalFrames, calcFitZoom, userZoomedRef, pendingScrollLeftRef, setZoom]);

  // ドラッグハンドラ
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const navEl = navRef.current;
      if (!drag || !navEl) return;
      e.preventDefault();

      const nw = navEl.clientWidth;
      const dx = e.clientX - drag.startX;
      const dFrames = (dx / nw) * totalFrames;

      if (drag.type === 'pan') {
        const range = drag.origViewEnd - drag.origViewStart;
        let newStart = drag.origViewStart + dFrames;
        newStart = Math.max(0, Math.min(totalFrames - range, newStart));
        const el = trackContainerRef.current;
        if (el) {
          el.scrollLeft = newStart * zoom;
          setTick(t => t + 1);
        }
      } else if (drag.type === 'left') {
        const newStart = Math.max(0, Math.min(drag.origViewEnd - 10, drag.origViewStart + dFrames));
        applyView(newStart, drag.origViewEnd);
      } else if (drag.type === 'right') {
        const newEnd = Math.min(totalFrames, Math.max(drag.origViewStart + 10, drag.origViewEnd + dFrames));
        applyView(drag.origViewStart, newEnd);
      }
    };

    const handleUp = () => {
      dragRef.current = null;
      setTick(t => t + 1);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [totalFrames, zoom, applyView, trackContainerRef]);

  const startDrag = (e: React.MouseEvent, type: 'left' | 'right' | 'pan') => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      type,
      startX: e.clientX,
      origViewStart: viewStart,
      origViewEnd: viewEnd,
    };
  };

  // ダブルクリックでフィットリセット
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    userZoomedRef.current = false;
    setZoom(calcFitZoom());
    const el = trackContainerRef.current;
    if (el) el.scrollLeft = 0;
  };

  // 背景クリックでジャンプ
  const handleBgMouseDown = (e: React.MouseEvent) => {
    const navEl = navRef.current;
    const el = trackContainerRef.current;
    if (!navEl || !el) return;
    const rect = navEl.getBoundingClientRect();
    const clickPct = (e.clientX - rect.left) / rect.width;
    const clickFrame = clickPct * totalFrames;
    const viewFrames = viewEnd - viewStart;
    const newStart = Math.max(0, Math.min(totalFrames - viewFrames, clickFrame - viewFrames / 2));
    el.scrollLeft = newStart * zoom;
    setTick(t => t + 1);
  };

  return (
    <div
      ref={navRef}
      className="timeline-navigator"
      onMouseDown={handleBgMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="timeline-navigator-bar"
        style={{ left: `${barLeftPct}%`, width: `${barWidthPct}%` }}
        onMouseDown={(e) => startDrag(e, 'pan')}
      >
        <div
          className="timeline-navigator-handle timeline-navigator-handle-left"
          onMouseDown={(e) => startDrag(e, 'left')}
        />
        <div
          className="timeline-navigator-handle timeline-navigator-handle-right"
          onMouseDown={(e) => startDrag(e, 'right')}
        />
      </div>
    </div>
  );
}

