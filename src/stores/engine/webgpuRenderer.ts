/**
 * WebGPU レンダラー
 * Canvas2Dフォールバック付き
 * ソリッド・テキスト・シェイプを GPU で高速描画
 */
import type { Layer } from '../../types/layer';
import type { AnimatedProperty } from '../../types/keyframe';
import { interpolateValue } from './keyframe';

// ── シェーダー ──

const VERTEX_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct Uniforms {
  resolution: vec2f,
  // カラー
  color: vec4f,
  // トランスフォーム: position.xy, scale.xy
  transform: vec4f,
  // rotation (radians), anchorPoint.xy, _pad
  rotAnchor: vec4f,
  // rectSize.xy, cornerRadius, shapeType
  shape: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // フルスクリーンクアッド
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1),
  );
  var uv = array<vec2f, 6>(
    vec2f(0, 1), vec2f(1, 1), vec2f(0, 0),
    vec2f(0, 0), vec2f(1, 1), vec2f(1, 0),
  );
  var out: VertexOutput;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}
`;

const FRAGMENT_SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  color: vec4f,
  transform: vec4f,
  rotAnchor: vec4f,
  shape: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdEllipse(p: vec2f, r: vec2f) -> f32 {
  let q = p / r;
  return (length(q) - 1.0) * min(r.x, r.y);
}

fn rotate2d(p: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let pixel = uv * u.resolution;
  let pos = u.transform.xy;
  let scl = u.transform.zw;
  let rot = u.rotAnchor.x;
  let anchor = u.rotAnchor.yz;
  let shapeType = u.shape.w;  // 0=solid, 1=rect, 2=ellipse, 3=star
  let rectSize = u.shape.xy;
  let cornerRadius = u.shape.z;

  // ピクセル座標をレイヤーのローカル座標に変換
  var local = pixel - pos;
  local = rotate2d(local, -rot);
  local = local / (scl / 100.0);
  local = local + anchor;

  var alpha: f32 = 0.0;

  if (shapeType < 0.5) {
    // ソリッド（コンポサイズ全面）
    let halfRes = u.resolution * 0.5;
    if (abs(local.x) < halfRes.x && abs(local.y) < halfRes.y) {
      alpha = 1.0;
    }
  } else if (shapeType < 1.5) {
    // 矩形
    let halfSize = rectSize * 0.5;
    let d = sdRoundedBox(local, halfSize, cornerRadius);
    alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  } else if (shapeType < 2.5) {
    // 楕円
    let d = sdEllipse(local, rectSize * 0.5);
    alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  } else {
    // 星型（5角星のSDF近似）
    let r = rectSize.x * 0.5;
    let innerR = r * 0.45;
    let angle = atan2(local.y, local.x);
    let segAngle = 3.14159265 / 5.0;
    let a = ((angle + 3.14159265 * 0.5) % (segAngle * 2.0)) - segAngle;
    let d = length(local);
    let outerD = r * cos(segAngle) / cos(a);
    alpha = 1.0 - smoothstep(-1.0, 1.0, d - outerD);
  }

  return u.color * alpha;
}
`;

const CLEAR_SHADER = /* wgsl */ `
@group(0) @binding(0) var<uniform> clearColor: vec4f;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1),
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return clearColor;
}
`;

