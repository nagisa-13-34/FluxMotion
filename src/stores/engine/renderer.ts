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
      this.applyTransformValues(ctx, transform);
      this.applyBlendMode(ctx, layer);
      ctx.globalAlpha = transform.opacity / 100;

      switch (layer.type) {
        case 'solid':
          this.renderSolid(ctx, layer);
          break;
        case 'text':
          this.renderText(ctx, layer);
          break;
        case 'shape':
          this.renderShape(ctx, layer);
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
  } {
    const base = layer.transform;
    const result = {
      anchorPoint: [...base.anchorPoint] as [number, number],
      position: [...base.position] as [number, number],
      scale: [...base.scale] as [number, number],
      rotation: base.rotation,
      opacity: base.opacity,
    };

    if (!animations) return result;
    const layerAnim = animations[layer.id];
    if (!layerAnim) return result;

    // 各プロパティのキーフレーム補間値を適用
    for (const [propName, prop] of Object.entries(layerAnim)) {
      if (prop.keyframes.length === 0) continue;
      const val = interpolateValue(prop, frame);
      if (val === null) continue;

      switch (propName) {
        case 'anchorPoint':
          if (Array.isArray(val)) result.anchorPoint = val as [number, number];
          break;
        case 'position':
          if (Array.isArray(val)) result.position = val as [number, number];
          break;
        case 'scale':
          if (Array.isArray(val)) result.scale = val as [number, number];
          break;
        case 'rotation':
          if (typeof val === 'number') result.rotation = val;
          break;
        case 'opacity':
          if (typeof val === 'number') result.opacity = val;
          break;
      }
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

  /** ソリッドレイヤー描画 */
  private renderSolid(ctx: CanvasRenderingContext2D, layer: Layer) {
    ctx.fillStyle = layer.solidColor || '#6C5CE7';
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
  }

  /** テキストレイヤー描画 */
  private renderText(ctx: CanvasRenderingContext2D, layer: Layer) {
    if (!layer.textStyle) return;
    const style = layer.textStyle;
    ctx.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}", sans-serif`;
    ctx.fillStyle = style.color;
    ctx.textAlign = style.textAlign;
    ctx.textBaseline = 'middle';

    const lines = style.text.split('\n');
    const lineHeight = style.fontSize * style.lineHeight;
    const totalHeight = lines.length * lineHeight;
    const startY = -totalHeight / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, 0, startY + i * lineHeight);
    });
  }

  /** シェイプレイヤー描画 */
  private renderShape(ctx: CanvasRenderingContext2D, layer: Layer) {
    if (!layer.shapeData) return;
    const shape = layer.shapeData;

    ctx.fillStyle = shape.fill;
    if (shape.stroke !== 'transparent') {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth;
    }

    switch (shape.shapeType) {
      case 'rectangle':
        this.renderRectangle(ctx, shape.cornerRadius || 0, shape.stroke !== 'transparent');
        break;
      case 'ellipse':
        this.renderEllipse(ctx, shape.stroke !== 'transparent');
        break;
      case 'star':
        this.renderStar(ctx, 5, 100, 45, shape.stroke !== 'transparent');
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
