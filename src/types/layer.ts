/** レイヤーの種類 */
export type LayerType = 'solid' | 'text' | 'image' | 'video' | 'shape' | 'adjustment' | 'null' | 'precomp';

/** シェイプの種類 */
export type ShapeType = 'rectangle' | 'ellipse' | 'star' | 'path';

/** ブレンドモード */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add'
  | 'darken'
  | 'lighten';

/** トランスフォームプロパティ */
export interface Transform {
  anchorPoint: [number, number];
  position: [number, number];
  scale: [number, number];
  rotation: number;
  opacity: number;
  /** 方向別スケール（上下左右が独立） */
  directionalScale?: { top: number; bottom: number; left: number; right: number };
}

/** テキストレイヤー用のスタイル */
export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  /** 文字間隔（px） */
  letterSpacing: number;
}

/** ベジェ曲線の1つのポイント */
export interface BezierPoint {
  /** アンカーポイントの座標 [x, y] */
  pos: [number, number];
  /** インタンジェント（posからの相対座標）[x, y] */
  in: [number, number];
  /** アウトタンジェント（posからの相対座標）[x, y] */
  out: [number, number];
}

/** マスクデータ */
export interface Mask {
  id: string;
  name: string;
  points: BezierPoint[];
  closed: boolean;
  inverted: boolean;
  mode: 'add' | 'subtract' | 'intersect' | 'difference';
  /** マスクの不透明度（0-100） */
  opacity: number;
}

/** シェイプレイヤー用のデータ */
export interface ShapeData {
  shapeType: ShapeType;
  fill: string;
  /** 塗りの不透明度（0-100） */
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  /** 線端の形状 */
  strokeLineCap: 'butt' | 'round' | 'square';
  /** 矩形の角丸 */
  cornerRadius?: number;
  /** パスのポイント */
  points?: BezierPoint[];
  /** パスが閉じているか（パスツール専用） */
  closed?: boolean;
  /** シェイプの幅 */
  width?: number;
  /** シェイプの高さ */
  height?: number;
}

/** レイヤーの基本データ */
export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  /** 表示/非表示 */
  visible: boolean;
  /** ロック状態 */
  locked: boolean;
  /** ソロ表示 */
  solo: boolean;
  /** レイヤーの開始時刻（フレーム） */
  inPoint: number;
  /** レイヤーの終了時刻（フレーム） */
  outPoint: number;
  /** トランスフォーム */
  transform: Transform;
  /** ブレンドモード */
  blendMode: BlendMode;
  /** 親レイヤーのID */
  parentId: string | null;
  /** テキストレイヤーの場合 */
  textStyle?: TextStyle;
  /** シェイプレイヤーの場合 */
  shapeData?: ShapeData;
  /** ソリッドの色 */
  solidColor?: string;
  /** メディアファイルのパス/URL */
  mediaSource?: string;
  /** エクスプレッション（プロパティ名 → 式文字列） */
  expressions?: Record<string, string>;
  /** ラベルカラー（ユーザー設定の色タグ） */
  labelColor?: string;
  /** モーションブラー有効 */
  motionBlur?: boolean;
  /** プリコンポジション内のレイヤー（precompタイプのみ） */
  precompLayers?: Layer[];
  /** マスク */
  masks?: Mask[];
}

/** デフォルトのトランスフォーム */
export function createDefaultTransform(): Transform {
  return {
    anchorPoint: [0, 0],
    position: [960, 540],
    scale: [100, 100],
    rotation: 0,
    opacity: 100,
  };
}

/** ユニークID生成 */
export function generateId(): string {
  return crypto.randomUUID();
}
