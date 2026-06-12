import type { Layer } from '../../types/layer';
import type { AnimatedProperty } from '../../types/keyframe';
import { interpolateValue } from './keyframe';

/**
 * AEライクなエクスプレッション評価エンジン
 * プロパティ値をスクリプトで動的に計算する
 */

/** 評価コンテキスト（エクスプレッション内で使える変数群） */
export interface ExpressionContext {
  /** 現在時刻（秒） */
  time: number;
  /** 現在フレーム番号 */
  frame: number;
  /** エクスプレッション適用前の現在値 */
  value: number | number[];
  /** FPS */
  fps: number;
  /** 全レイヤー */
  layers: Layer[];
  /** 全アニメーションデータ */
  animations: Record<string, Record<string, AnimatedProperty>>;
  /** 対象のレイヤー */
  thisLayer: Layer;
  /** プロパティ名 */
  propertyName: string;
}

/** 循環参照防止用の評価スタック */
let evaluationDepth = 0;
const MAX_EVAL_DEPTH = 10;

/** コンパイル済みエクスプレッションのキャッシュ */
const compiledCache = new Map<string, (sandbox: Record<string, unknown>) => unknown>();

/**
 * エクスプレッションを評価して値を返す
 * 失敗時はフォールバック値を返す
 */
export function evaluateExpression(
  expr: string,
  context: ExpressionContext,
): number | number[] | null {
  if (!expr || expr.trim() === '') return null;

  // 循環参照ガード
  if (evaluationDepth >= MAX_EVAL_DEPTH) {
    console.warn('[Expression] 循環参照の深度制限に達しました');
    return null;
  }

  evaluationDepth++;
  try {
    const fn = compileExpression(expr);
    const sandbox = createSandbox(context);
    const result = fn(sandbox);

    // 結果のバリデーション
    if (typeof result === 'number' && isFinite(result)) {
      return result;
    }
    if (Array.isArray(result) && result.every((v: unknown) => typeof v === 'number' && isFinite(v as number))) {
      return result as number[];
    }

    return null;
  } catch (e) {
    // エラーは黙って無視（AEと同じ挙動: エクスプレッション失敗時はフォールバック）
    return null;
  } finally {
    evaluationDepth--;
  }
}

/** エクスプレッションをコンパイル（キャッシュ付き） */
function compileExpression(expr: string): (sandbox: Record<string, unknown>) => unknown {
  // セミコロン末尾を削除（return付加のため）
  const trimmed = expr.trim().replace(/;$/, '');

  if (compiledCache.has(trimmed)) {
    return compiledCache.get(trimmed)!;
  }

  // サンドボックス変数をパラメータとして受け取る関数を生成
  // Proxy でグローバルアクセスをブロック
  const fn = new Function(
    '$',
    `with ($) {
      ${trimmed.includes('return') ? trimmed : `return (${trimmed})`}
    }`,
  ) as (sandbox: Record<string, unknown>) => unknown;

  // Proxyでラップして、サンドボックスに存在しないプロパティへのアクセスを undefined にする
  const safeFn = (sandbox: Record<string, unknown>): unknown => {
    /** ブロックするグローバルオブジェクト */
    const BLOCKED_GLOBALS = new Set([
      'window', 'self', 'globalThis', 'document', 'location', 'navigator',
      'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
      'eval', 'Function', 'setTimeout', 'setInterval', 'requestAnimationFrame',
      'localStorage', 'sessionStorage', 'indexedDB',
      'crypto', 'alert', 'confirm', 'prompt', 'open', 'close',
      'postMessage', 'Worker', 'SharedWorker', 'ServiceWorker',
    ]);

    const proxy = new Proxy(sandbox, {
      has: () => true, // with文ですべてのルックアップをProxyに向ける
      get: (target, prop: string) => {
        if (BLOCKED_GLOBALS.has(prop)) return undefined;
        if (prop in target) return target[prop];
        return undefined;
      },
      set: () => false, // 書き込み禁止
    });

    return fn(proxy);
  };

  compiledCache.set(trimmed, safeFn);
  return safeFn;
}

