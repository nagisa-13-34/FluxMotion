import type { Layer } from '../../types/layer';
import type { AnimatedProperty } from '../../types/keyframe';
import { interpolateValue } from './keyframe';
import { evaluateExpression } from './expression';

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
  /** メディアキャッシュ（src → ロード済みエレメント） */
  private mediaCache: Map<string, HTMLImageElement | HTMLVideoElement> = new Map();

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

  /** FPS設定 */
  private _fps = 30;
  set fps(value: number) { this._fps = value; }

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

    // ソロレイヤーの判定（いずれかがsolo=trueならsoloレイヤーのみ描画）
    const hasSoloLayer = layers.some(l => l.solo);

    // 背面から前面に向かって描画（配列の末尾が背面）
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];

      // 非表示・範囲外はスキップ
      if (!layer.visible) continue;
      if (hasSoloLayer && !layer.solo) continue;
      if (currentFrame < layer.inPoint || currentFrame > layer.outPoint) continue;

      // キーフレームアニメーション + エクスプレッション + 親子継承からトランスフォームを取得
      const transform = this.resolveWorldTransform(layer, layers, currentFrame, animations);

       const renderContent = () => {
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
          case 'image':
            this.renderImage(ctx, layer);
            break;
          case 'video':
            this.renderVideo(ctx, layer, currentFrame);
            break;
          case 'precomp':
            this.renderPrecomp(ctx, layer, currentFrame, animations, layers);
            break;
          default:
            this.renderPlaceholder(ctx, layer);
            break;
        }
      };

      ctx.save();
      this.applyBlendMode(ctx, layer);

      if (layer.motionBlur && !transform.directionalScale) {
        // モーションブラー: ガウス分布で重み付けした16サンプル合成
        // シャッターアングル180°相当（前後0.5フレーム）
        const shutterAngle = 0.5; // 0.5 = 180°
        const numSamples = 16;

        // ガウス分布の重みを事前計算（σ=0.35で端が自然にフェードアウト）
        const sigma = 0.35;
        const weights: number[] = [];
        let totalWeight = 0;
        for (let i = 0; i < numSamples; i++) {
          const t = (i / (numSamples - 1)) * 2 - 1; // -1 ～ 1
          const w = Math.exp(-(t * t) / (2 * sigma * sigma));
          weights.push(w);
          totalWeight += w;
        }

        for (let i = 0; i < numSamples; i++) {
          const t = (i / (numSamples - 1)) * 2 - 1; // -1 ～ 1
          const offset = t * shutterAngle;
          const sampleFrame = currentFrame + offset;
          const sampleTransform = this.resolveWorldTransform(layer, layers, sampleFrame, animations);
          const sampleAlpha = (transform.opacity / 100) * (weights[i] / totalWeight);
          ctx.save();
          ctx.globalAlpha = sampleAlpha;
          this.applyTransformValues(ctx, sampleTransform);
          renderContent();
          ctx.restore();
        }
      } else {
        ctx.globalAlpha = transform.opacity / 100;
        if (transform.directionalScale) {
          this.renderDirectionalScale(ctx, transform, renderContent);
        } else {
          this.applyTransformValues(ctx, transform);
          renderContent();
        }
      }

      ctx.restore();
    }
  }

  /**
   * 親子継承を考慮したワールドトランスフォームを解決
   * 親レイヤーのトランスフォームを再帰的に適用する（AEと同じ挙動）
   */
  private resolveWorldTransform(
    layer: Layer,
    allLayers: Layer[],
    frame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
    visited: Set<string> = new Set(),
  ): {
    anchorPoint: [number, number];
    position: [number, number];
    scale: [number, number];
    rotation: number;
    opacity: number;
    directionalScale?: { top?: number; bottom?: number; left?: number; right?: number };
  } {
    // 循環参照ガード
    if (visited.has(layer.id)) {
      return this.resolveTransform(layer, frame, animations);
    }
    visited.add(layer.id);

    // 自身のローカルトランスフォーム（KF + エクスプレッション適用済み）
    const local = this.resolveTransform(layer, frame, animations);

    // エクスプレッション適用
    this.applyExpressions(local, layer, frame, allLayers, animations);

    // 親がない場合はローカルがそのままワールド
    if (!layer.parentId) return local;

    // 親レイヤーを検索
    const parent = allLayers.find(l => l.id === layer.parentId);
    if (!parent) return local;

    // 親のワールドトランスフォームを再帰的に解決
    const parentWorld = this.resolveWorldTransform(parent, allLayers, frame, animations, visited);

    // 親子合成: 子のpositionを親のトランスフォーム空間に変換
    // AEの挙動: 子のpositionは親のアンカーポイント基準
    const parentRad = (parentWorld.rotation * Math.PI) / 180;
    const parentSx = parentWorld.scale[0] / 100;
    const parentSy = parentWorld.scale[1] / 100;

    // 子のpositionからの相対オフセット（親のアンカーポイント基準）
    const dx = local.position[0] - parentWorld.anchorPoint[0];
    const dy = local.position[1] - parentWorld.anchorPoint[1];

    // 親のスケール・回転を適用した上でオフセットを変換
    const cos = Math.cos(parentRad);
    const sin = Math.sin(parentRad);
    const worldX = parentWorld.position[0] + (dx * parentSx * cos - dy * parentSy * sin);
    const worldY = parentWorld.position[1] + (dx * parentSx * sin + dy * parentSy * cos);

    return {
      anchorPoint: local.anchorPoint,
      position: [worldX, worldY],
      scale: [
        local.scale[0] * parentSx,
        local.scale[1] * parentSy,
      ],
      rotation: local.rotation + parentWorld.rotation,
      opacity: (local.opacity * parentWorld.opacity) / 100,
      directionalScale: local.directionalScale,
    };
  }

  /**
   * エクスプレッションをトランスフォーム結果に適用
   */
  private applyExpressions(
    transform: {
      anchorPoint: [number, number];
      position: [number, number];
      scale: [number, number];
      rotation: number;
      opacity: number;
    },
    layer: Layer,
    frame: number,
    allLayers: Layer[],
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ): void {
    if (!layer.expressions) return;

    const time = frame / this._fps;

    for (const [propName, expr] of Object.entries(layer.expressions)) {
      if (!expr || expr.trim() === '') continue;

      // 現在値を取得
      let currentValue: number | number[];
      switch (propName) {
        case 'anchorPoint': currentValue = [...transform.anchorPoint]; break;
        case 'position': currentValue = [...transform.position]; break;
        case 'scale': currentValue = [...transform.scale]; break;
        case 'rotation': currentValue = transform.rotation; break;
        case 'opacity': currentValue = transform.opacity; break;
        default: continue;
      }

      const result = evaluateExpression(expr, {
        time,
        frame,
        value: currentValue,
        fps: this._fps,
        layers: allLayers,
        animations: animations || {},
        thisLayer: layer,
        propertyName: propName,
      });

      if (result === null) continue;

      // 結果を反映
      switch (propName) {
        case 'anchorPoint':
          if (Array.isArray(result)) transform.anchorPoint = result as [number, number];
          break;
        case 'position':
          if (Array.isArray(result)) transform.position = result as [number, number];
          break;
        case 'scale':
          if (Array.isArray(result)) transform.scale = result as [number, number];
          break;
        case 'rotation':
          if (typeof result === 'number') transform.rotation = result;
          break;
        case 'opacity':
          if (typeof result === 'number') transform.opacity = result;
          break;
      }
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

  /** 方向別スケール描画（クリップベースで上下左右を独立スケーリング） */
  private renderDirectionalScale(
    ctx: CanvasRenderingContext2D,
    transform: {
      anchorPoint: [number, number];
      position: [number, number];
      scale: [number, number];
      rotation: number;
      opacity: number;
      directionalScale?: { top?: number; bottom?: number; left?: number; right?: number };
    },
    renderContent: () => void,
  ) {
    const ds = transform.directionalScale!;
    const ap = transform.anchorPoint;
    const pos = transform.position;
    const rot = (transform.rotation * Math.PI) / 180;

    const topFactor = (ds.top ?? transform.scale[1]) / 100;
    const bottomFactor = (ds.bottom ?? transform.scale[1]) / 100;
    const leftFactor = (ds.left ?? transform.scale[0]) / 100;
    const rightFactor = (ds.right ?? transform.scale[0]) / 100;

    const BIG = 10000;

    // 4象限に分けて描画
    const quadrants = [
      { clipX: -BIG, clipW: BIG + pos[0], clipY: -BIG, clipH: BIG + pos[1], sx: leftFactor, sy: topFactor },   // 左上
      { clipX: pos[0], clipW: BIG, clipY: -BIG, clipH: BIG + pos[1], sx: rightFactor, sy: topFactor },          // 右上
      { clipX: -BIG, clipW: BIG + pos[0], clipY: pos[1], clipH: BIG, sx: leftFactor, sy: bottomFactor },        // 左下
      { clipX: pos[0], clipW: BIG, clipY: pos[1], clipH: BIG, sx: rightFactor, sy: bottomFactor },              // 右下
    ];

    for (const q of quadrants) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.clipX, q.clipY, q.clipW, q.clipH);
      ctx.clip();
      ctx.translate(pos[0], pos[1]);
      ctx.rotate(rot);
      ctx.scale(q.sx, q.sy);
      ctx.translate(-ap[0], -ap[1]);
      renderContent();
      ctx.restore();
    }
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

    const shapeW = shape.width ?? 200;
    const shapeH = shape.height ?? 200;

    switch (shape.shapeType) {
      case 'rectangle':
        this.renderRectangle(ctx, shapeW, shapeH, cornerRadius, hasStroke);
        break;
      case 'ellipse':
        this.renderEllipse(ctx, shapeW, shapeH, hasStroke);
        break;
      case 'star':
        this.renderStar(ctx, 5, Math.min(shapeW, shapeH) / 2, Math.min(shapeW, shapeH) / 4.5, hasStroke);
        break;
    }
  }

  /** 矩形描画 */
  private renderRectangle(ctx: CanvasRenderingContext2D, w: number, h: number, cornerRadius: number, hasStroke: boolean) {
    if (cornerRadius > 0) {
      this.roundRect(ctx, -w / 2, -h / 2, w, h, cornerRadius, hasStroke);
    } else {
      ctx.fillRect(-w / 2, -h / 2, w, h);
      if (hasStroke) {
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }
    }
  }

  /** 楽円描画 */
  private renderEllipse(ctx: CanvasRenderingContext2D, w: number, h: number, hasStroke: boolean) {
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
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
    hasStroke: boolean = false,
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
    if (hasStroke) ctx.stroke();
  }

  /** 画像レイヤー描画 */
  private renderImage(ctx: CanvasRenderingContext2D, layer: Layer) {
    const src = layer.mediaSource;
    if (!src) {
      this.renderPlaceholder(ctx, layer);
      return;
    }

    let img = this.mediaCache.get(src) as HTMLImageElement | undefined;
    if (!img) {
      img = new Image();
      img.src = src;
      this.mediaCache.set(src, img);
    }

    if (img.complete && img.naturalWidth > 0) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      this.renderPlaceholder(ctx, layer);
    }
  }

  /** 動画レイヤー描画 */
  private renderVideo(ctx: CanvasRenderingContext2D, layer: Layer, frame: number) {
    const src = layer.mediaSource;
    if (!src) {
      this.renderPlaceholder(ctx, layer);
      return;
    }

    let video = this.mediaCache.get(src) as HTMLVideoElement | undefined;
    if (!video) {
      video = document.createElement('video');
      video.src = src;
      video.preload = 'auto';
      video.muted = true;
      this.mediaCache.set(src, video);
    }

    // フレーム位置にシーク
    const time = (frame - layer.inPoint) / this._fps;
    if (Math.abs(video.currentTime - time) > 0.05) {
      video.currentTime = Math.max(0, time);
    }

    if (video.readyState >= 2 && video.videoWidth > 0) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      ctx.drawImage(video, -w / 2, -h / 2, w, h);
    } else {
      this.renderPlaceholder(ctx, layer);
    }
  }

  /** プリコンポジション描画（内部レイヤーを再帰的に描画） */
  private renderPrecomp(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    currentFrame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
    allLayers?: Layer[],
  ) {
    if (!layer.precompLayers || layer.precompLayers.length === 0) {
      this.renderPlaceholder(ctx, layer);
      return;
    }

    const innerLayers = layer.precompLayers;
    const hasSoloLayer = innerLayers.some(l => l.solo);

    // 背面から前面に向かって描画
    for (let i = innerLayers.length - 1; i >= 0; i--) {
      const innerLayer = innerLayers[i];
      if (!innerLayer.visible) continue;
      if (hasSoloLayer && !innerLayer.solo) continue;
      if (currentFrame < innerLayer.inPoint || currentFrame > innerLayer.outPoint) continue;

      // 内部レイヤーのトランスフォームを解決
      const innerTransform = this.resolveWorldTransform(innerLayer, innerLayers, currentFrame, animations);

      const renderInnerContent = () => {
        switch (innerLayer.type) {
          case 'solid':
            this.renderSolid(ctx, innerLayer);
            break;
          case 'text':
            this.renderText(ctx, innerLayer, currentFrame, animations);
            break;
          case 'shape':
            this.renderShape(ctx, innerLayer, currentFrame, animations);
            break;
          case 'image':
            this.renderImage(ctx, innerLayer);
            break;
          case 'video':
            this.renderVideo(ctx, innerLayer, currentFrame);
            break;
          case 'precomp':
            this.renderPrecomp(ctx, innerLayer, currentFrame, animations, allLayers);
            break;
          default:
            this.renderPlaceholder(ctx, innerLayer);
            break;
        }
      };

      ctx.save();
      this.applyBlendMode(ctx, innerLayer);
      ctx.globalAlpha *= innerTransform.opacity / 100;
      this.applyTransformValues(ctx, innerTransform);
      renderInnerContent();
      ctx.restore();
    }
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
    const dpr = window.devicePixelRatio || 1;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width * dpr, this.height * dpr);
    this.ctx.restore();
  }
}
