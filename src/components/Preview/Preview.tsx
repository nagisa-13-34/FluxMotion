import { useEffect, useRef, useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { Renderer } from '../../stores/engine/renderer';
import { WebGPURenderer, isWebGPUSupported } from '../../stores/engine/webgpuRenderer';
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
  const viewportZoom = useUIStore((s) => s.viewportZoom);
  const setViewportZoom = useUIStore((s) => s.setViewportZoom);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  // テキスト編集のインライン状態
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // レンダラーモード
  const [rendererMode, setRendererMode] = useState<'canvas2d' | 'webgpu'>('canvas2d');
  const [gpuAvailable, setGpuAvailable] = useState(false);

  const scale = viewportZoom / 100;
  const canvasWidth = Math.round(settings.width * scale);
  const canvasHeight = Math.round(settings.height * scale);

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
    rendererRef.current = renderer;
    gpuRendererRef.current = null;
  }, [rendererMode, settings.width, settings.height, settings.backgroundColor]);

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
      rendererRef.current.renderFrame(renderLayers, frame, animations);
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
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      setViewportZoom(viewportZoom + delta);
    }
  };

  // キャンバスをクリック → 選択解除
  const handleCanvasClick = () => {
    if (!editingLayerId) {
      useLayerStore.getState().deselectAll();
    }
  };

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
        const fontSize = layer.textStyle?.fontSize || 48;
        const text = layer.textStyle?.text || 'T';
        const lines = text.split('\n');
        const maxW = Math.max(...lines.map(line => {
          let w = 0;
          for (const ch of line) w += ch.charCodeAt(0) > 255 ? 1.0 : 0.6;
          return w;
        }), 1);
        return [maxW * fontSize, lines.length * fontSize * 1.4];
      }
      case 'shape':
        return [200, 200];
      case 'solid':
        return [settings.width, settings.height];
      default:
        return [200, 100];
    }
  };

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

          {/* レイヤーオーバーレイ */}
          {visibleLayers.map((layer) => {
            if (layer.type === 'null' || layer.type === 'adjustment') return null;

            const { position } = layer.transform;
            const sx = layer.transform.scale[0] / 100;
            const sy = layer.transform.scale[1] / 100;
            const [rawW, rawH] = getLayerSize(layer);
            const w = rawW * sx * scale;
            const h = rawH * sy * scale;
            // テキスト揃えに応じたX位置オフセット
            let xOffset = -w / 2; // center（デフォルト）
            if (layer.type === 'text' && layer.textStyle) {
              if (layer.textStyle.textAlign === 'left') xOffset = 0;
              else if (layer.textStyle.textAlign === 'right') xOffset = -w;
            }
            const x = position[0] * scale + xOffset;
            const y = position[1] * scale - h / 2;
            const isSelected = selectedLayerIds.includes(layer.id);
            const isEditing = editingLayerId === layer.id;

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
                  border: isSelected
                    ? '1.5px solid var(--color-accent)'
                    : '1px solid rgba(255, 255, 255, 0.25)',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  pointerEvents: 'auto',
                  transition: 'border-color 0.15s',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) {
                    useLayerStore.getState().selectLayer(layer.id, e.ctrlKey || e.metaKey);
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0 || isEditing || layer.locked) return;
                  e.stopPropagation();
                  e.preventDefault();
                  useLayerStore.getState().selectLayer(layer.id, e.ctrlKey || e.metaKey);

                  const startX = e.clientX;
                  const startY = e.clientY;
                  const origPos: [number, number] = [...position];
                  let moved = false;

                  const onMove = (me: MouseEvent) => {
                    const dx = (me.clientX - startX) / scale;
                    const dy = (me.clientY - startY) / scale;
                    if (!moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
                      moved = true;
                      useLayerStore.getState().saveSnapshot();
                    }
                    if (!moved) return;
                    const newPos: [number, number] = [
                      Math.round((origPos[0] + dx) * 10) / 10,
                      Math.round((origPos[1] + dy) * 10) / 10,
                    ];
                    useLayerStore.getState().updateTransform(layer.id, 'position', newPos);
                  };

                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };

                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startTextEdit(layer);
                }}
              />
            );
          })}

          {/* テキストインライン編集 */}
          {editingLayerId && (() => {
            const layer = layers.find(l => l.id === editingLayerId);
            if (!layer?.textStyle) return null;
            const { position } = layer.transform;
            const fontSize = layer.textStyle.fontSize;
            const [rawW, rawH] = getLayerSize(layer);
            const sx = layer.transform.scale[0] / 100;
            const sy = layer.transform.scale[1] / 100;

            return (
              <textarea
                ref={textInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitTextEdit}
                onKeyDown={handleTextKeyDown}
                style={{
                  position: 'absolute',
                  left: position[0] * scale,
                  top: position[1] * scale - (rawH * sy * scale) / 2,
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
          <button className="btn btn-ghost" onClick={() => setViewportZoom(50)}
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
