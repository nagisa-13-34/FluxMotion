import { useRef, useEffect, useCallback, useState } from 'react';
import { useLayerStore, getLayerColor } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useProjectStore } from '../../stores/projectStore';

export function Timeline() {
  const layers = useLayerStore((s) => s.layers);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const selectLayer = useLayerStore((s) => s.selectLayer);
  const toggleVisibility = useLayerStore((s) => s.toggleVisibility);
  const toggleLock = useLayerStore((s) => s.toggleLock);
  const addLayer = useLayerStore((s) => s.addLayer);
  const animations = useLayerStore((s) => s.animations);

  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const setCurrentFrame = useTimelineStore((s) => s.setCurrentFrame);
  const zoom = useTimelineStore((s) => s.zoom);
  const setZoom = useTimelineStore((s) => s.setZoom);
  const scrollFrame = useTimelineStore((s) => s.scrollFrame);

  const settings = useProjectStore((s) => s.settings);
  const totalFrames = useProjectStore((s) => s.totalFrames);

  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  // レイヤー並べ替え用
  const [dragLayerIndex, setDragLayerIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // レイヤーバー（inPoint/outPoint）ドラッグ用
  const [clipDrag, setClipDrag] = useState<{
    layerId: string;
    type: 'move' | 'trimLeft' | 'trimRight';
    startX: number;
    origIn: number;
    origOut: number;
  } | null>(null);

  // フレーム→ピクセル変換
  const frameToX = useCallback(
    (frame: number) => (frame - scrollFrame) * zoom,
    [zoom, scrollFrame],
  );

  // ピクセル→フレーム変換
  const xToFrame = useCallback(
    (x: number) => Math.round(x / zoom + scrollFrame),
    [zoom, scrollFrame],
  );

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

  // ズーム（ホイール）
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(zoom + (e.deltaY > 0 ? -1 : 1));
    }
  };

  // ルーラーの目盛り生成
  const renderRuler = () => {
    const ticks: React.JSX.Element[] = [];
    const trackWidth = rulerRef.current?.offsetWidth || 800;
    const startFrame = Math.max(0, Math.floor(scrollFrame));
    const endFrame = Math.ceil(scrollFrame + trackWidth / zoom);

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

  // ドラッグ＆ドロップでレイヤー並べ替え
  const handleLayerDragStart = (index: number) => {
    setDragLayerIndex(index);
  };
  const handleLayerDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const handleLayerDrop = (index: number) => {
    if (dragLayerIndex !== null && dragLayerIndex !== index) {
      useLayerStore.getState().saveSnapshot();
      useLayerStore.getState().reorderLayer(dragLayerIndex, index);
    }
    setDragLayerIndex(null);
    setDragOverIndex(null);
  };
  const handleLayerDragEnd = () => {
    setDragLayerIndex(null);
    setDragOverIndex(null);
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

  // キーフレームダイヤモンドを取得
  const getKeyframeTimes = (layerId: string): number[] => {
    const layerAnim = animations[layerId];
    if (!layerAnim) return [];
    const times = new Set<number>();
    for (const prop of Object.values(layerAnim)) {
      for (const kf of prop.keyframes) {
        times.add(kf.time);
      }
    }
    return Array.from(times).sort((a, b) => a - b);
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
          <div className="timeline-layers-scroll">
            {layers.map((layer, idx) => (
              <div
                key={layer.id}
                className={`layer-row${selectedLayerIds.includes(layer.id) ? ' selected' : ''}${dragOverIndex === idx ? ' drag-over' : ''}`}
                onClick={(e) => selectLayer(layer.id, e.ctrlKey || e.metaKey)}
                draggable
                onDragStart={() => handleLayerDragStart(idx)}
                onDragOver={(e) => handleLayerDragOver(e, idx)}
                onDrop={() => handleLayerDrop(idx)}
                onDragEnd={handleLayerDragEnd}
              >
                <div
                  className="layer-color-tag"
                  style={{ background: getLayerColor(layer.type) }}
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
                <span className="layer-name">{layer.name}</span>
              </div>
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
        <div className="timeline-tracks">
          <div
            ref={rulerRef}
            className="timeline-ruler"
            onMouseDown={handleRulerMouseDown}
          >
            {renderRuler()}
            {/* プレイヘッド（ルーラー上） */}
            <div
              className="playhead"
              style={{ left: frameToX(currentFrame), top: 0, bottom: 0 }}
            />
          </div>

          <div ref={tracksRef} className="timeline-tracks-scroll">
            {layers.map((layer) => {
              const clipLeft = frameToX(layer.inPoint);
              const clipWidth = (layer.outPoint - layer.inPoint) * zoom;
              const kfTimes = getKeyframeTimes(layer.id);

              return (
                <div key={layer.id} className="track-row">
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

                  {/* キーフレームダイヤモンド */}
                  {kfTimes.map((time) => {
                    const x = frameToX(time);
                    return (
                      <div
                        key={`kf-${layer.id}-${time}`}
                        className={`keyframe-diamond${time === currentFrame ? ' selected' : ''}`}
                        style={{ left: x - 4 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentFrame(time);
                          selectLayer(layer.id);
                        }}
                      />
                    );
                  })}
                </div>
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
