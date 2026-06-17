/**
 * オーバーレイ用ワールドトランスフォーム解決
 * Preview.tsxとrenderer.tsの両方で使われていたロジックを共通化
 * （renderer.tsはCanvas2Dコンテキストと密結合のため独自実装を維持するが、
 *   Preview.tsxのオーバーレイ計算はこの関数を使う）
 */
import type { Layer } from '../../types/layer';
import type { AnimatedProperty } from '../../types/keyframe';
import { interpolateValue } from './keyframe';

export interface OverlayTransform {
  position: [number, number];
  scale: [number, number];
  rotation: number;
  anchorPoint: [number, number];
}

/**
 * KF補間 + 親子関係を考慮したワールドトランスフォームを解決する
 */
export function resolveOverlayWorldTransform(
  layer: Layer,
  allLayers: Layer[],
  currentFrame: number,
  animations: Record<string, Record<string, AnimatedProperty>>,
  visited: Set<string> = new Set(),
): OverlayTransform {
  // 循環参照ガード
  if (visited.has(layer.id)) {
    return {
      position: [...layer.transform.position] as [number, number],
      scale: [...layer.transform.scale] as [number, number],
      rotation: layer.transform.rotation,
      anchorPoint: [...layer.transform.anchorPoint] as [number, number],
    };
  }
  visited.add(layer.id);

  const base = layer.transform;
  const pos: [number, number] = [...base.position];
  const scl: [number, number] = [...base.scale];
  let rot = base.rotation;
  const ap: [number, number] = [...base.anchorPoint];

  // KF補間値の適用
  const layerAnim = animations[layer.id];
  if (layerAnim) {
    const interp = (name: string) => {
      const prop = layerAnim[name];
      return prop?.keyframes.length ? interpolateValue(prop, currentFrame) : null;
    };

    const pv = interp('position');
    if (Array.isArray(pv)) { pos[0] = pv[0]; pos[1] = pv[1]; }
    const px = interp('position.x');
    if (typeof px === 'number') pos[0] = px;
    const py = interp('position.y');
    if (typeof py === 'number') pos[1] = py;

    const sv = interp('scale');
    if (Array.isArray(sv)) { scl[0] = sv[0]; scl[1] = sv[1]; }
    const sxv = interp('scale.x');
    if (typeof sxv === 'number') scl[0] = sxv;
    const syv = interp('scale.y');
    if (typeof syv === 'number') scl[1] = syv;

    const rv = interp('rotation');
    if (typeof rv === 'number') rot = rv;

    const apv = interp('anchorPoint');
    if (Array.isArray(apv)) { ap[0] = apv[0]; ap[1] = apv[1]; }
    const apx = interp('anchorPoint.x');
    if (typeof apx === 'number') ap[0] = apx;
    const apy = interp('anchorPoint.y');
    if (typeof apy === 'number') ap[1] = apy;
  }

  // 親がない場合はローカルがそのままワールド
  if (!layer.parentId) {
    return { position: pos, scale: scl, rotation: rot, anchorPoint: ap };
  }

  // 親レイヤーを検索
  const parent = allLayers.find(l => l.id === layer.parentId);
  if (!parent) {
    return { position: pos, scale: scl, rotation: rot, anchorPoint: ap };
  }

  // 親のワールドトランスフォームを再帰的に解決
  const pw = resolveOverlayWorldTransform(parent, allLayers, currentFrame, animations, visited);

  // 親子合成（AE挙動: 子のpositionは親のアンカーポイント基準）
  const parentRad = (pw.rotation * Math.PI) / 180;
  const parentSx = pw.scale[0] / 100;
  const parentSy = pw.scale[1] / 100;
  const dx = pos[0] - pw.anchorPoint[0];
  const dy = pos[1] - pw.anchorPoint[1];
  const cos = Math.cos(parentRad);
  const sin = Math.sin(parentRad);

  return {
    anchorPoint: ap,
    position: [
      pw.position[0] + (dx * parentSx * cos - dy * parentSy * sin),
      pw.position[1] + (dx * parentSx * sin + dy * parentSy * cos),
    ],
    scale: [scl[0] * parentSx, scl[1] * parentSy],
    rotation: rot + pw.rotation,
  };
}

// Backward-compatible export name used by hooks/UI code.
export const resolveOverlayTransform = resolveOverlayWorldTransform;
