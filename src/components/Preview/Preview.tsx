import { useEffect, useRef, useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { Renderer } from '../../stores/engine/renderer';
import { WebGPURenderer, isWebGPUSupported } from '../../stores/engine/webgpuRenderer';
import { interpolateValue } from '../../stores/engine/keyframe';
import { resolveOverlayWorldTransform } from '../../stores/engine/overlayTransform';
import type { Layer } from '../../types/layer';

interface PreviewProps {
  onRenderReady: (callback: () => void) => void;
}

export function Preview({ onRenderReady }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // WebGPU用のCanvas（Canvas2DとWebGPUは同じcanvasで共存できないので別に持つ）
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const gpuRendererRef = useRef<WebGPURenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const settings = useProjectStore((s) => s.settings);
  const layers = useLayerStore((s) => s.layers);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const animations = useLayerStore((s) => s.animations);
  const viewportZoom = useUIStore((s) => s.viewportZoom);
  const setViewportZoom = useUIStore((s) => s.setViewportZoom);
  const activeTool = useUIStore((s) => s.activeTool);
  const activeShapeType = useUIStore((s) => s.activeShapeType);
  const setTool = useUIStore((s) => s.setTool);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  // テキスト編集のインライン状態
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // レンダラーモード
  const [rendererMode, setRendererMode] = useState<'canvas2d' | 'webgpu'>('canvas2d');
  const [gpuAvailable, setGpuAvailable] = useState(false);

  // シェイプ描画用のstate
  const [shapeDraw, setShapeDraw] = useState<{
    drawing: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // スナップライン表示
  const [snapLines, setSnapLines] = useState<{ axis: 'x' | 'y'; pos: number }[]>([]);
  const showGrid = useUIStore((s) => s.showGrid);
  const gridSize = useUIStore((s) => s.gridSize);

  const scale = viewportZoom / 100;
  const canvasWidth = Math.round(settings.width * scale);
  const canvasHeight = Math.round(settings.height * scale);

  // Fit: コンテナサイズに合わせたズーム率を計算
  const calcFitZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 50;
    const cw = container.clientWidth - 32; // padding分
    const ch = container.clientHeight - 32;
    if (cw <= 0 || ch <= 0) return 50;
    const zoomW = (cw / settings.width) * 100;
    const zoomH = (ch / settings.height) * 100;
    return Math.floor(Math.min(zoomW, zoomH));
  }, [settings.width, settings.height]);

  // コンポサイズ変更時に自動Fit
  useEffect(() => {
    // 少し遅延させてコンテナのリサイズを待つ
    const timer = setTimeout(() => {
      setViewportZoom(calcFitZoom());
    }, 50);
    return () => clearTimeout(timer);
  }, [settings.width, settings.height, calcFitZoom, setViewportZoom]);

  // WebGPU対応チェック＆初期化
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await isWebGPUSupported();
      if (cancelled) return;
      setGpuAvailable(supported);
      // WebGPUが使えてもデフォルトはCanvas2D（ユーザーが切り替え可能）
    })();
    return () => { cancelled = true; };
  }, []);

  // Canvas2Dレンダラー初期化
  useEffect(() => {
    if (rendererMode !== 'canvas2d' || !canvasRef.current) return;
    const renderer = new Renderer(canvasRef.current, settings.width, settings.height);
    renderer.backgroundColor = settings.backgroundColor;
    renderer.fps = settings.fps;
    rendererRef.current = renderer;
    gpuRendererRef.current = null;
    // 初期化直後に再描画
    requestAnimationFrame(() => render());
  }, [rendererMode, settings.width, settings.height, settings.backgroundColor, settings.fps]);

  // WebGPUレンダラー初期化
  useEffect(() => {
    if (rendererMode !== 'webgpu' || !gpuCanvasRef.current) return;
    let cancelled = false;
    const gpu = new WebGPURenderer(gpuCanvasRef.current, settings.width, settings.height);
    gpu.backgroundColor = settings.backgroundColor;
    (async () => {
      const ok = await gpu.init();
      if (cancelled) return;
      if (ok) {
        gpuRendererRef.current = gpu;
        rendererRef.current = null;
      } else {
        // フォールバック
        console.warn('WebGPU init failed, falling back to Canvas2D');
        setRendererMode('canvas2d');
      }
    })();
    return () => {
      cancelled = true;
      gpu.destroy();
    };
  }, [rendererMode, settings.width, settings.height, settings.backgroundColor]);

  // 描画関数
  const render = useCallback(() => {
    const state = useLayerStore.getState();
    const allLayers = state.layers;
    const animations = state.animations;
    const frame = useTimelineStore.getState().currentFrame;
    const editId = editingLayerId;
    const renderLayers = editId
      ? allLayers.filter(l => l.id !== editId)
      : allLayers;

    if (rendererMode === 'webgpu' && gpuRendererRef.current?.isReady) {
      gpuRendererRef.current.renderFrame(renderLayers, frame, animations);
    } else if (rendererRef.current) {
      const playing = useTimelineStore.getState().isPlaying;
      rendererRef.current.renderFrame(renderLayers, frame, animations, { disableMotionBlur: !playing });
    }
  }, [editingLayerId, rendererMode]);

  useEffect(() => {
    onRenderReady(render);
  }, [onRenderReady, render]);

  useEffect(() => {
    const unsubLayers = useLayerStore.subscribe(() => render());
    const unsubTimeline = useTimelineStore.subscribe(() => render());
    render();
    return () => { unsubLayers(); unsubTimeline(); };
  }, [render]);

  // ズーム（ホイール）
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -5 : 5;
    setViewportZoom(viewportZoom + delta);
  };

  // キャンバスをクリック → 選択解除
  const handleCanvasClick = () => {
    if (!editingLayerId && activeTool === 'select') {
      useLayerStore.getState().deselectAll();
    }
  };

  // シェイプ描画: マウスダウン
  const handleShapeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'shape') return;
    e.preventDefault();
    const container = e.currentTarget;
    // キャンバスはcontainer内の最初の子div（position: relative）
    const canvasDiv = container.firstElementChild as HTMLElement | null;
    if (!canvasDiv) return;
    const canvasRect = canvasDiv.getBoundingClientRect();
    const x = e.clientX - canvasRect.left;
    const y = e.clientY - canvasRect.top;
    setShapeDraw({ drawing: true, startX: x, startY: y, currentX: x, currentY: y });

    const handleMove = (ev: MouseEvent) => {
      setShapeDraw(prev => prev ? { ...prev, currentX: ev.clientX - canvasRect.left, currentY: ev.clientY - canvasRect.top } : null);
    };

    const handleUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);

      const endX = ev.clientX - canvasRect.left;
      const endY = ev.clientY - canvasRect.top;

      // コンポ座標に変換
      const compX1 = (Math.min(x, endX)) / scale;
      const compY1 = (Math.min(y, endY)) / scale;
      const compW = Math.abs(endX - x) / scale;
      const compH = Math.abs(endY - y) / scale;

      // 最小サイズチェック
      if (compW > 5 && compH > 5) {
        const shapeType = useUIStore.getState().activeShapeType;
        useLayerStore.getState().saveSnapshot();
        useLayerStore.getState().addLayer('shape', {
          shapeData: {
            shapeType,
            fill: '#A29BFE',
            fillOpacity: 100,
            stroke: 'transparent',
            strokeWidth: 0,
            strokeLineCap: 'butt',
            cornerRadius: 0,
            width: Math.round(compW),
            height: Math.round(compH),
          },
          transform: {
            position: [Math.round(compX1 + compW / 2), Math.round(compY1 + compH / 2)],
            scale: [100, 100],
            rotation: 0,
            anchorPoint: [0, 0],
            opacity: 100,
          },
        });
        // 描画後は選択ツールに戻る
        setTool('select');
      }
      setShapeDraw(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [activeTool, scale, setTool]);

  // ── テキスト編集 ──
  const startTextEdit = (layer: Layer) => {
    if (layer.type !== 'text' || !layer.textStyle) return;
    setEditingLayerId(layer.id);
    setEditText(layer.textStyle.text);
    setTimeout(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }, 10);
  };

  const commitTextEdit = () => {
    if (editingLayerId) {
      const layer = useLayerStore.getState().layers.find(l => l.id === editingLayerId);
      if (layer?.textStyle) {
        useLayerStore.getState().saveSnapshot();
        useLayerStore.getState().updateLayer(editingLayerId, {
          textStyle: { ...layer.textStyle, text: editText },
        });
      }
    }
    setEditingLayerId(null);
    setEditText('');
  };

  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      setEditingLayerId(null);
      setEditText('');
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitTextEdit();
    }
  };

  // ── 表示中のレイヤー ──
  const visibleLayers = layers.filter(l =>
    l.visible && currentFrame >= l.inPoint && currentFrame <= l.outPoint,
  );

  const getLayerSize = (layer: Layer): [number, number] => {
    switch (layer.type) {
      case 'text': {
        const style = layer.textStyle;
        if (!style) return [200, 100];
        const fontSize = style.fontSize || 48;
        const text = style.text || 'T';
        const lines = text.split('\n');
        const lineHeight = fontSize * (style.lineHeight || 1.2);

        // Canvas2D measureText で正確な幅を計測
        const canvas = canvasRef.current;
        if (canvas) {
          const measureCtx = canvas.getContext('2d');
          if (measureCtx) {
            measureCtx.save();
            measureCtx.font = `${style.fontWeight || 400} ${fontSize}px "${style.fontFamily || 'Inter'}", sans-serif`;
            if (style.letterSpacing && 'letterSpacing' in measureCtx) {
              (measureCtx as any).letterSpacing = `${style.letterSpacing}px`;
            }
            const maxW = Math.max(...lines.map(line => measureCtx.measureText(line).width), 1);
            measureCtx.restore();
            return [maxW, lines.length * lineHeight];
          }
        }
        // フォールバック: Canvas未準備の場合
        const fallbackW = Math.max(...lines.map(line => {
          let w = 0;
          for (const ch of line) w += ch.charCodeAt(0) > 255 ? 1.0 : 0.6;
          return w;
        }), 1);
        return [fallbackW * fontSize, lines.length * lineHeight];
      }
      case 'shape':
        return [layer.shapeData?.width ?? 200, layer.shapeData?.height ?? 200];
      case 'solid':
        return [settings.width, settings.height];
      case 'image':
      case 'video':
        // メディアレイヤーはデフォルトでコンポジションサイズを使用
        return [settings.width, settings.height];
      case 'null':
        return [100, 100]; // AEのNull: 100×100px
      case 'precomp':
        return [settings.width, settings.height];
      default:
        return [200, 100];
    }
  };

  /** オーバーレイ用：KF補間 + 親子関係を考慮したワールドトランスフォーム解決 */
  const resolveOverlayTransform = (layer: Layer) =>
    resolveOverlayWorldTransform(layer, layers, currentFrame, animations);

  // レンダラー切り替え
  const toggleRenderer = () => {
    if (rendererMode === 'canvas2d' && gpuAvailable) {
      setRendererMode('webgpu');
    } else {
      setRendererMode('canvas2d');
    }
  };

  return (
    <div className="viewport">
      <div
        ref={containerRef}
        className="viewport-canvas-container"
        onWheel={handleWheel}
        onMouseDown={handleShapeMouseDown}
        style={{ cursor: activeTool === 'shape' ? 'crosshair' : undefined }}
      >
        {/* キャンバス + オーバーレイを同じ位置に重ねる */}
        <div style={{ position: 'relative', width: canvasWidth, height: canvasHeight }}>
          {/* Canvas2D */}
          <canvas
            ref={canvasRef}
            className="viewport-canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              display: rendererMode === 'canvas2d' ? 'block' : 'none',
            }}
            onClick={handleCanvasClick}
          />
          {/* WebGPU */}
          <canvas
            ref={gpuCanvasRef}
            className="viewport-canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              display: rendererMode === 'webgpu' ? 'block' : 'none',
            }}
            onClick={handleCanvasClick}
          />

          {/* グリッドオーバーレイ */}
          {showGrid && (
            <svg
              style={{
                position: 'absolute', top: 0, left: 0,
                width: canvasWidth, height: canvasHeight,
                pointerEvents: 'none', zIndex: 10,
              }}
              viewBox={`0 0 ${settings.width} ${settings.height}`}
            >
              <defs>
                <pattern id="grid-pattern" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                  <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid-pattern)" />
              {/* 中心線 */}
              <line x1={settings.width / 2} y1="0" x2={settings.width / 2} y2={settings.height} stroke="rgba(120,200,255,0.35)" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="0" y1={settings.height / 2} x2={settings.width} y2={settings.height / 2} stroke="rgba(120,200,255,0.35)" strokeWidth="1" strokeDasharray="4 4" />
            </svg>
          )}

          {/* スナップライン */}
          {snapLines.length > 0 && (
            <svg
              style={{
                position: 'absolute', top: 0, left: 0,
                width: canvasWidth, height: canvasHeight,
                pointerEvents: 'none', zIndex: 2,
              }}
              viewBox={`0 0 ${settings.width} ${settings.height}`}
            >
              {snapLines.map((sl, i) =>
                sl.axis === 'x'
                  ? <line key={i} x1={sl.pos} y1="0" x2={sl.pos} y2={settings.height} stroke="#f0f" strokeWidth="1" />
                  : <line key={i} x1="0" y1={sl.pos} x2={settings.width} y2={sl.pos} stroke="#f0f" strokeWidth="1" />
              )}
            </svg>
          )}

          {/* シェイプ描画プレビュー */}
          {shapeDraw && (() => {
            const x = Math.min(shapeDraw.startX, shapeDraw.currentX);
            const y = Math.min(shapeDraw.startY, shapeDraw.currentY);
            const w = Math.abs(shapeDraw.currentX - shapeDraw.startX);
            const h = Math.abs(shapeDraw.currentY - shapeDraw.startY);
            const shapeType = activeShapeType;
            return (
              <div
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  pointerEvents: 'none',
                  zIndex: 9999,
                }}
              >
                <svg width={w} height={h} style={{ overflow: 'visible' }}>
                  {shapeType === 'ellipse' ? (
                    <ellipse
                      cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2}
                      fill="rgba(162, 155, 254, 0.2)"
                      stroke="#A29BFE"
                      strokeWidth="2"
                      strokeDasharray="6 3"
                    />
                  ) : shapeType === 'star' ? (
                    <polygon
                      points={generateStarPoints(w / 2, h / 2, Math.min(w, h) / 2, Math.min(w, h) / 4, 5)}
                      fill="rgba(162, 155, 254, 0.2)"
                      stroke="#A29BFE"
                      strokeWidth="2"
                      strokeDasharray="6 3"
                    />
                  ) : (
                    <rect
                      x="0" y="0" width={w} height={h}
                      fill="rgba(162, 155, 254, 0.2)"
                      stroke="#A29BFE"
                      strokeWidth="2"
                      strokeDasharray="6 3"
                      rx="2"
                    />
                  )}
                </svg>
              </div>
            );
          })()}

          {/* レイヤーオーバーレイ（背面から前面へ描画するためリバース） */}
          {[...visibleLayers].reverse().map((layer) => {
            if (layer.type === 'adjustment') return null;

            const resolved = resolveOverlayTransform(layer);
            const sx = resolved.scale[0] / 100;
            const sy = resolved.scale[1] / 100;
            const [rawW, rawH] = getLayerSize(layer);
            const w = rawW * Math.abs(sx) * scale;
            const h = rawH * Math.abs(sy) * scale;
            // テキスト揃えに応じたX位置オフセット
            let xOffset = -w / 2; // center（デフォルト）
            if (layer.type === 'text' && layer.textStyle) {
              if (layer.textStyle.textAlign === 'left') xOffset = 0;
              else if (layer.textStyle.textAlign === 'right') xOffset = -w;
            }
            const x = resolved.position[0] * scale + xOffset;
            const y = resolved.position[1] * scale - h / 2;
            const isSelected = selectedLayerIds.includes(layer.id);
            const isEditing = editingLayerId === layer.id;

            // Nullレイヤー: 枠線+十字ターゲットのみ表示
            const isNullLayer = layer.type === 'null';

            return (
              <div
                key={layer.id}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  cursor: isEditing ? 'text' : (layer.locked ? 'default' : 'move'),
                  border: isNullLayer
                    ? (isSelected ? '1.5px dashed var(--color-accent)' : '1.5px dashed rgba(255, 255, 255, 0.4)')
                    : (isSelected
                      ? '1.5px solid var(--color-accent)'
                      : '1px solid rgba(255, 255, 255, 0.25)'),
                  borderRadius: isNullLayer ? 0 : 6,
                  boxSizing: 'border-box',
                  pointerEvents: layer.locked ? 'none' : 'auto',
                  transition: 'border-color 0.15s',
                  transform: resolved.rotation !== 0 ? `rotate(${resolved.rotation}deg)` : undefined,
                  transformOrigin: `${-xOffset}px ${h / 2}px`,
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0 || isEditing || layer.locked) return;
                  e.stopPropagation();
                  e.preventDefault();
                  
                  const store = useLayerStore.getState();
                  const alreadySelected = store.selectedLayerIds.includes(layer.id);
                  
                  // 未選択の場合は即座に選択
                  if (!alreadySelected) {
                    store.selectLayer(layer.id, e.ctrlKey || e.metaKey);
                  }

                  const startX = e.clientX;
                  const startY = e.clientY;
                  const origPos: [number, number] = [...resolved.position];
                  let moved = false;
                  document.body.style.cursor = 'move';

                  const onMove = (me: MouseEvent) => {
                    const dx = (me.clientX - startX) / scale;
                    const dy = (me.clientY - startY) / scale;
                    if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
                      moved = true;
                      useLayerStore.getState().saveSnapshot();
                    }
                    if (!moved) return;
                    let newX = Math.round((origPos[0] + dx) * 10) / 10;
                    let newY = Math.round((origPos[1] + dy) * 10) / 10;

                    // スナップ（Shiftで無効化）
                    const ui = useUIStore.getState();
                    const snappedLines: { axis: 'x' | 'y'; pos: number }[] = [];
                    if (ui.snapEnabled && !me.shiftKey) {
                      const snapThreshold = 6;
                      const cx = settings.width / 2;
                      const cy = settings.height / 2;
                      const grid = ui.gridSize;

                      // コンポ中心スナップ
                      if (Math.abs(newX - cx) < snapThreshold) { newX = cx; snappedLines.push({ axis: 'x', pos: cx }); }
                      if (Math.abs(newY - cy) < snapThreshold) { newY = cy; snappedLines.push({ axis: 'y', pos: cy }); }

                      // グリッドスナップ
                      if (ui.showGrid && snappedLines.length === 0) {
                        const nearGridX = Math.round(newX / grid) * grid;
                        const nearGridY = Math.round(newY / grid) * grid;
                        if (Math.abs(newX - nearGridX) < snapThreshold) { newX = nearGridX; snappedLines.push({ axis: 'x', pos: nearGridX }); }
                        if (Math.abs(newY - nearGridY) < snapThreshold) { newY = nearGridY; snappedLines.push({ axis: 'y', pos: nearGridY }); }
                      }
                    }
                    setSnapLines(snappedLines);

                    const newPos: [number, number] = [newX, newY];
                    const store = useLayerStore.getState();
                    store.updateTransform(layer.id, 'position', newPos);

                    // KFが存在する場合、現在フレームのKF値も更新する
                    const layerAnims = store.animations[layer.id];
                    if (layerAnims) {
                      const frame = useTimelineStore.getState().currentFrame;
                      if (layerAnims['position']?.keyframes.length) {
                        // 統合position KF
                        const existingKf = layerAnims['position'].keyframes.find(k => k.time === frame);
                        store.addKeyframe(layer.id, 'position', {
                          time: frame,
                          value: newPos,
                          interpolation: existingKf?.interpolation ?? 'bezier',
                          bezierPoints: existingKf?.bezierPoints,
                        });
                      } else {
                        // 分割次元 (position.x / position.y)
                        if (layerAnims['position.x']?.keyframes.length) {
                          const existingKf = layerAnims['position.x'].keyframes.find(k => k.time === frame);
                          store.addKeyframe(layer.id, 'position.x', {
                            time: frame,
                            value: newX,
                            interpolation: existingKf?.interpolation ?? 'bezier',
                            bezierPoints: existingKf?.bezierPoints,
                          });
                        }
                        if (layerAnims['position.y']?.keyframes.length) {
                          const existingKf = layerAnims['position.y'].keyframes.find(k => k.time === frame);
                          store.addKeyframe(layer.id, 'position.y', {
                            time: frame,
                            value: newY,
                            interpolation: existingKf?.interpolation ?? 'bezier',
                            bezierPoints: existingKf?.bezierPoints,
                          });
                        }
                      }
                    }
                  };

                  const onUp = (me: MouseEvent) => {
                    document.body.style.cursor = '';
                    setSnapLines([]);
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);

                    // ドラッグしなかった場合、かつ単一選択にしたい場合（Ctrl/Metaなし）
                    if (!moved && alreadySelected && !e.ctrlKey && !e.metaKey) {
                      store.selectLayer(layer.id, false);
                    }
                  };

                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isNullLayer) startTextEdit(layer);
                }}
              >

                {/* リサイズハンドル（選択中のみ） */}
                {isSelected && !isEditing && !layer.locked && (() => {
                  const handleSize = 8;
                  const half = handleSize / 2;
                  // 8方向: tl, t, tr, r, br, b, bl, l
                  const handles: { pos: string; cursor: string; dx: number; dy: number; sx: number; sy: number }[] = [
                    { pos: 'tl', cursor: 'nwse-resize', dx: -half,      dy: -half,      sx: -1, sy: -1 },
                    { pos: 't',  cursor: 'ns-resize',   dx: w/2 - half, dy: -half,      sx:  0, sy: -1 },
                    { pos: 'tr', cursor: 'nesw-resize', dx: w - half,   dy: -half,      sx:  1, sy: -1 },
                    { pos: 'r',  cursor: 'ew-resize',   dx: w - half,   dy: h/2 - half, sx:  1, sy:  0 },
                    { pos: 'br', cursor: 'nwse-resize', dx: w - half,   dy: h - half,   sx:  1, sy:  1 },
                    { pos: 'b',  cursor: 'ns-resize',   dx: w/2 - half, dy: h - half,   sx:  0, sy:  1 },
                    { pos: 'bl', cursor: 'nesw-resize', dx: -half,      dy: h - half,   sx: -1, sy:  1 },
                    { pos: 'l',  cursor: 'ew-resize',   dx: -half,      dy: h/2 - half, sx: -1, sy:  0 },
                  ];
                  return handles.map(handle => (
                    <div
                      key={handle.pos}
                      className="resize-handle"
                      style={{
                        position: 'absolute',
                        left: handle.dx,
                        top: handle.dy,
                        width: handleSize,
                        height: handleSize,
                        cursor: handle.cursor,
                        background: 'var(--color-accent)',
                        border: '1px solid #fff',
                        borderRadius: 1,
                        zIndex: 10,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const startMX = e.clientX;
                        const startMY = e.clientY;
                        const origScale: [number, number] = [...resolved.scale];
                        let resized = false;
                        // ドラッグ中のカーソルをbody全体にロック
                        document.body.style.cursor = handle.cursor;

                        const onResizeMove = (me: MouseEvent) => {
                          const pixDX = (me.clientX - startMX);
                          const pixDY = (me.clientY - startMY);
                          if (!resized && (Math.abs(pixDX) > 2 || Math.abs(pixDY) > 2)) {
                            resized = true;
                            useLayerStore.getState().saveSnapshot();
                          }
                          if (!resized) return;

                          // スケールベースのリサイズ
                          let scaleFactorX = handle.sx !== 0 ? (pixDX * handle.sx) / (w / 2) : 0;
                          let scaleFactorY = handle.sy !== 0 ? (pixDY * handle.sy) / (h / 2) : 0;

                          // Alt押下で比率維持
                          if (me.altKey) {
                            if (handle.sx !== 0 && handle.sy !== 0) {
                              // 角ハンドル: 大きい方に統一
                              const unified = Math.abs(scaleFactorX) > Math.abs(scaleFactorY) ? scaleFactorX : scaleFactorY;
                              scaleFactorX = unified;
                              scaleFactorY = unified;
                            } else if (handle.sx !== 0) {
                              // 横ハンドル: X変化量をYにもコピー
                              scaleFactorY = scaleFactorX;
                            } else {
                              // 縦ハンドル: Y変化量をXにもコピー
                              scaleFactorX = scaleFactorY;
                            }
                          }

                          const newScaleX = (handle.sx !== 0 || me.altKey)
                            ? Math.max(5, Math.round((origScale[0] * (1 + scaleFactorX)) * 10) / 10)
                            : origScale[0];
                          const newScaleY = (handle.sy !== 0 || me.altKey)
                            ? Math.max(5, Math.round((origScale[1] * (1 + scaleFactorY)) * 10) / 10)
                            : origScale[1];

                          const newScale: [number, number] = [newScaleX, newScaleY];
                          const store = useLayerStore.getState();
                          store.updateTransform(layer.id, 'scale', newScale);

                          // KFが存在する場合、現在フレームのKF値も更新する
                          const layerAnims = store.animations[layer.id];
                          if (layerAnims) {
                            const frame = useTimelineStore.getState().currentFrame;
                            if (layerAnims['scale']?.keyframes.length) {
                              const existingKf = layerAnims['scale'].keyframes.find(k => k.time === frame);
                              store.addKeyframe(layer.id, 'scale', {
                                time: frame,
                                value: newScale,
                                interpolation: existingKf?.interpolation ?? 'bezier',
                                bezierPoints: existingKf?.bezierPoints,
                              });
                            } else {
                              if (layerAnims['scale.x']?.keyframes.length) {
                                const existingKf = layerAnims['scale.x'].keyframes.find(k => k.time === frame);
                                store.addKeyframe(layer.id, 'scale.x', {
                                  time: frame,
                                  value: newScaleX,
                                  interpolation: existingKf?.interpolation ?? 'bezier',
                                  bezierPoints: existingKf?.bezierPoints,
                                });
                              }
                              if (layerAnims['scale.y']?.keyframes.length) {
                                const existingKf = layerAnims['scale.y'].keyframes.find(k => k.time === frame);
                                store.addKeyframe(layer.id, 'scale.y', {
                                  time: frame,
                                  value: newScaleY,
                                  interpolation: existingKf?.interpolation ?? 'bezier',
                                  bezierPoints: existingKf?.bezierPoints,
                                });
                              }
                            }
                          }
                        };

                        const onResizeUp = () => {
                          document.body.style.cursor = '';
                          window.removeEventListener('mousemove', onResizeMove);
                          window.removeEventListener('mouseup', onResizeUp);
                        };

                        window.addEventListener('mousemove', onResizeMove);
                        window.addEventListener('mouseup', onResizeUp);
                      }}
                    />
                  ));
                })()}
              </div>
            );
          })}

          {/* テキストインライン編集 */}
          {editingLayerId && (() => {
            const layer = layers.find(l => l.id === editingLayerId);
            if (!layer?.textStyle) return null;
            const editResolved = resolveOverlayTransform(layer);
            const fontSize = layer.textStyle.fontSize;
            const [rawW, rawH] = getLayerSize(layer);
            const sx = editResolved.scale[0] / 100;
            const sy = editResolved.scale[1] / 100;

            return (
              <textarea
                ref={textInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitTextEdit}
                onKeyDown={handleTextKeyDown}
                style={{
                  position: 'absolute',
                  left: editResolved.position[0] * scale,
                  top: editResolved.position[1] * scale - (rawH * sy * scale) / 2,
                  transform: layer.textStyle.textAlign === 'left' ? 'none'
                    : layer.textStyle.textAlign === 'right' ? 'translateX(-100%)'
                    : 'translateX(-50%)',
                  width: 'auto',
                  minWidth: Math.max(rawW * sx * scale + 20, 80),
                  minHeight: rawH * sy * scale + 10,
                  fontSize: fontSize * sx * scale,
                  fontFamily: layer.textStyle.fontFamily || 'Inter',
                  fontWeight: layer.textStyle.fontWeight || 400,
                  color: layer.textStyle.color || '#FFFFFF',
                  textAlign: (layer.textStyle.textAlign || 'center') as any,
                  lineHeight: layer.textStyle.lineHeight || 1.2,
                  background: 'rgba(0,0,0,0.5)',
                  border: '2px solid var(--color-accent)',
                  borderRadius: '4px',
                  outline: 'none',
                  padding: '4px 8px',
                  resize: 'none',
                  zIndex: 100,
                  boxSizing: 'border-box',
                  whiteSpace: 'nowrap',
                  overflowX: 'hidden',
                }}
                wrap="off"
                rows={editText.split('\n').length}
              />
            );
          })()}
        </div>
      </div>

      {/* 下部ツールバー */}
      <div className="viewport-toolbar">
        <div className="playback-controls">
          <button className="playback-btn" title="最初へ (Home)"
            onClick={() => useTimelineStore.getState().goToStart()}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
          </button>
          <button className="playback-btn" title="前のフレーム (←)"
            onClick={() => { useTimelineStore.getState().stepBackward(); render(); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
          </button>
          <button className={`playback-btn${isPlaying ? ' playing' : ''}`} title="再生/停止 (Space)"
            onClick={() => useTimelineStore.getState().togglePlay()}>
            {isPlaying
              ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            }
          </button>
          <button className="playback-btn" title="次のフレーム (→)"
            onClick={() => { useTimelineStore.getState().stepForward(); render(); }}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
          </button>
          <button className="playback-btn" title="最後へ (End)"
            onClick={() => useTimelineStore.getState().goToEnd(useProjectStore.getState().totalFrames())}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'scaleX(-1)' }}><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" /></svg>
          </button>
        </div>

        <div className="time-display">
          {formatTimecode(currentFrame, settings.fps)}
        </div>

        <div className="viewport-zoom">
          <button className="btn btn-icon" onClick={() => setViewportZoom(viewportZoom - 10)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          <span>{viewportZoom}%</span>
          <button className="btn btn-icon" onClick={() => setViewportZoom(viewportZoom + 10)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          <button className="btn btn-ghost" onClick={() => setViewportZoom(calcFitZoom())}
            style={{ fontSize: 'var(--font-size-xxs)' }}>Fit</button>
        </div>

        {/* レンダラー切り替えボタン */}
        <button
          className={`renderer-switch${rendererMode === 'webgpu' ? ' gpu-active' : ''}`}
          onClick={toggleRenderer}
          title={gpuAvailable ? `現在: ${rendererMode === 'webgpu' ? 'WebGPU' : 'Canvas2D'} (クリックで切替)` : 'WebGPU非対応'}
          disabled={!gpuAvailable}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M7 15l3-6 3 4 2-2 2 4" />
          </svg>
          <span>{rendererMode === 'webgpu' ? 'GPU' : '2D'}</span>
        </button>
      </div>
    </div>
  );
}

function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const f = Math.round(frame % fps);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

/** 星形のSVG points属性を生成 */
function generateStarPoints(cx: number, cy: number, outerR: number, innerR: number, points: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}
