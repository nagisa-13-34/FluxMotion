import { useState, useEffect, useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { useLayerStore } from '../../../stores/layerStore';
import { useTimelineStore } from '../../../stores/timelineStore';
import { useUIStore } from '../../../stores/uiStore';
import { resolveOverlayWorldTransform } from '../../../stores/engine/overlayTransform';
import type { BezierPoint, Layer } from '../../../types/layer';
import { generateId, createDefaultTransform } from '../../../types/layer';

const HIT_TEST_RADIUS_HANDLE = 12; // 変更: 6 -> 12（ヒットエリア拡大）
const HIT_TEST_RADIUS_POS = 14;    // 変更: 8 -> 14（ヒットエリア拡大）
const SNAP_CLOSE_RADIUS = 10;

export interface UsePenToolProps {
  scale: number;
  containerRef: RefObject<HTMLDivElement>;
}

export function usePenTool({ scale, containerRef }: UsePenToolProps) {
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);

  const [penDraw, setPenDraw] = useState<{
    layerId: string;
    maskId?: string;
    currentIndex: number;
    isDragging: boolean;
  } | null>(null);

  const [pointDrag, setPointDrag] = useState<{
    layerId: string;
    maskId?: string;
    pointIndex: number;
    handleType: 'pos' | 'in' | 'out' | 'pull';
  } | null>(null);

  // オプティミスティックUI用のローカルオーバーライド
  const [localLayerOverrides, setLocalLayerOverrides] = useState<Record<string, Partial<Layer>>>({});
  const localOverridesRef = useRef<Record<string, Partial<Layer>>>({});

  const handlePenMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'pen') return;
    e.preventDefault();
    const container = e.currentTarget;
    const canvasDiv = container.firstElementChild as HTMLElement | null;
    if (!canvasDiv) return;
    const canvasRect = canvasDiv.getBoundingClientRect();
    
    const compX = (e.clientX - canvasRect.left) / scale;
    const compY = (e.clientY - canvasRect.top) / scale;
    const screenX = e.clientX - canvasRect.left;
    const screenY = e.clientY - canvasRect.top;

    const store = useLayerStore.getState();

    let currentPenDraw = penDraw;
    if (currentPenDraw) {
      const layer = store.layers.find(l => l.id === currentPenDraw!.layerId);
      let isValid = false;
      if (layer) {
        if (currentPenDraw.maskId && layer.masks) {
          isValid = layer.masks.some(m => m.id === currentPenDraw!.maskId);
        } else if (layer.shapeData?.points) {
          isValid = true;
        }
      }
      if (!isValid) {
        currentPenDraw = null;
        setPenDraw(null);
      }
    }

    let hitPoint: { layerId: string; maskId?: string; pointIndex: number; handleType: 'pos' | 'in' | 'out' } | null = null;
    
    // ヘルパー: ワールド座標からローカル座標への変換
    const getWorldToLocal = (layer: Layer, worldX: number, worldY: number): [number, number] => {
      const frame = useTimelineStore.getState().currentFrame;
      const animations = useLayerStore.getState().animations;
      const layers = useLayerStore.getState().layers;
      const resolved = resolveOverlayWorldTransform(layer, layers, frame, animations);
      const dx = worldX - resolved.position[0];
      const dy = worldY - resolved.position[1];
      const rot = (resolved.rotation * Math.PI) / 180;
      const sx = resolved.scale[0] / 100;
      const sy = resolved.scale[1] / 100;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      const lx = sx !== 0 ? rx / sx : 0;
      const ly = sy !== 0 ? ry / sy : 0;
      return [lx + resolved.anchorPoint[0], ly + resolved.anchorPoint[1]];
    };
    for (const layerId of store.selectedLayerIds) {
      const layer = store.layers.find(l => l.id === layerId);
      if (!layer) continue;
      
      const frame = useTimelineStore.getState().currentFrame;
      const resolved = resolveOverlayWorldTransform(layer, store.layers, frame, store.animations);
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
          
          if ((p.in[0] !== 0 || p.in[1] !== 0) && Math.hypot(screenX - ix, screenY - iy) < HIT_TEST_RADIUS_HANDLE) {
            hitPoint = { layerId: layer.id, maskId, pointIndex: i, handleType: 'in' };
            return true;
          }
          if ((p.out[0] !== 0 || p.out[1] !== 0) && Math.hypot(screenX - ox, screenY - oy) < HIT_TEST_RADIUS_HANDLE) {
            hitPoint = { layerId: layer.id, maskId, pointIndex: i, handleType: 'out' };
            return true;
          }
          if (Math.hypot(screenX - px, screenY - py) < HIT_TEST_RADIUS_POS) {
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
          return;
        }

        if (activePenType === 'convert' && hitPoint.handleType === 'pos') {
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
              return;
            } else {
              setPointDrag({ ...hitPoint, handleType: 'pull' as any });
              return;
            }
          }
        }
      }

      setPointDrag(hitPoint);
      return;
    }

    if (currentPenDraw) {
      const layer = store.layers.find(l => l.id === currentPenDraw!.layerId);
      if (layer) {
        let points: BezierPoint[] = [];
        if (currentPenDraw.maskId && layer.masks) {
          const mask = layer.masks.find(m => m.id === currentPenDraw!.maskId);
          if (mask) points = mask.points;
        } else if (layer.shapeData?.points) {
          points = layer.shapeData.points;
        }
        
        if (points.length > 0) {
          const firstP = points[0];
          const frame = useTimelineStore.getState().currentFrame;
          const resolved = resolveOverlayWorldTransform(layer, store.layers, frame, store.animations);
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

          if (screenDist < SNAP_CLOSE_RADIUS) {
            store.saveSnapshot();
            if (currentPenDraw.maskId && layer.masks) {
              const newMasks = layer.masks.map(m => m.id === currentPenDraw!.maskId ? { ...m, closed: true } : m);
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

    if (!currentPenDraw) {
      const activePenType = useUIStore.getState().activePenType;
      if (activePenType === 'remove' || activePenType === 'convert') {
        return;
      }

      const selectedId = store.selectedLayerIds.length === 1 ? store.selectedLayerIds[0] : null;
      let targetLayerId = '';
      let targetMaskId: string | undefined = undefined;
      let initialLocalPos: [number, number] = [compX, compY];

      store.saveSnapshot();

      if (selectedId) {
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
            position: [0, 0],
            anchorPoint: [0, 0],
          }
        });
      }
      setPenDraw({ layerId: targetLayerId, maskId: targetMaskId, currentIndex: 0, isDragging: true });

    } else {
      const activePenType = useUIStore.getState().activePenType;
      if (activePenType === 'remove' || activePenType === 'convert') {
        return;
      }

      const layer = store.layers.find(l => l.id === currentPenDraw!.layerId);
      if (layer) {
        store.saveSnapshot();
        const localPos = getWorldToLocal(layer, compX, compY);
        const newPoint: BezierPoint = { pos: localPos, in: [0,0], out: [0,0] };
        
        let newIndex = 0;
        if (currentPenDraw.maskId && layer.masks) {
          const maskIdx = layer.masks.findIndex(m => m.id === currentPenDraw!.maskId);
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
        setPenDraw({ ...currentPenDraw, currentIndex: newIndex, isDragging: true });
      }
    }
  }, [activeTool, scale, penDraw]);

  // 新規ポイント追加時のドラッグ
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

      const frame = useTimelineStore.getState().currentFrame;
      const animations = store.animations;
      const layers = store.layers;
      
      const getWorldToLocal = (l: Layer, worldX: number, worldY: number): [number, number] => {
        const resolved = resolveOverlayWorldTransform(l, layers, frame, animations);
        const dx = worldX - resolved.position[0];
        const dy = worldY - resolved.position[1];
        const rot = (resolved.rotation * Math.PI) / 180;
        const sx = resolved.scale[0] / 100;
        const sy = resolved.scale[1] / 100;
        const cos = Math.cos(-rot);
        const sin = Math.sin(-rot);
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        const lx = sx !== 0 ? rx / sx : 0;
        const ly = sy !== 0 ? ry / sy : 0;
        return [lx + resolved.anchorPoint[0], ly + resolved.anchorPoint[1]];
      };

      const [lx, ly] = getWorldToLocal(layer, compX, compY);

      const updatePoints = (points: BezierPoint[]) => {
        const newPoints = [...points];
        const currentP = newPoints[penDraw.currentIndex];
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
          localOverridesRef.current = {
            ...localOverridesRef.current,
            [layer.id]: { masks: newMasks }
          };
          setLocalLayerOverrides(localOverridesRef.current);
        }
      } else if (layer.shapeData?.points) {
        localOverridesRef.current = {
          ...localOverridesRef.current,
          [layer.id]: { shapeData: { ...layer.shapeData!, points: updatePoints(layer.shapeData.points) } }
        };
        setLocalLayerOverrides(localOverridesRef.current);
      }
    };

    const handleUp = () => {
      const override = localOverridesRef.current[penDraw.layerId];
      if (override) {
        useLayerStore.getState().updateLayer(penDraw.layerId, override);
      }
      localOverridesRef.current = {};
      setLocalLayerOverrides({});
      setPenDraw(prev => prev ? { ...prev, isDragging: false } : null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [activeTool, penDraw, scale, containerRef]);

  // 既存ポイントのドラッグ処理
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

      const frame = useTimelineStore.getState().currentFrame;
      const animations = store.animations;
      const layers = store.layers;
      
      const getWorldToLocal = (l: Layer, worldX: number, worldY: number): [number, number] => {
        const resolved = resolveOverlayWorldTransform(l, layers, frame, animations);
        const dx = worldX - resolved.position[0];
        const dy = worldY - resolved.position[1];
        const rot = (resolved.rotation * Math.PI) / 180;
        const sx = resolved.scale[0] / 100;
        const sy = resolved.scale[1] / 100;
        const cos = Math.cos(-rot);
        const sin = Math.sin(-rot);
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        const lx = sx !== 0 ? rx / sx : 0;
        const ly = sy !== 0 ? ry / sy : 0;
        return [lx + resolved.anchorPoint[0], ly + resolved.anchorPoint[1]];
      };

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
          localOverridesRef.current = {
            ...localOverridesRef.current,
            [layer.id]: { masks: newMasks }
          };
          setLocalLayerOverrides(localOverridesRef.current);
        }
      } else if (layer.shapeData?.points) {
        localOverridesRef.current = {
          ...localOverridesRef.current,
          [layer.id]: { shapeData: { ...layer.shapeData!, points: updatePoints(layer.shapeData.points) } }
        };
        setLocalLayerOverrides(localOverridesRef.current);
      }
    };

    const handleUp = () => {
      const override = localOverridesRef.current[pointDrag.layerId];
      if (override) {
        useLayerStore.getState().updateLayer(pointDrag.layerId, override);
      }
      localOverridesRef.current = {};
      setLocalLayerOverrides({});
      setPointDrag(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [activeTool, pointDrag, scale, containerRef]);

  // ペンツールのキャンセル (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTool === 'pen' && penDraw) {
          setPenDraw(null);
          setTool('select');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, penDraw, setTool]);

  return {
    penDraw,
    pointDrag,
    localLayerOverrides,
    localOverridesRef,
    handlePenMouseDown
  };
}
