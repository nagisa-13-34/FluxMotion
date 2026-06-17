import BezierEasing from 'bezier-easing';
import type { Keyframe, AnimatedProperty } from '../../types/keyframe';

/**
 * キーフレーム補間エンジン
 * AEと同じキュービックベジェ方式で値を補間する
 */

/** ベジェイージング関数のキャッシュ */
const easingCache = new Map<string, (t: number) => number>();
const MAX_CACHE_SIZE = 1000;

export const EASING_PRESETS = {
  linear: [0, 0, 1, 1] as [number, number, number, number],
  easeIn: [0.42, 0, 1, 1] as [number, number, number, number],
  easeOut: [0, 0, 0.58, 1] as [number, number, number, number],
  easeInOut: [0.42, 0, 0.58, 1] as [number, number, number, number],
};

/** 小数点以下を丸める（キャッシュヒット率向上） */
function roundPoints(points: [number, number, number, number]): [number, number, number, number] {
  return [
    Math.round(points[0] * 1000) / 1000,
    Math.round(points[1] * 1000) / 1000,
    Math.round(points[2] * 1000) / 1000,
    Math.round(points[3] * 1000) / 1000,
  ];
}

/** ベジェイージング関数を取得（キャッシュ付き） */
function getEasing(points: [number, number, number, number]): (t: number) => number {
  const rounded = roundPoints(points);
  const key = rounded.join(',');
  if (!easingCache.has(key)) {
    // キャッシュサイズ上限を超えたら古いものを削除
    if (easingCache.size >= MAX_CACHE_SIZE) {
      const firstKey = easingCache.keys().next().value;
      if (firstKey) easingCache.delete(firstKey);
    }
    easingCache.set(key, BezierEasing(rounded[0], rounded[1], rounded[2], rounded[3]));
  } else {
    // アクセスされたら最新として扱う（簡易LRU：削除して再追加）
    const fn = easingCache.get(key)!;
    easingCache.delete(key);
    easingCache.set(key, fn);
  }
  return easingCache.get(key)!;
}

/**
 * 指定時刻のアニメーション値を計算する
 */
export function interpolateValue(
  property: AnimatedProperty,
  time: number
): number | number[] | null {
  const { keyframes } = property;
  if (keyframes.length === 0) return null;

  // キーフレームが1つだけ → その値を返す
  if (keyframes.length === 1) return keyframes[0].value;

  // 最初のキーフレームより前
  if (time <= keyframes[0].time) return keyframes[0].value;

  // 最後のキーフレームより後
  if (time >= keyframes[keyframes.length - 1].time) {
    return keyframes[keyframes.length - 1].value;
  }

  // 2つのキーフレーム間を補間
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kf1 = keyframes[i];
    const kf2 = keyframes[i + 1];

    if (time >= kf1.time && time <= kf2.time) {
      return interpolateBetween(kf1, kf2, time);
    }
  }

  return null;
}

/** 2つのキーフレーム間の補間 */
function interpolateBetween(
  kf1: Keyframe,
  kf2: Keyframe,
  time: number
): number | number[] {
  // 正規化された時間 0〜1
  const t = (time - kf1.time) / (kf2.time - kf1.time);

  // ホールド（前のキーフレームの値をそのまま）
  if (kf1.interpolation === 'hold') {
    return kf1.value;
  }

  // イージング適用
  let progress: number;
  if (kf1.interpolation === 'bezier' && kf1.bezierPoints) {
    const easing = getEasing(kf1.bezierPoints);
    progress = easing(t);
  } else {
    // リニア
    progress = t;
  }

  // 値の補間
  if (typeof kf1.value === 'number' && typeof kf2.value === 'number') {
    return lerp(kf1.value, kf2.value, progress);
  }

  // 配列の場合（position, scale 等）
  if (Array.isArray(kf1.value) && Array.isArray(kf2.value)) {
    return kf1.value.map((v: number, i: number) =>
      lerp(v, (kf2.value as number[])[i], progress)
    );
  }

  return kf1.value;
}

/** 線形補間 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * キーフレームが存在するフレーム番号の一覧を返す
 */
export function getKeyframeTimes(property: AnimatedProperty): number[] {
  return property.keyframes.map((kf: Keyframe) => kf.time);
}

/**
 * 指定時刻にキーフレームが存在するか
 */
export function hasKeyframeAt(property: AnimatedProperty, time: number): boolean {
  return property.keyframes.some((kf: Keyframe) => kf.time === time);
}
