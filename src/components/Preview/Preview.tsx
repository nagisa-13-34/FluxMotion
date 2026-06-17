import { useEffect, useRef, useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { useContextMenu } from '../../hooks/useContextMenu';
import { Renderer } from '../../stores/engine/renderer';
import { WebGPURenderer, isWebGPUSupported } from '../../stores/engine/webgpuRenderer';
import { resolveOverlayWorldTransform } from '../../stores/engine/overlayTransform';
import type { Layer, BezierPoint } from '../../types/layer';
import { usePenTool } from './hooks/usePenTool';
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
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const ui = useUIStore();
  const contextMenu = useContextMenu();

  // テキスト編集のインライン状態
  const editingLayerId = useUIStore((s) => s.editingLayerId);
  const setEditingLayerId = useUIStore((s) => s.setEditingLayerId);
  const [editText, setEditText] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // スナップライン描画用ヘルパー
  const updateSnapLinesDOM = (lines: { axis: 'x' | 'y'; pos: number }[]) => {
    const group = document.getElementById('snap-lines-group');
    if (!group) return;
    const height = settings.height;
    const width = settings.width;
    group.innerHTML = lines.map(sl => 
      sl.axis === 'x' 
        ? `<line x1="${sl.pos}" y1="0" x2="${sl.pos}" y2="${height}" stroke="#f0f" stroke-width="1" />`
        : `<line x1="0" y1="${sl.pos}" x2="${width}" y2="${sl.pos}" stroke="#f0f" stroke-width="1" />`
    ).join('');
  };

  // レンダラーモード
  const rendererMode = useUIStore((s) => s.rendererMode);
  const setRendererMode = useUIStore((s) => s.setRendererMode);
  const [gpuAvailable, setGpuAvailable] = useState(false);

  // シェイプ描画用のstate
  const [shapeDraw, setShapeDraw] = useState<{
    drawing: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

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

  const toggleRenderer = () => {
    if (rendererMode === 'canvas2d' && gpuAvailable) {
      setRendererMode('webgpu');
    } else {
      setRendererMode('canvas2d');
    }
  };

  const { localLayerOverrides, localOverridesRef, handlePenMouseDown, penDraw } = usePenTool({
    scale,
    containerRef
  });

  // レンダリング用のマージされたレイヤー配列
  const mergedLayers = layers.map(l => {
    if (localLayerOverrides[l.id]) {
      return {
        ...l,
        ...localLayerOverrides[l.id],
        shapeData: localLayerOverrides[l.id].shapeData 
          ? { ...l.shapeData!, ...localLayerOverrides[l.id].shapeData! } 
          : l.shapeData
      };
    }
    return l;
  });

  // 描画関数
  const render = useCallback(() => {
    const state = useLayerStore.getState();
    const uiState = useUIStore.getState();
    const allLayers = state.layers;
    const animations = state.animations;
    const frame = useTimelineStore.getState().currentFrame;
    const editId = uiState.editingLayerId;
    const rMode = uiState.rendererMode;
    const localOverrides = localOverridesRef.current;

    // オプティミスティックUIのオーバーライドを適用
    const overridenLayers = allLayers.map(l => {
      if (localOverrides[l.id]) {
        return {
          ...l,
          ...localOverrides[l.id],
          shapeData: localOverrides[l.id].shapeData 
            ? { ...l.shapeData!, ...localOverrides[l.id].shapeData! } 
            : l.shapeData
        };
      }
      return l;
    });

    const renderLayers = editId
      ? overridenLayers.filter(l => l.id !== editId)
      : overridenLayers;

    if (rMode === 'webgpu' && gpuRendererRef.current?.isReady) {
      gpuRendererRef.current.renderFrame(renderLayers, frame, animations);
      if (rendererRef.current) {
        const playing = useTimelineStore.getState().isPlaying;
        rendererRef.current.renderFrame(renderLayers, frame, animations, {
          disableMotionBlur: !playing,
          transparentBackground: true,
          textOnly: true
        });
      }
    } else if (rendererRef.current) {
      const playing = useTimelineStore.getState().isPlaying;
      rendererRef.current.renderFrame(renderLayers, frame, animations, { disableMotionBlur: !playing });
    }
  }, []); 

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
      }
      setShapeDraw(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [activeTool, scale]);

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
  const visibleLayers = mergedLayers.filter(l =>
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
            measureCtx.font = `${style.fontWeight || 400} ${fontSize}px "${style.fontFamily || 'Inter'}", "Noto Sans JP", sans-serif`;
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

  return (
    <div className="viewport">
      <div
        ref={containerRef}
        className="viewport-canvas-container"
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if (activeTool === 'shape') handleShapeMouseDown(e);
          else if (activeTool === 'pen') handlePenMouseDown(e);
        }}
        style={{ cursor: activeTool === 'shape' ? 'crosshair' : activeTool === 'pen' ? 'crosshair' : undefined }}
      >
        {/* キャンバス + オーバーレイを同じ位置に重ねる */}
        <div style={{ position: 'relative', width: canvasWidth, height: canvasHeight }}>
          {/* WebGPU (ベース) */}
          <canvas
            ref={gpuCanvasRef}
            className="viewport-canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              display: rendererMode === 'webgpu' ? 'block' : 'none',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
            onClick={rendererMode === 'webgpu' ? handleCanvasClick : undefined}
          />
          {/* Canvas2D (オーバーレイ or ベース) */}
          <canvas
            ref={canvasRef}
            className="viewport-canvas"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              display: 'block',
              position: rendererMode === 'webgpu' ? 'absolute' : 'relative',
              top: 0,
              left: 0,
              pointerEvents: rendererMode === 'webgpu' ? 'none' : 'auto',
              visibility: rendererMode === 'webgpu' && !gpuRendererRef.current?.isReady ? 'hidden' : 'visible'
            }}
            onClick={rendererMode === 'canvas2d' ? handleCanvasClick : undefined}
          />

          {/* グリッドオーバーレイ */}
          {ui.showGrid && (
            <svg
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 0.2 }}
              width={canvasWidth} height={canvasHeight}
            >
              <defs>
                <pattern id="grid" width={ui.gridSize * scale} height={ui.gridSize * scale} patternUnits="userSpaceOnUse">
                  <path d={`M ${ui.gridSize * scale} 0 L 0 0 0 ${ui.gridSize * scale}`} fill="none" stroke="#fff" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          )}

          {/* スナップライン */}
          <svg
            style={{
              position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 10000
            }}
            width={canvasWidth} height={canvasHeight}
            viewBox={`0 0 ${settings.width} ${settings.height}`}
          >
            <g id="snap-lines-group"></g>
          </svg>

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
                      points={generateStarPoints(w/2, h/2, w/2, w/4, 5)}
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

          {/* ペンツール時のパス・マスクポイントプレビュー */}
          {activeTool === 'pen' && (() => {
            const store = useLayerStore.getState();
            const targetLayerIds = penDraw ? [penDraw.layerId] : store.selectedLayerIds;
            return targetLayerIds.map(layerId => {
              const layer = mergedLayers.find(l => l.id === layerId);
              if (!layer) return null;

              const pathGroups: { id: string, points: BezierPoint[], isMask: boolean }[] = [];
              if (layer.masks) {
                layer.masks.forEach(m => pathGroups.push({ id: m.id, points: m.points, isMask: true }));
              }
              if (layer.shapeData?.shapeType === 'path' && layer.shapeData.points) {
                pathGroups.push({ id: 'shape', points: layer.shapeData.points, isMask: false });
              }
              if (pathGroups.length === 0) return null;

              const resolved = resolveOverlayTransform(layer);
              const sx = resolved.scale[0] / 100;
              const sy = resolved.scale[1] / 100;
              const rot = (resolved.rotation * Math.PI) / 180;
              const ax = resolved.anchorPoint[0];
              const ay = resolved.anchorPoint[1];
              
              const l2s = (lx: number, ly: number): [number, number] => {
                const dx = lx - ax;
                const dy = ly - ay;
                const rx = dx * sx;
                const ry = dy * sy;
                const cos = Math.cos(rot);
                const sin = Math.sin(rot);
                const wx = rx * cos - ry * sin + resolved.position[0];
                const wy = rx * sin + ry * cos + resolved.position[1];
                return [wx * scale, wy * scale];
              };

              return (
                <svg key={`pen-layer-${layerId}`} style={{ position: 'absolute', top: 0, left: 0, width: canvasWidth, height: canvasHeight, pointerEvents: 'none', zIndex: 9999, overflow: 'visible' }}>
                  {pathGroups.map(group => (
                    <g key={`group-${group.id}`}>
                      {group.points.map((p, i) => {
                        const [px, py] = l2s(p.pos[0], p.pos[1]);
                        const [ix, iy] = l2s(p.pos[0] + p.in[0], p.pos[1] + p.in[1]);
                        const [ox, oy] = l2s(p.pos[0] + p.out[0], p.pos[1] + p.out[1]);
                        
                        return (
                          <g key={i}>
                            {(p.in[0] !== 0 || p.in[1] !== 0) && (
                              <>
                                <line x1={px} y1={py} x2={ix} y2={iy} stroke="#00CEC9" strokeWidth="1" />
                                <circle cx={ix} cy={iy} r="3" fill="#00CEC9" />
                              </>
                            )}
                            {(p.out[0] !== 0 || p.out[1] !== 0) && (
                              <>
                                <line x1={px} y1={py} x2={ox} y2={oy} stroke="#00CEC9" strokeWidth="1" />
                                <circle cx={ox} cy={oy} r="3" fill="#00CEC9" />
                              </>
                            )}
                            <circle cx={px} cy={py} r="4" fill="#fff" stroke="#A29BFE" strokeWidth="2" />
                          </g>
                        );
                      })}
                    </g>
                  ))}
                </svg>
              );
            });
          })()}

          {/* レイヤーオーバーレイ（背面から前面へ描画するためリバース） */}
          {[...visibleLayers].reverse().map((layer) => {
            if (layer.type === 'adjustment') return null;

            const resolved = resolveOverlayTransform(layer);
            const sx = resolved.scale[0] / 100;
            const sy = resolved.scale[1] / 100;

            let rawW = 200, rawH = 200;
            let localLeft = -100, localTop = -100;

            if (layer.type === 'shape' && layer.shapeData?.shapeType === 'path' && layer.shapeData.points) {
              const pts = layer.shapeData.points;
              if (pts.length > 0) {
                const minX = Math.min(...pts.map(p => Math.min(p.pos[0], p.pos[0] + p.in[0], p.pos[0] + p.out[0])));
                const maxX = Math.max(...pts.map(p => Math.max(p.pos[0], p.pos[0] + p.in[0], p.pos[0] + p.out[0])));
                const minY = Math.min(...pts.map(p => Math.min(p.pos[1], p.pos[1] + p.in[1], p.pos[1] + p.out[1])));
                const maxY = Math.max(...pts.map(p => Math.max(p.pos[1], p.pos[1] + p.in[1], p.pos[1] + p.out[1])));
                rawW = Math.max(maxX - minX, 10);
                rawH = Math.max(maxY - minY, 10);
                localLeft = minX;
                localTop = minY;
              }
            } else {
              const [rw, rh] = getLayerSize(layer);
              rawW = rw;
              rawH = rh;
              localTop = -rawH / 2;
              if (layer.type === 'text' && layer.textStyle) {
                if (layer.textStyle.textAlign === 'left') localLeft = 0;
                else if (layer.textStyle.textAlign === 'right') localLeft = -rawW;
                else localLeft = -rawW / 2;
              } else {
                localLeft = -rawW / 2;
              }
            }

            const w = rawW * Math.abs(sx) * scale;
            const h = rawH * Math.abs(sy) * scale;
            const xOffset = localLeft * Math.abs(sx) * scale;
            const yOffset = localTop * Math.abs(sy) * scale;

            const x = resolved.position[0] * scale + xOffset;
            const y = resolved.position[1] * scale + yOffset;
            const isSelected = selectedLayerIds.includes(layer.id);
            const isEditing = editingLayerId === layer.id;

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
                    : (layer.type === 'shape' && layer.shapeData?.shapeType === 'path'
                      ? 'none'
                      : (isSelected
                        ? '1.5px solid var(--color-accent)'
                        : '1px solid rgba(255, 255, 255, 0.25)')),
                  borderRadius: isNullLayer ? 0 : 6,
                  boxSizing: 'border-box',
                  pointerEvents: (layer.locked || activeTool === 'pen' || activeTool === 'shape' || activeTool === 'hand') ? 'none' : 'auto',
                  transition: 'border-color 0.15s',
                  transform: resolved.rotation !== 0 ? `rotate(${resolved.rotation}deg)` : undefined,
                  transformOrigin: `${-xOffset}px ${-yOffset}px`,
                }}
                onContextMenu={(e) => {
                  contextMenu.show(e, [
                    {
                      label: 'コンポジション設定...',
                      action: () => useUIStore.getState().setShowCompSettings(true)
                    }
                  ]);
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0 || isEditing || layer.locked) return;
                  e.stopPropagation();
                  e.preventDefault();
                  
                  const store = useLayerStore.getState();
                  const alreadySelected = store.selectedLayerIds.includes(layer.id);
                  
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

                    const ui = useUIStore.getState();
                    const snappedLines: { axis: 'x' | 'y'; pos: number }[] = [];
                    if (ui.snapEnabled && !me.shiftKey) {
                      const snapThreshold = 6;
                      const cx = settings.width / 2;
                      const cy = settings.height / 2;
                      const grid = ui.gridSize;

                      if (Math.abs(newX - cx) < snapThreshold) { newX = cx; snappedLines.push({ axis: 'x', pos: cx }); }
                      if (Math.abs(newY - cy) < snapThreshold) { newY = cy; snappedLines.push({ axis: 'y', pos: cy }); }

                      if (ui.showGrid && snappedLines.length === 0) {
                        const nearGridX = Math.round(newX / grid) * grid;
                        const nearGridY = Math.round(newY / grid) * grid;
                        if (Math.abs(newX - nearGridX) < snapThreshold) { newX = nearGridX; snappedLines.push({ axis: 'x', pos: nearGridX }); }
                        if (Math.abs(newY - nearGridY) < snapThreshold) { newY = nearGridY; snappedLines.push({ axis: 'y', pos: nearGridY }); }
                      }
                    }
                    updateSnapLinesDOM(snappedLines);

                    const newPos: [number, number] = [newX, newY];
                    const store = useLayerStore.getState();
                    store.updateTransform(layer.id, 'position', newPos);

                    const layerAnims = store.animations[layer.id];
                    if (layerAnims) {
                      const frame = useTimelineStore.getState().currentFrame;
                      if (layerAnims['position']?.keyframes.length) {
                        const existingKf = layerAnims['position'].keyframes.find(k => k.time === frame);
                        store.addKeyframe(layer.id, 'position', {
                          time: frame,
                          value: newPos,
                          interpolation: existingKf?.interpolation ?? 'bezier',
                          bezierPoints: existingKf?.bezierPoints,
                        });
                      } else {
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

                  const onUp = () => {
                    document.body.style.cursor = '';
                    updateSnapLinesDOM([]);
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
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
                {isSelected && !isEditing && !layer.locked && (() => {
                  const handleSize = 8;
                  const half = handleSize / 2;
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
                        const origPos: [number, number] = [...resolved.position];
                        let resized = false;
                        document.body.style.cursor = handle.cursor;

                        const onResizeMove = (me: MouseEvent) => {
                          const pixDX = (me.clientX - startMX);
                          const pixDY = (me.clientY - startMY);
                          if (!resized && (Math.abs(pixDX) > 2 || Math.abs(pixDY) > 2)) {
                            resized = true;
                            useLayerStore.getState().saveSnapshot();
                          }
                          if (!resized) return;

                          let scaleFactorX = handle.sx !== 0 ? (pixDX * handle.sx) / (w / 2) : 0;
                          let scaleFactorY = handle.sy !== 0 ? (pixDY * handle.sy) / (h / 2) : 0;

                          if (me.altKey) {
                            if (handle.sx !== 0 && handle.sy !== 0) {
                              const unified = Math.abs(scaleFactorX) > Math.abs(scaleFactorY) ? scaleFactorX : scaleFactorY;
                              scaleFactorX = unified;
                              scaleFactorY = unified;
                            } else if (handle.sx !== 0) {
                              scaleFactorY = scaleFactorX;
                            } else {
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

                          const dScaleX = (newScaleX - origScale[0]) / 100;
                          const dScaleY = (newScaleY - origScale[1]) / 100;
                          
                          const cx = localLeft + rawW / 2;
                          const cy = localTop + rawH / 2;
                          const ox = cx - resolved.anchorPoint[0];
                          const oy = cy - resolved.anchorPoint[1];
                          const shiftX = ox * dScaleX;
                          const shiftY = oy * dScaleY;
                          
                          const moveX = (rawW * dScaleX) / 2 * handle.sx;
                          const moveY = (rawH * dScaleY) / 2 * handle.sy;

                          const localDx = moveX - shiftX;
                          const localDy = moveY - shiftY;

                          const rotRad = (resolved.rotation * Math.PI) / 180;
                          const worldDx = localDx * Math.cos(rotRad) - localDy * Math.sin(rotRad);
                          const worldDy = localDx * Math.sin(rotRad) + localDy * Math.cos(rotRad);

                          const newPos: [number, number] = [
                            origPos[0] + worldDx,
                            origPos[1] + worldDy
                          ];

                          const store = useLayerStore.getState();
                          store.updateTransform(layer.id, 'scale', newScale);
                          store.updateTransform(layer.id, 'position', newPos);

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
                            
                            if (layerAnims['position']?.keyframes.length) {
                              const existingKf = layerAnims['position'].keyframes.find(k => k.time === frame);
                              store.addKeyframe(layer.id, 'position', {
                                time: frame,
                                value: newPos,
                                interpolation: existingKf?.interpolation ?? 'bezier',
                                bezierPoints: existingKf?.bezierPoints,
                              });
                            } else {
                              if (layerAnims['position.x']?.keyframes.length) {
                                const existingKf = layerAnims['position.x'].keyframes.find(k => k.time === frame);
                                store.addKeyframe(layer.id, 'position.x', {
                                  time: frame,
                                  value: newPos[0],
                                  interpolation: existingKf?.interpolation ?? 'bezier',
                                  bezierPoints: existingKf?.bezierPoints,
                                });
                              }
                              if (layerAnims['position.y']?.keyframes.length) {
                                const existingKf = layerAnims['position.y'].keyframes.find(k => k.time === frame);
                                store.addKeyframe(layer.id, 'position.y', {
                                  time: frame,
                                  value: newPos[1],
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
                  fontFamily: `"${layer.textStyle.fontFamily || 'Inter'}", "Noto Sans JP", sans-serif`,
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
