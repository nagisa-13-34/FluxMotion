/** キーフレーム補間タイプ */
export type InterpolationType = 'linear' | 'bezier' | 'hold';

/**
 * キーフレーム1つ分のデータ
 * AEと同じキュービックベジェ方式
 */
export interface Keyframe {
  /** フレーム番号 */
  time: number;
  /** 値（数値 or 配列） */
  value: number | number[];
  /** 補間タイプ */
  interpolation: InterpolationType;
  /**
   * ベジェのコントロールポイント [x1, y1, x2, y2]
   * CSS cubic-bezier() と同じフォーマット
   */
  bezierPoints?: [number, number, number, number];
}

/**
 * アニメーション可能なプロパティ1つ分
 * 例: position, opacity, rotation, scale
 */
export interface AnimatedProperty {
  /** プロパティ名 */
  name: string;
  /** キーフレーム一覧（時間順にソート済み） */
  keyframes: Keyframe[];
}

/**
 * レイヤーに紐づくアニメーションデータ
 * レイヤーIDをキーにして管理する
 */
export interface LayerAnimation {
  layerId: string;
  properties: Record<string, AnimatedProperty>;
}

/** よく使うイージングプリセット */
export const EASING_PRESETS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeInQuad: [0.55, 0.085, 0.68, 0.53],
  easeOutQuad: [0.25, 0.46, 0.45, 0.94],
  easeInOutQuad: [0.455, 0.03, 0.515, 0.955],
  easeInCubic: [0.55, 0.055, 0.675, 0.19],
  easeOutCubic: [0.215, 0.61, 0.355, 1],
  easeInOutCubic: [0.645, 0.045, 0.355, 1],
  /** AEの「イーズイン・アウト」に近い */
  smooth: [0.25, 0.1, 0.25, 1],
  /** オーバーシュート */
  overshoot: [0.175, 0.885, 0.32, 1.275],
};
