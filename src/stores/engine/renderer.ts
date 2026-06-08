import type { Layer } from '../../types/layer';
import type { AnimatedProperty } from '../../types/keyframe';
import { interpolateValue } from './keyframe';

/**
 * Canvas 2D ベースのレンダラー
 * キーフレームアニメーション対応
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private _backgroundColor: string;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.width = width;
    this.height = height;
    this._backgroundColor = '#000000';
    this.resize(width, height);
  }

  /** サイズ変更（内部バッファのみ。CSS sizeはReact側で管理） */
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  /** 背景色設定 */
  set backgroundColor(color: string) {
    this._backgroundColor = color;
  }

  /**
   * フレームを描画
   * animationsを受け取ってキーフレーム補間を適用
   */
  renderFrame(
    layers: Layer[],
    currentFrame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ) {
    const ctx = this.ctx;

    // DPRリセット（resize時にscaleが掛かってるので再適用）
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 背景クリア
    ctx.fillStyle = this._backgroundColor;
    ctx.fillRect(0, 0, this.width, this.height);

    // 背面から前面に向かって描画（配列の末尾が背面）
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];

      // 非表示・範囲外はスキップ
      if (!layer.visible) continue;
      if (currentFrame < layer.inPoint || currentFrame > layer.outPoint) continue;

      // キーフレームアニメーションからトランスフォームを取得
      const transform = this.resolveTransform(layer, currentFrame, animations);

      ctx.save();
      this.applyBlendMode(ctx, layer);
      ctx.globalAlpha = transform.opacity / 100;

      if (transform.directionalScale) {
        // 方向別スケール: 各方向を独立に適用
        this.applyDirectionalScale(ctx, layer, transform);
      } else {
        // 通常スケール
        this.applyTransformValues(ctx, transform);
      }

      switch (layer.type) {
        case 'solid':
          this.renderSolid(ctx, layer);
          break;
        case 'text':
          this.renderText(ctx, layer, currentFrame, animations);
          break;
        case 'shape':
          this.renderShape(ctx, layer, currentFrame, animations);
          break;
        default:
          this.renderPlaceholder(ctx, layer);
          break;
      }

      ctx.restore();
    }
  }

  /** キーフレームアニメーションを考慮したトランスフォーム値を解決 */
  private resolveTransform(
    layer: Layer,
    frame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ): {
    anchorPoint: [number, number];
    position: [number, number];
    scale: [number, number];
    rotation: number;
    opacity: number;
    directionalScale?: { top?: number; bottom?: number; left?: number; right?: number };
  } {
    const base = layer.transform;
    const result: {
      anchorPoint: [number, number];
      position: [number, number];
      scale: [number, number];
      rotation: number;
      opacity: number;
      directionalScale?: { top?: number; bottom?: number; left?: number; right?: number };
    } = {
      anchorPoint: [...base.anchorPoint] as [number, number],
      position: [...base.position] as [number, number],
      scale: [...base.scale] as [number, number],
      rotation: base.rotation,
      opacity: base.opacity,
    };

    // transform自体に方向別スケールがあればセット
    if (base.directionalScale) {
      result.directionalScale = { ...base.directionalScale };
    }

    if (!animations) return result;
    const layerAnim = animations[layer.id];
    if (!layerAnim) return result;

    // 方向別スケール検出用
    const dirScale: { top?: number; bottom?: number; left?: number; right?: number } = {};
    let hasDirectional = false;

    // 各プロパティのキーフレーム補間値を適用
    for (const [propName, prop] of Object.entries(layerAnim)) {
      if (prop.keyframes.length === 0) continue;
      const val = interpolateValue(prop, frame);
      if (val === null) continue;

      switch (propName) {
        case 'anchorPoint':
          if (Array.isArray(val)) result.anchorPoint = val as [number, number];
          break;
        case 'anchorPoint.x':
          if (typeof val === 'number') result.anchorPoint[0] = val;
          break;
        case 'anchorPoint.y':
          if (typeof val === 'number') result.anchorPoint[1] = val;
          break;
        case 'position':
          if (Array.isArray(val)) result.position = val as [number, number];
          break;
        case 'position.x':
          if (typeof val === 'number') result.position[0] = val;
          break;
        case 'position.y':
          if (typeof val === 'number') result.position[1] = val;
          break;
        case 'scale':
          if (Array.isArray(val)) result.scale = val as [number, number];
          break;
        case 'scale.x':
          if (typeof val === 'number') result.scale[0] = val;
          break;
        case 'scale.y':
          if (typeof val === 'number') result.scale[1] = val;
          break;
        case 'scale.top':
          if (typeof val === 'number') { dirScale.top = val; hasDirectional = true; }
          break;
        case 'scale.bottom':
          if (typeof val === 'number') { dirScale.bottom = val; hasDirectional = true; }
          break;
        case 'scale.left':
          if (typeof val === 'number') { dirScale.left = val; hasDirectional = true; }
          break;
        case 'scale.right':
          if (typeof val === 'number') { dirScale.right = val; hasDirectional = true; }
          break;
        case 'rotation':
          if (typeof val === 'number') result.rotation = val;
          break;
        case 'opacity':
          if (typeof val === 'number') result.opacity = val;
          break;
      }
    }

    if (hasDirectional) {
      result.directionalScale = dirScale;
    }

    return result;
  }

  /** トランスフォーム適用（解決済みの値を使う） */
  private applyTransformValues(
    ctx: CanvasRenderingContext2D,
    transform: {
      anchorPoint: [number, number];
      position: [number, number];
      scale: [number, number];
      rotation: number;
      opacity: number;
    },
  ) {
    ctx.translate(transform.position[0], transform.position[1]);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale[0] / 100, transform.scale[1] / 100);
    ctx.translate(-transform.anchorPoint[0], -transform.anchorPoint[1]);
  }

  /** 方向別スケール適用 */
  private applyDirectionalScale(
    ctx: CanvasRenderingContext2D,
    _layer: Layer,
    transform: {
      anchorPoint: [number, number];
      position: [number, number];
      scale: [number, number];
      rotation: number;
      opacity: number;
      directionalScale?: { top?: number; bottom?: number; left?: number; right?: number };
    },
  ) {
    const ds = transform.directionalScale!;
    const ap = transform.anchorPoint;

    // ベースの位置と回転
    ctx.translate(transform.position[0], transform.position[1]);
    ctx.rotate((transform.rotation * Math.PI) / 180);

    // 方向別スケール計算
    // ソリッドは(-w/2, -h/2)から(w/2, h/2)に描画される
    // アンカーオフセット後、描画原点は(-ap.x, -ap.y)
    // ソリッド中心は(-ap.x + 0, -ap.y + 0) = (-ap.x, -ap.y)

    let sx = transform.scale[0] / 100;
    let sy = transform.scale[1] / 100;
    let offsetX = 0;
    let offsetY = 0;

    if (ds.top !== undefined || ds.bottom !== undefined) {
      const topFactor = (ds.top ?? transform.scale[1]) / 100;
      const bottomFactor = (ds.bottom ?? transform.scale[1]) / 100;
      // 合成Y倍率
      sy = (topFactor + bottomFactor) / 2;
      // 非対称オフセット: bottom > top → 下に伸びる → 原点を上にずらす
      // ソリッド中心（アンカー基準）からのズレ
      // 上端が topFactor で、下端が bottomFactor なので、
      // 全体の中心は (bottomFactor - topFactor) / (topFactor + bottomFactor) だけずれる
      // これをスケール前の座標で計算し、描画オフセットとして適用
      offsetY = (bottomFactor - topFactor) / 2 * (this.height / 2);
    }

    if (ds.left !== undefined || ds.right !== undefined) {
      const leftFactor = (ds.left ?? transform.scale[0]) / 100;
      const rightFactor = (ds.right ?? transform.scale[0]) / 100;
      sx = (leftFactor + rightFactor) / 2;
      offsetX = (rightFactor - leftFactor) / 2 * (this.width / 2);
    }

    // オフセットを適用してからスケール
    ctx.translate(offsetX, offsetY);
    ctx.scale(sx, sy);
    ctx.translate(-ap[0], -ap[1]);
  }

  /** ブレンドモード適用 */
  private applyBlendMode(ctx: CanvasRenderingContext2D, layer: Layer) {
    const modeMap: Record<string, GlobalCompositeOperation> = {
      normal: 'source-over',
      multiply: 'multiply',
      screen: 'screen',
      overlay: 'overlay',
      add: 'lighter',
      darken: 'darken',
      lighten: 'lighten',
    };
    ctx.globalCompositeOperation = modeMap[layer.blendMode] || 'source-over';
  }

  /** 数値プロパティのKF補間値を解決（汎用） */
  private resolveNumericProp(
    layerId: string,
    propName: string,
    defaultValue: number,
    frame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ): number {
    if (!animations) return defaultValue;
    const layerAnim = animations[layerId];
    if (!layerAnim) return defaultValue;
    const prop = layerAnim[propName];
    if (!prop || prop.keyframes.length === 0) return defaultValue;
    const val = interpolateValue(prop, frame);
    return typeof val === 'number' ? val : defaultValue;
  }

  /** ソリッドレイヤー描画 */
  private renderSolid(ctx: CanvasRenderingContext2D, layer: Layer) {
    ctx.fillStyle = layer.solidColor || '#6C5CE7';
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
  }

  /** テキストレイヤー描画（KF補間対応） */
  private renderText(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    frame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ) {
    if (!layer.textStyle) return;
    const style = layer.textStyle;

    // KF補間値を取得（あればオーバーライド）
    const fontSize = this.resolveNumericProp(layer.id, 'text.fontSize', style.fontSize, frame, animations);
    const fontWeight = this.resolveNumericProp(layer.id, 'text.fontWeight', style.fontWeight, frame, animations);
    const lineHeight = this.resolveNumericProp(layer.id, 'text.lineHeight', style.lineHeight, frame, animations);
    const letterSpacing = this.resolveNumericProp(layer.id, 'text.letterSpacing', style.letterSpacing, frame, animations);

    ctx.font = `${fontWeight} ${fontSize}px "${style.fontFamily}", sans-serif`;
    ctx.fillStyle = style.color;
    ctx.textAlign = style.textAlign;
    ctx.textBaseline = 'middle';

    // letterSpacing 対応（Canvas2D letterSpacingプロパティ / Chrome 99+）
    if (letterSpacing && 'letterSpacing' in ctx) {
      (ctx as any).letterSpacing = `${letterSpacing}px`;
    }

    const lines = style.text.split('\n');
    const lh = fontSize * lineHeight;
    const totalHeight = lines.length * lh;
    const startY = -totalHeight / 2 + lh / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, 0, startY + i * lh);
    });

    // letterSpacingリセット
    if ('letterSpacing' in ctx) {
      (ctx as any).letterSpacing = '0px';
    }
  }

  /** シェイプレイヤー描画（KF補間対応） */
  private renderShape(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    frame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ) {
    if (!layer.shapeData) return;
    const shape = layer.shapeData;

    // KF補間値を取得
    const fillOpacity = this.resolveNumericProp(layer.id, 'shape.fillOpacity', shape.fillOpacity ?? 100, frame, animations);
    const strokeWidth = this.resolveNumericProp(layer.id, 'shape.strokeWidth', shape.strokeWidth, frame, animations);
    const cornerRadius = this.resolveNumericProp(layer.id, 'shape.cornerRadius', shape.cornerRadius ?? 0, frame, animations);

    ctx.fillStyle = shape.fill;
    ctx.globalAlpha *= fillOpacity / 100;

    const hasStroke = shape.stroke !== 'transparent' && strokeWidth > 0;
    if (hasStroke) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = shape.strokeLineCap ?? 'butt';
    }

    switch (shape.shapeType) {
      case 'rectangle':
        this.renderRectangle(ctx, cornerRadius, hasStroke);
        break;
      case 'ellipse':
        this.renderEllipse(ctx, hasStroke);
        break;
      case 'star':
        this.renderStar(ctx, 5, 100, 45, hasStroke);
        break;
    }
  }

  /** 矩形描画 */
  private renderRectangle(ctx: CanvasRenderingContext2D, cornerRadius: number, hasStroke: boolean) {
    const w = 200;
    const h = 200;
    if (cornerRadius > 0) {
      this.roundRect(ctx, -w / 2, -h / 2, w, h, cornerRadius);
    } else {
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    if (hasStroke) {
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
  }

  /** 楕円描画 */
  private renderEllipse(ctx: CanvasRenderingContext2D, hasStroke: boolean) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 100, 100, 0, 0, Math.PI * 2);
    ctx.fill();
    if (hasStroke) ctx.stroke();
  }

  /** 星型描画 */
  private renderStar(
    ctx: CanvasRenderingContext2D,
    points: number,
    outerRadius: number,
    innerRadius: number,
    hasStroke: boolean,
  ) {
    ctx.beginPath();
    const step = Math.PI / points;

    for (let i = 0; i < 2 * points; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = i * step - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.fill();
    if (hasStroke) ctx.stroke();
  }

  /** 角丸四角形 */
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  /** プレースホルダー描画 */
  private renderPlaceholder(ctx: CanvasRenderingContext2D, layer: Layer) {
    ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.fillRect(-100, -50, 200, 100);
    ctx.fillStyle = '#999';
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`[${layer.type}]`, 0, 0);
  }

  /** キャンバスをクリア */
  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