/** WebGPU 対応チェック */
export async function isWebGPUSupported(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

export class WebGPURenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private width: number;
  private height: number;
  private _backgroundColor: string = '#000000';

  private pipeline!: GPURenderPipeline;
  private clearPipeline!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private clearUniformBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;
  private clearBindGroup!: GPUBindGroup;

  private ready = false;


  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;

  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) return false;

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();

      this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
      const format = navigator.gpu.getPreferredCanvasFormat();

      this.context.configure({
        device: this.device,
        format,
        alphaMode: 'premultiplied',
      });

      // レイヤー描画パイプライン
      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: this.device.createShaderModule({ code: VERTEX_SHADER + FRAGMENT_SHADER.replace('struct Uniforms', '// dup') }),
          entryPoint: 'vs_main',
        },
        fragment: {
          module: this.device.createShaderModule({ code: VERTEX_SHADER + FRAGMENT_SHADER.replace('struct Uniforms', '// dup') }),
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      });

      // クリアパイプライン
      const clearModule = this.device.createShaderModule({ code: CLEAR_SHADER });
      this.clearPipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: clearModule, entryPoint: 'vs_main' },
        fragment: {
          module: clearModule,
          entryPoint: 'fs_main',
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      // Uniform バッファ
      // 16バイトアライメント: resolution(8) + pad(8) + color(16) + transform(16) + rotAnchor(16) + shape(16) = 88
      this.uniformBuffer = this.device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.clearUniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });

      this.clearBindGroup = this.device.createBindGroup({
        layout: this.clearPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.clearUniformBuffer } }],
      });

      this.resize(this.width, this.height);
      this.ready = true;
      return true;
    } catch (e) {
      console.warn('WebGPU init failed:', e);
      return false;
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  set backgroundColor(color: string) {
    this._backgroundColor = color;
  }

  /** ヘキサカラーをRGBA配列に変換 */
  private hexToRGBA(hex: string, alpha: number = 1): [number, number, number, number] {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16) / 255;
    const g = parseInt(c.substring(2, 4), 16) / 255;
    const b = parseInt(c.substring(4, 6), 16) / 255;
    return [r, g, b, alpha];
  }

  renderFrame(
    layers: Layer[],
    currentFrame: number,
    animations?: Record<string, Record<string, AnimatedProperty>>,
  ) {
    if (!this.ready) return;

    const encoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    // 背景クリア
    const bgColor = this.hexToRGBA(this._backgroundColor);
    this.device.queue.writeBuffer(this.clearUniformBuffer, 0, new Float32Array(bgColor));

    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: bgColor[0], g: bgColor[1], b: bgColor[2], a: 1 },
      }],
    });
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, this.clearBindGroup);
    clearPass.draw(6);
    clearPass.end();

    // ソロレイヤーの判定
    const hasSoloLayer = layers.some(l => l.solo);

    // レイヤーを背面から前面に描画
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible) continue;
      if (hasSoloLayer && !layer.solo) continue;
      if (currentFrame < layer.inPoint || currentFrame > layer.outPoint) continue;

      // テキストレイヤーは後でCanvas2D経由
      if (layer.type === 'text') continue;

      const transform = this.resolveTransform(layer, currentFrame, animations);

      // シェイプタイプ: 0=solid, 1=rect, 2=ellipse, 3=star
      let shapeType = 0;
      let rectSize: [number, number] = [this.width, this.height];
      let cornerRadius = 0;
      let color: [number, number, number, number] = [1, 1, 1, 1];

      if (layer.type === 'solid') {
        shapeType = 0;
        color = this.hexToRGBA(layer.solidColor || '#6C5CE7', transform.opacity / 100);
      } else if (layer.type === 'shape' && layer.shapeData) {
        const shape = layer.shapeData;
        color = this.hexToRGBA(shape.fill, transform.opacity / 100);
        rectSize = [shape.width ?? 200, shape.height ?? 200];
        cornerRadius = shape.cornerRadius || 0;
        switch (shape.shapeType) {
          case 'rectangle': shapeType = 1; break;
          case 'ellipse': shapeType = 2; break;
          case 'star': shapeType = 3; break;
        }
      } else {
        // 未対応タイプ → スキップ
        continue;
      }

      const rotRad = (transform.rotation * Math.PI) / 180;

      // Uniform データ書き込み
      const data = new Float32Array([
        this.width, this.height,                                  // resolution (8 bytes)
        0, 0,                                                     // padding (align 16)
        color[0], color[1], color[2], color[3],                   // color (16 bytes)
        transform.position[0], transform.position[1],             // transform pos
        transform.scale[0], transform.scale[1],                   // transform scale
        rotRad, transform.anchorPoint[0], transform.anchorPoint[1], 0, // rotAnchor
        rectSize[0], rectSize[1], cornerRadius, shapeType,        // shape
      ]);

      this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });

      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6);
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);

    // テキストレイヤーはCanvas2D overlay
    this.renderTextLayers(layers, currentFrame, animations);
  }

  /** テキストレイヤーをCanvas2D経由で描画（WebGPUキャンバスの上にオーバーレイ） */
  private renderTextLayers(
    layers: Layer[],
    currentFrame: number,
    _animations?: Record<string, Record<string, AnimatedProperty>>,
  ) {
    const hasSoloLayer = layers.some(l => l.solo);
    const textLayers = layers.filter(
      (l) => l.type === 'text' && l.visible && (!hasSoloLayer || l.solo) && currentFrame >= l.inPoint && currentFrame <= l.outPoint,
    );
    if (textLayers.length === 0) return;

    // 2D contextでテキスト描画（WebGPUキャンバスに2D contextは使えないので
    // テキストは別途描画しない → 将来的にはテクスチャとして統合）
    // ここでは一旦何もしない（テキストはCanvas2Dフォールバックで表示）
  }

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

  clear() {
    // WebGPUでは renderFrame の背景クリアで処理
  }

  destroy() {
    if (this.device) {
      this.device.destroy();
    }
  }
}