/** エクスプレッション内で使える変数・関数群（サンドボックス） */
function createSandbox(ctx: ExpressionContext): Record<string, unknown> {
  const { time, frame, value, fps, layers, animations, thisLayer, propertyName } = ctx;

  // シード付き疑似乱数（wiggle用: フレームごとに決定的）
  const seedRandom = (seed: number): number => {
    const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  /**
   * wiggle(freq, amp, octaves, ampMult, time)
   * AEのwiggleに近い挙動
   */
  const wiggle = (freq: number, amp: number, octaves = 1, ampMult = 0.5, t = time): number | number[] => {
    let result: number | number[];
    if (Array.isArray(value)) {
      result = value.map((v, i) => {
        let total = 0;
        let currentAmp = amp;
        let currentFreq = freq;
        for (let o = 0; o < octaves; o++) {
          const seed = (t * currentFreq + i * 1000 + o * 7919) * 100;
          const noise = (seedRandom(Math.floor(seed)) * 2 - 1);
          const nextNoise = (seedRandom(Math.floor(seed) + 1) * 2 - 1);
          const frac = seed - Math.floor(seed);
          const smoothed = noise + (nextNoise - noise) * (frac * frac * (3 - 2 * frac));
          total += smoothed * currentAmp;
          currentAmp *= ampMult;
          currentFreq *= 2;
        }
        return v + total;
      });
    } else {
      let total = 0;
      let currentAmp = amp;
      let currentFreq = freq;
      for (let o = 0; o < octaves; o++) {
        const seed = (t * currentFreq + o * 7919) * 100;
        const noise = (seedRandom(Math.floor(seed)) * 2 - 1);
        const nextNoise = (seedRandom(Math.floor(seed) + 1) * 2 - 1);
        const frac = seed - Math.floor(seed);
        const smoothed = noise + (nextNoise - noise) * (frac * frac * (3 - 2 * frac));
        total += smoothed * currentAmp;
        currentAmp *= ampMult;
        currentFreq *= 2;
      }
      result = (value as number) + total;
    }
    return result;
  };

  /** linear(t, tMin, tMax, valMin, valMax) */
  const linear = (t: number, tMin: number, tMax: number, valMin: number, valMax: number): number => {
    if (t <= tMin) return valMin;
    if (t >= tMax) return valMax;
    return valMin + (valMax - valMin) * ((t - tMin) / (tMax - tMin));
  };

  /** ease(t, tMin, tMax, valMin, valMax) — スムーズ補間 */
  const ease = (t: number, tMin: number, tMax: number, valMin: number, valMax: number): number => {
    if (t <= tMin) return valMin;
    if (t >= tMax) return valMax;
    const p = (t - tMin) / (tMax - tMin);
    const smoothed = p * p * (3 - 2 * p); // smoothstep
    return valMin + (valMax - valMin) * smoothed;
  };

  /** easeIn(t, tMin, tMax, valMin, valMax) */
  const easeIn = (t: number, tMin: number, tMax: number, valMin: number, valMax: number): number => {
    if (t <= tMin) return valMin;
    if (t >= tMax) return valMax;
    const p = (t - tMin) / (tMax - tMin);
    return valMin + (valMax - valMin) * (p * p);
  };

  /** easeOut(t, tMin, tMax, valMin, valMax) */
  const easeOut = (t: number, tMin: number, tMax: number, valMin: number, valMax: number): number => {
    if (t <= tMin) return valMin;
    if (t >= tMax) return valMax;
    const p = (t - tMin) / (tMax - tMin);
    return valMin + (valMax - valMin) * (1 - (1 - p) * (1 - p));
  };

  /** loopIn(type, numKf) — 開始前のループ */
  const loopIn = (type: 'cycle' | 'pingpong' = 'cycle', _numKf = 0): number | number[] => {
    const anim = animations[thisLayer.id]?.[propertyName];
    if (!anim || anim.keyframes.length < 2) return value;
    const firstTime = anim.keyframes[0].time / fps;
    const lastTime = anim.keyframes[anim.keyframes.length - 1].time / fps;
    if (time >= firstTime) return value;
    const duration = lastTime - firstTime;
    if (duration <= 0) return value;
    let loopedTime: number;
    if (type === 'pingpong') {
      const cycles = Math.abs(time - firstTime) / duration;
      const phase = cycles % 2;
      loopedTime = phase < 1 ? lastTime - phase * duration : firstTime + (phase - 1) * duration;
    } else {
      loopedTime = lastTime - ((firstTime - time) % duration);
    }
    return interpolateValue(anim, loopedTime * fps) ?? value;
  };

  /** loopOut(type, numKf) — 終了後のループ */
  const loopOut = (type: 'cycle' | 'pingpong' = 'cycle', _numKf = 0): number | number[] => {
    const anim = animations[thisLayer.id]?.[propertyName];
    if (!anim || anim.keyframes.length < 2) return value;
    const firstTime = anim.keyframes[0].time / fps;
    const lastTime = anim.keyframes[anim.keyframes.length - 1].time / fps;
    if (time <= lastTime) return value;
    const duration = lastTime - firstTime;
    if (duration <= 0) return value;
    let loopedTime: number;
    if (type === 'pingpong') {
      const cycles = (time - lastTime) / duration;
      const phase = cycles % 2;
      loopedTime = phase < 1 ? firstTime + phase * duration : lastTime - (phase - 1) * duration;
    } else {
      loopedTime = firstTime + ((time - firstTime) % duration);
    }
    return interpolateValue(anim, loopedTime * fps) ?? value;
  };

  /** clamp(val, min, max) */
  const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);

  /** degreesToRadians / radiansToDegrees */
  const degreesToRadians = (d: number): number => d * Math.PI / 180;
  const radiansToDegrees = (r: number): number => r * 180 / Math.PI;

  /** random(min, max) — フレーム単位でシード固定（AEと同じ） */
  const random = (min = 0, max = 1): number => {
    const r = seedRandom(frame * 9973 + propertyName.length * 137);
    return min + r * (max - min);
  };

  /** thisComp.layer(name) — 名前でレイヤーを取得 */
  const thisComp = {
    layer: (nameOrIndex: string | number): Layer | undefined => {
      if (typeof nameOrIndex === 'number') {
        return layers[nameOrIndex - 1]; // AEは1始まり
      }
      return layers.find(l => l.name === nameOrIndex);
    },
    numLayers: layers.length,
    frameDuration: 1 / fps,
    duration: layers.reduce((max, l) => Math.max(max, l.outPoint / fps), 0),
  };

  return {
    // 基本変数
    time,
    frame,
    value,
    fps,
    thisLayer,
    thisComp,
    // AEビルトイン関数
    wiggle,
    linear,
    ease,
    easeIn,
    easeOut,
    loopIn,
    loopOut,
    clamp,
    degreesToRadians,
    radiansToDegrees,
    random,
    // Math
    Math,
    // ヘルパー
    toWorld: (v: number[]) => v, // 将来の3D対応プレースホルダー
  };
}

/** エクスプレッションキャッシュをクリア（開発用） */
export function clearExpressionCache(): void {
  compiledCache.clear();
}
