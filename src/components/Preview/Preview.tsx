import { useEffect, useRef, useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { Renderer } from '../../stores/engine/renderer';
import { WebGPURenderer, isWebGPUSupported } from '../../stores/engine/webgpuRenderer';
import { resolveOverlayWorldTransform } from '../../stores/engine/overlayTransform';
import type { Layer, BezierPoint } from '../../types/layer';
import { generateId, createDefaultTransform } from '../../types/layer';

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

  // ペンツール用のstate
  const [penDraw, setPenDraw] = useState<{
    layerId: string;
    maskId?: string;
    currentIndex: number;
    isDragging: boolean;
  } | null>(null);

  // ペンツールでのポイント編集用state
  const [pointDrag, setPointDrag] = useState<{
    layerId: string;
    maskId?: string;
    pointIndex: number;
    handleType: 'pos' | 'in' | 'out';
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
      }
      setShapeDraw(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [activeTool, scale, setTool]);

  // ワールド座標 → ローカル座標変換
  const getWorldToLocal = useCallback((layer: Layer, worldX: number, worldY: number): [number, number] => {
    const resolved = resolveOverlayTransform(layer);
    const dx = worldX - resolved.position[0];
    const dy = worldY - resolved.position[1];
    const rot = (resolved.rotation * Math.PI) / 180;
    const sx = resolved.scale[0] / 100;
    const sy = resolved.scale[1] / 100;
    
    // 逆回転
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    
    // 逆スケール
    const lx = sx !== 0 ? rx / sx : 0;
    const ly = sy !== 0 ? ry / sy : 0;
    
    return [lx + resolved.anchorPoint[0], ly + resolved.anchorPoint[1]];
  }, [layers, currentFrame, animations]);

  // ── ペンツール ──
  const handlePenMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'pen') return;
    e.preventDefault();
    const container = e.currentTarget;
    const canvasDiv = container.firstElementChild as HTMLElement | null;
    if (!canvasDiv) return;
    const canvasRect = canvasDiv.getBoundingClientRect();
    
    // コンポ座標のクリック位置
    const compX = (e.clientX - canvasRect.left) / scale;
    const compY = (e.clientY - canvasRect.top) / scale;
    // スクリーンピクセルでのクリック位置
    const screenX = e.clientX - canvasRect.left;
    const screenY = e.clientY - canvasRect.top;

    const store = useLayerStore.getState();

    // 既存ポイントのドラッグ判定（当たり判定）
    let hitPoint: { layerId: string; maskId?: string; pointIndex: number; handleType: 'pos' | 'in' | 'out' } | null = null;
    for (const layerId of store.selectedLayerIds) {
      const layer = store.layers.find(l => l.id === layerId);
      if (!layer) continue;
      
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

      const checkGroup = (points: BezierPoint[], maskId?: string) => {
        for (let i = points.length - 1; i >= 0; i--) {
          const p = points[i];
          const [px, py] = l2s(p.pos[0], p.pos[1]);
          const [ix, iy] = l2s(p.pos[0] + p.in[0], p.pos[1] + p.in[1]);
          const [ox, oy] = l2s(p.pos[0] + p.out[0], p.pos[1] + p.out[1]);
          
          if ((p.in[0] !== 0 || p.in[1] !== 0) && Math.hypot(screenX - ix, screenY - iy) < 6) {
            hitPoint = { layerId: layer.id, maskId, pointIndex: i, handleType: 'in' };
            return true;
          }
          if ((p.out[0] !== 0 || p.out[1] !== 0) && Math.hypot(screenX - ox, screenY - oy) < 6) {
            hitPoint = { layerId: layer.id, maskId, pointIndex: i, handleType: 'out' };
            return true;
          }
          if (Math.hypot(screenX - px, screenY - py) < 8) {
            hitPoint = { layerId: layer.id, maskId, pointIndex: i, handleType: 'pos' };
            return true;
          }
        }
        return false;
      };

      if (layer.masks) {
        for (const m of layer.masks) {
          if (checkGroup(m.points, m.id)) break;
        }
      }
      if (!hitPoint && layer.shapeData?.shapeType === 'path' && layer.shapeData.points) {
        checkGroup(layer.shapeData.points);
      }
      if (hitPoint) break;
    }

    if (hitPoint) {
      const activePenType = useUIStore.getState().activePenType;
      const layer = store.layers.find(l => l.id === hitPoint!.layerId);
      if (layer) {
        if (activePenType === 'remove' && hitPoint.handleType === 'pos') {
          // 頂点の削除
          store.saveSnapshot();
          if (hitPoint.maskId && layer.masks) {
            const maskIdx = layer.masks.findIndex(m => m.id === hitPoint!.maskId);
            if (maskIdx >= 0) {
              const newMasks = [...layer.masks];
              const newPoints = [...newMasks[maskIdx].points];
              newPoints.splice(hitPoint.pointIndex, 1);
              newMasks[maskIdx] = { ...newMasks[maskIdx], points: newPoints };
              store.updateLayer(layer.id, { masks: newMasks });
            }
          } else if (layer.shapeData?.points) {
            const newPoints = [...layer.shapeData.points];
            newPoints.splice(hitPoint.pointIndex, 1);
            store.updateLayer(layer.id, { shapeData: { ...layer.shapeData, points: newPoints } });
          }
          return; // 削除後はドラッグしない
        }

        if (activePenType === 'convert' && hitPoint.handleType === 'pos') {
          // 頂点の切り替え
          store.saveSnapshot();
          let currentP: BezierPoint | undefined;
          
          if (hitPoint.maskId && layer.masks) {
            const mask = layer.masks.find(m => m.id === hitPoint!.maskId);
            currentP = mask?.points[hitPoint.pointIndex];
          } else if (layer.shapeData?.points) {
            currentP = layer.shapeData.points[hitPoint.pointIndex];
          }

          if (currentP) {
            const hasHandles = currentP.in[0] !== 0 || currentP.in[1] !== 0 || currentP.out[0] !== 0 || currentP.out[1] !== 0;
            if (hasHandles) {
              // ハンドルをリセットして直線にする（コーナーポイント）
              const updatePoints = (points: BezierPoint[]) => {
                const newPts = [...points];
                newPts[hitPoint!.pointIndex] = { ...currentP!, in: [0,0], out: [0,0] };
                return newPts;
              };
              if (hitPoint.maskId && layer.masks) {
                const maskIdx = layer.masks.findIndex(m => m.id === hitPoint!.maskId);
                const newMasks = [...layer.masks];
                newMasks[maskIdx] = { ...newMasks[maskIdx], points: updatePoints(newMasks[maskIdx].points) };
                store.updateLayer(layer.id, { masks: newMasks });
              } else if (layer.shapeData?.points) {
                store.updateLayer(layer.id, { shapeData: { ...layer.shapeData, points: updatePoints(layer.shapeData.points) } });
              }
              return; // クリックでリセット完了、ドラッグはしない
            } else {
              // ハンドルが無い場合は、ドラッグで新しくハンドルを引き出せるように、
              // 特別な handleType 'pull' として pointDrag に設定する
              setPointDrag({ ...hitPoint, handleType: 'pull' as any });
              return;
            }
          }
        }
      }

      // 通常のドラッグ
      setPointDrag(hitPoint);
      return;
    }

    // パスを閉じる判定（始点付近をクリックしたか）
    if (penDraw) {
      const layer = store.layers.find(l => l.id === penDraw.layerId);
      if (layer) {
        let points: BezierPoint[] = [];
        if (penDraw.maskId && layer.masks) {
          const mask = layer.masks.find(m => m.id === penDraw.maskId);
          if (mask) points = mask.points;
        } else if (layer.shapeData?.points) {
          points = layer.shapeData.points;
        }
        
        if (points.length > 0) {
          const firstP = points[0];
          
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
          const [fx, fy] = l2s(firstP.pos[0], firstP.pos[1]);
          const screenDist = Math.hypot(screenX - fx, screenY - fy);

          // 画面上で約10px以内ならパスを閉じる
          if (screenDist < 10) {
            // パスを閉じる
            store.saveSnapshot();
            if (penDraw.maskId && layer.masks) {
              const newMasks = layer.masks.map(m => m.id === penDraw.maskId ? { ...m, closed: true } : m);
              store.updateLayer(layer.id, { masks: newMasks });
            } else if (layer.shapeData) {
              store.updateLayer(layer.id, { shapeData: { ...layer.shapeData, closed: true } });
            }
            setPenDraw(null);
            return;
          }
        }
      }
    }

    if (!penDraw) {
      // 削除や変換モードの場合は、新しいポイントの作成を防ぐ
      const activePenType = useUIStore.getState().activePenType;
      if (activePenType === 'remove' || activePenType === 'convert') {
        return;
      }

      // 新規描画開始
      const selectedId = store.selectedLayerIds.length === 1 ? store.selectedLayerIds[0] : null;
      let targetLayerId = '';
      let targetMaskId: string | undefined = undefined;
      let initialLocalPos: [number, number] = [compX, compY];

      store.saveSnapshot();

      if (selectedId) {
        // マスクを追加
        targetLayerId = selectedId;
        targetMaskId = generateId();
        const layer = store.layers.find(l => l.id === selectedId);
        if (layer) {
          initialLocalPos = getWorldToLocal(layer, compX, compY);
          const newMask = {
            id: targetMaskId,
            name: `マスク ${(layer.masks?.length || 0) + 1}`,
            points: [{ pos: initialLocalPos, in: [0,0] as [number,number], out: [0,0] as [number,number] }],
            closed: false,
            inverted: false,
            mode: 'add' as const,
            opacity: 100,
          };
          store.updateLayer(layer.id, { masks: [...(layer.masks || []), newMask] });
        }
      } else {
        // 新規シェイプレイヤーを追加
        targetLayerId = store.addLayer('shape', {
          shapeData: {
            shapeType: 'path',
            fill: 'transparent',
            fillOpacity: 100,
            stroke: '#A29BFE',
            strokeWidth: 4,
            strokeLineCap: 'round',
            points: [{ pos: initialLocalPos, in: [0,0], out: [0,0] }],
            closed: false,
          },
          transform: {
            ...createDefaultTransform(),
            position: [0, 0], // ワールド座標=ローカル座標にする
            anchorPoint: [0, 0],
          }
        });
      }
      setPenDraw({ layerId: targetLayerId, maskId: targetMaskId, currentIndex: 0, isDragging: true });

    } else {
      // 既存のパスにポイントを追加
      const layer = store.layers.find(l => l.id === penDraw.layerId);
      if (layer) {
        store.saveSnapshot();
        const localPos = getWorldToLocal(layer, compX, compY);
        const newPoint: BezierPoint = { pos: localPos, in: [0,0], out: [0,0] };
        
        let newIndex = 0;
        if (penDraw.maskId && layer.masks) {
          const maskIdx = layer.masks.findIndex(m => m.id === penDraw.maskId);
          if (maskIdx >= 0) {
            const newMasks = [...layer.masks];
            newMasks[maskIdx] = { ...newMasks[maskIdx], points: [...newMasks[maskIdx].points, newPoint] };
            newIndex = newMasks[maskIdx].points.length - 1;
            store.updateLayer(layer.id, { masks: newMasks });
          }
        } else if (layer.shapeData?.points) {
          const newPoints = [...layer.shapeData.points, newPoint];
          newIndex = newPoints.length - 1;
          store.updateLayer(layer.id, { shapeData: { ...layer.shapeData, points: newPoints } });
        }
        setPenDraw({ ...penDraw, currentIndex: newIndex, isDragging: true });
      }
    }
  }, [activeTool, scale, penDraw, getWorldToLocal, setTool]);

  useEffect(() => {
    if (activeTool !== 'pen' || !penDraw?.isDragging) return;
    
    const handleMove = (e: MouseEvent) => {
      const container = containerRef.current;
      const canvasDiv = container?.firstElementChild as HTMLElement | null;
      if (!canvasDiv) return;
      const canvasRect = canvasDiv.getBoundingClientRect();
      const compX = (e.clientX - canvasRect.left) / scale;
      const compY = (e.clientY - canvasRect.top) / scale;

      const store = useLayerStore.getState();
      const layer = store.layers.find(l => l.id === penDraw.layerId);
      if (!layer) return;

      const [lx, ly] = getWorldToLocal(layer, compX, compY);

      const updatePoints = (points: BezierPoint[]) => {
        const newPoints = [...points];
        const currentP = newPoints[penDraw.currentIndex];
        // ドラッグでアウトタンジェントを設定し、インタンジェントは対称にする
        const outX = lx - currentP.pos[0];
        const outY = ly - currentP.pos[1];
        newPoints[penDraw.currentIndex] = {
          ...currentP,
          out: [outX, outY],
          in: [-outX, -outY],
        };
        return newPoints;
      };

      if (penDraw.maskId && layer.masks) {
        const maskIdx = layer.masks.findIndex(m => m.id === penDraw.maskId);
        if (maskIdx >= 0) {
          const newMasks = [...layer.masks];
          newMasks[maskIdx] = { ...newMasks[maskIdx], points: updatePoints(newMasks[maskIdx].points) };
          store.updateLayer(layer.id, { masks: newMasks });
        }
      } else if (layer.shapeData?.points) {
        store.updateLayer(layer.id, { shapeData: { ...layer.shapeData, points: updatePoints(layer.shapeData.points) } });
      }
    };

    const handleUp = () => {
      setPenDraw(prev => prev ? { ...prev, isDragging: false } : null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [activeTool, penDraw, scale, getWorldToLocal]);

  // ── 既存ポイントのドラッグ処理 ──
  useEffect(() => {
    if (activeTool !== 'pen' || !pointDrag) return;
    
    let isModified = false;
    
    const handleMove = (e: MouseEvent) => {
      const container = containerRef.current;
      const canvasDiv = container?.firstElementChild as HTMLElement | null;
      if (!canvasDiv) return;
      const canvasRect = canvasDiv.getBoundingClientRect();
      const compX = (e.clientX - canvasRect.left) / scale;
      const compY = (e.clientY - canvasRect.top) / scale;

      const store = useLayerStore.getState();
      const layer = store.layers.find(l => l.id === pointDrag.layerId);
      if (!layer) return;

      const [lx, ly] = getWorldToLocal(layer, compX, compY);

      if (!isModified) {
        store.saveSnapshot();
        isModified = true;
      }

      const updatePoints = (points: BezierPoint[]) => {
        const newPoints = [...points];
        const currentP = newPoints[pointDrag.pointIndex];
        
        if (pointDrag.handleType === 'pos') {
          newPoints[pointDrag.pointIndex] = {
            ...currentP,
            pos: [lx, ly],
          };
        } else if (pointDrag.handleType === 'in') {
          const inX = lx - currentP.pos[0];
          const inY = ly - currentP.pos[1];
          newPoints[pointDrag.pointIndex] = {
            ...currentP,
            in: [inX, inY],
            out: [-inX, -inY],
          };
        } else if (pointDrag.handleType === 'out') {
          const outX = lx - currentP.pos[0];
          const outY = ly - currentP.pos[1];
          newPoints[pointDrag.pointIndex] = {
            ...currentP,
            out: [outX, outY],
            in: [-outX, -outY],
          };
        } else if (pointDrag.handleType === 'pull' as any) {
          const outX = lx - currentP.pos[0];
          const outY = ly - currentP.pos[1];
          newPoints[pointDrag.pointIndex] = {
            ...currentP,
            out: [outX, outY],
            in: [-outX, -outY],
          };
        }
        return newPoints;
      };

      if (pointDrag.maskId && layer.masks) {
        const maskIdx = layer.masks.findIndex(m => m.id === pointDrag.maskId);
        if (maskIdx >= 0) {
          const newMasks = [...layer.masks];
          newMasks[maskIdx] = { ...newMasks[maskIdx], points: updatePoints(newMasks[maskIdx].points) };
          store.updateLayer(layer.id, { masks: newMasks });
        }
      } else if (layer.shapeData?.points) {
        store.updateLayer(layer.id, { shapeData: { ...layer.shapeData, points: updatePoints(layer.shapeData.points) } });
      }
    };

    const handleUp = () => {
      setPointDrag(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [activeTool, pointDrag, scale, getWorldToLocal]);

  // ペンツールのキャンセル (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTool === 'pen' && penDraw) {
          setPenDraw(null);
          setTool('select');
        } else if (editingLayerId) {
          setEditingLayerId(null);
          setEditText('');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, penDraw, editingLayerId, setTool]);

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
                      points={`0,${h/2} ${w/2},0 ${w},${h/2} ${w/2},${h}`} // 簡易的な星型代用
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
            // penDraw中ならそのレイヤーのみ、そうでなければ選択中レイヤーを対象にする
            const targetLayerIds = penDraw ? [penDraw.layerId] : store.selectedLayerIds;
            return targetLayerIds.map(layerId => {
              const layer = layers.find(l => l.id === layerId);
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
                        
                        // pointDrag中なら、ドラッグ対象のポイントかどうかを判定してハイライトしても良いが、ここでは一律描画
                        return (
                          <g key={i}>
                            {/* インタンジェント */}
                            {(p.in[0] !== 0 || p.in[1] !== 0) && (
                              <>
                                <line x1={px} y1={py} x2={ix} y2={iy} stroke="#00CEC9" strokeWidth="1" />
                                <circle cx={ix} cy={iy} r="3" fill="#00CEC9" />
                              </>
                            )}
                            {/* アウトタンジェント */}
                            {(p.out[0] !== 0 || p.out[1] !== 0) && (
                              <>
                                <line x1={px} y1={py} x2={ox} y2={oy} stroke="#00CEC9" strokeWidth="1" />
                                <circle cx={ox} cy={oy} r="3" fill="#00CEC9" />
                              </>
                            )}
                            {/* アンカーポイント */}
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

                  const onUp = () => {
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
                        const origPos: [number, number] = [...resolved.position];
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

                          // --- ポジションの補正（反対側の端を固定） ---
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
                            
                            // positionのKF更新
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
