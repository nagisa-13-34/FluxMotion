// EasingEditor.tsx - Ref-based viewport (no re-render on pan/zoom/drag)
// NGS_LyricMotion_CEP CurveEditor.tsx 参考

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useLayerStore } from '../../stores/layerStore';
import { DraggablePanelHeader } from '../common/DraggablePanelHeader';
import { EASING_PRESETS } from '../../types/keyframe';

type B4 = [number, number, number, number];
interface Pt { x: number; y: number }

interface AnchorPoint {
  x: number; y: number;
  type: 'start' | 'end' | 'anchor';
  leftHandle?: Pt;
  rightHandle?: Pt;
}

// ─── Viewport 型 ───
interface Viewport { minX: number; maxX: number; minY: number; maxY: number }
const CELL = 0.25;
const PAD = 16;
const ANIM_SPEED = 0.22;

/** Bounce Out (EaseCraft準拠 decay+放物線) */
function easeOutBounce(t: number, amplitude: number, count: number): number {
  if (t === 0) return 0;
  if (t >= 1) return 1;
  const decay = 0.5;
  let totalRatio = 1;
  const ratios = [1];
  for (let i = 1; i <= count; i++) {
    const h = amplitude * Math.pow(decay, i - 1);
    const r = 2 * Math.sqrt(h);
    ratios.push(r);
    totalRatio += r;
  }
  let ct = t * totalRatio;
  if (ct < ratios[0]) {
    const lt = ct / ratios[0];
    return lt * lt;
  }
  ct -= ratios[0];
  for (let i = 1; i <= count; i++) {
    const r = ratios[i];
    if (ct < r) {
      const lt = ct / r;
      const h = amplitude * Math.pow(decay, i - 1);
      return 1 - (4 * h * lt * (1 - lt));
    }
    ct -= r;
  }
  return 1;
}

/** Elastic Out (EaseCraft準拠 始点補正付き) */
function easeOutElastic(t: number, amplitude: number, period: number): number {
  if (t === 0) return 0;
  if (t === 1) return 1;
  const s = period / 4;
  const val = amplitude * Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / period) + 1;
  const startVal = 1 - amplitude;
  const correction = startVal * Math.exp(-8 * t);
  return val - correction;
}

/** カーブに合わせたビューポート計算 (aspect = canvasW/canvasH) */
function computeFitView(anchors: AnchorPoint[], aspect: number = 1): Viewport {
  const allPts: Pt[] = [];
  anchors.forEach(a => {
    allPts.push({ x: a.x, y: a.y });
    if (a.leftHandle) allPts.push(a.leftHandle);
    if (a.rightHandle) allPts.push(a.rightHandle);
  });
  if (allPts.length === 0) allPts.push({ x: 0, y: 0 }, { x: 1, y: 1 });

  const dataMinY = Math.min(...allPts.map(p => p.y));
  const dataMaxY = Math.max(...allPts.map(p => p.y));

  let lo = Math.floor((dataMinY - CELL * 0.6) / CELL) * CELL;
  let hi = Math.ceil((dataMaxY + CELL * 0.6) / CELL) * CELL;
  if (lo > 0) lo = 0;
  if (hi < 1) hi = 1;
  while (hi - lo < CELL * 4) { lo -= CELL; hi += CELL; }

  const rangeY = hi - lo;
  // アスペクト比に基づいてX rangeを調整 → セルが正方形になる
  const rangeX = rangeY * aspect;
  return { minX: 0.5 - rangeX / 2, maxX: 0.5 + rangeX / 2, minY: lo, maxY: hi };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ─── Bounce/Elastic ───
function generateBouncePoints(count: number, height: number): Pt[] {
  const pts: Pt[] = [{ x: 0, y: 0 }];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const segLen = 1 / (count + 0.5) * (i === 0 ? 1.5 : 1);
    const h = height * Math.pow(0.5, i);
    const mid = t + segLen * 0.5;
    const end = t + segLen;
    pts.push({ x: t + segLen * 0.25, y: 1 });
    pts.push({ x: mid - segLen * 0.15, y: 1 + h * 0.3 });
    pts.push({ x: mid, y: 1 });
    if (i < count - 1) {
      pts.push({ x: mid + segLen * 0.15, y: 1 - h * 0.3 });
      pts.push({ x: end - segLen * 0.25, y: 1 });
      pts.push({ x: end, y: 1 });
    }
    t = end;
  }
  pts[pts.length - 1] = { x: 1, y: 1 };
  return pts;
}

function generateElasticPoints(amplitude: number, period: number): Pt[] {
  const pts: Pt[] = [{ x: 0, y: 0 }];
  const oscillations = Math.round(1 / period);
  for (let i = 0; i < oscillations; i++) {
    const t = (i + 1) / (oscillations + 0.5);
    const amp = amplitude * Math.pow(0.4, i);
    const overshoot = 1 + amp * (i % 2 === 0 ? 1 : -0.6);
    pts.push({ x: t - 0.03, y: overshoot > 1 ? 1 : overshoot });
    pts.push({ x: t, y: overshoot });
    pts.push({ x: t + 0.03, y: overshoot > 1 ? 1 : overshoot });
  }
  pts.push({ x: 0.97, y: 1 });
  pts.push({ x: 1, y: 1 });
  return pts;
}

// ─── プリセット ───
interface Preset { name: string; label: string; value: B4; category: string; multiPoints?: Pt[] }
const BUILT_IN_PRESETS: Preset[] = [
  { name: 'linear', label: 'Linear', value: [0, 0, 1, 1], category: 'Basic' },
  { name: 'easeIn', label: 'Ease In', value: EASING_PRESETS.easeIn, category: 'Basic' },
  { name: 'easeOut', label: 'Ease Out', value: EASING_PRESETS.easeOut, category: 'Basic' },
  { name: 'easeInOut', label: 'Ease InOut', value: EASING_PRESETS.easeInOut, category: 'Basic' },
  { name: 'smooth', label: 'Smooth', value: EASING_PRESETS.smooth, category: 'Basic' },
  { name: 'easeInCubic', label: 'Cubic In', value: EASING_PRESETS.easeInCubic, category: 'Cubic' },
  { name: 'easeOutCubic', label: 'Cubic Out', value: EASING_PRESETS.easeOutCubic, category: 'Cubic' },
  { name: 'easeInOutCubic', label: 'Cubic IO', value: EASING_PRESETS.easeInOutCubic, category: 'Cubic' },
  { name: 'overshoot', label: 'Overshoot', value: EASING_PRESETS.overshoot, category: 'Special' },
  { name: 'bounce', label: 'Bounce', value: [0.22, 1, 0.36, 1], category: 'Special', multiPoints: generateBouncePoints(3, 0.4) },
  { name: 'elastic', label: 'Elastic', value: [0.68, -0.55, 0.27, 1.55], category: 'Special', multiPoints: generateElasticPoints(0.4, 0.25) },
  { name: 'easeInQuad', label: 'Quad In', value: EASING_PRESETS.easeInQuad, category: 'Cubic' },
];

/** localStorage からカスタムプリセットを読み込み */
function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem('fluxmotion-easing-presets');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveCustomPresets(presets: Preset[]) {
  localStorage.setItem('fluxmotion-easing-presets', JSON.stringify(presets));
}

/** 削除済み標準プリセット名を保存/読み込み */
function loadHiddenBuiltIn(): string[] {
  try {
    const raw = localStorage.getItem('fluxmotion-hidden-builtin');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveHiddenBuiltIn(names: string[]) {
  localStorage.setItem('fluxmotion-hidden-builtin', JSON.stringify(names));
}

/** カスタムカテゴリーを保存/読み込み */
function loadCustomCategories(): string[] {
  try {
    const raw = localStorage.getItem('fluxmotion-easing-categories');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveCustomCategories(cats: string[]) {
  localStorage.setItem('fluxmotion-easing-categories', JSON.stringify(cats));
}

// ─── ミニカーブ ───
function drawMiniCurve(canvas: HTMLCanvasElement, c: B4, active: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const p = 4, iw = w - p * 2, ih = h - p * 2;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p, h - p); ctx.lineTo(w - p, p); ctx.stroke();
  ctx.strokeStyle = active ? '#3b82f6' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = active ? 2 : 1.5;
  ctx.beginPath(); ctx.moveTo(p, h - p);
  ctx.bezierCurveTo(p + c[0] * iw, h - p - c[1] * ih, p + c[2] * iw, h - p - c[3] * ih, w - p, p);
  ctx.stroke();
}

// Material Symbolsアイコンヘルパー（コンポーネント外で定義して再マウント防止）
const MIcon = ({ name, size = 16, style }: { name: string; size?: number; style?: React.CSSProperties }) => (
  <span className="material-symbols-outlined" style={{ fontSize: size, lineHeight: 1, ...style }}>{name}</span>
);

// ═══════════════════════════════════════════════════════
// メインコンポーネント
// ═══════════════════════════════════════════════════════
export function EasingEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const miniRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // ── State (UIトリガー用のみ) ──
  const [curve, setCurve] = useState<B4>([0.42, 0, 0.58, 1]);
  const [multiPoints, setMultiPoints] = useState<Pt[] | null>(null);
  const [bezierCode, setBezierCode] = useState('');
  const [copiedRecently, setCopiedRecently] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showPresets, setShowPresets] = useState(true);
  const [showBounceSliders, setShowBounceSliders] = useState(true);
  const [showElasticSliders, setShowElasticSliders] = useState(true);
  // カーブモードタブ
  const [curveMode, setCurveMode] = useState<'bezier' | 'bounce' | 'elastic'>('bezier');

  // Bounce パラメータ
  const [bounceHeight, setBounceHeight] = useState(1.0);
  const [bounceCount, setBounceCount] = useState(4);
  const [bounceDir, setBounceDir] = useState<'out' | 'in' | 'inout'>('out');

  // Elastic パラメータ
  const [elasticAmp, setElasticAmp] = useState(1.0);
  const [elasticPeriod, setElasticPeriod] = useState(0.3);
  const [elasticDir, setElasticDir] = useState<'out' | 'in' | 'inout'>('out');

  // カスタムプリセット
  const [customPresets, setCustomPresets] = useState<Preset[]>(loadCustomPresets);
  const [hiddenBuiltIn, setHiddenBuiltIn] = useState<string[]>(loadHiddenBuiltIn);
  const [customCategories, setCustomCategories] = useState<string[]>(loadCustomCategories);
  const visibleBuiltIn = BUILT_IN_PRESETS.filter(p => !hiddenBuiltIn.includes(p.name));
  const allPresets = [...visibleBuiltIn, ...customPresets];
  // カテゴリー = プリセット由来 + 明示的に保存されたカテゴリーの和集合
  const presetCategories = [...new Set(allPresets.map(p => p.category))];
  const categories = [...new Set([...presetCategories, ...customCategories])];
  const [activeCategory, setActiveCategory] = useState<string>(categories[0] || 'Basic');
  const effectiveCategory = categories.includes(activeCategory) ? activeCategory : (categories[0] || 'Basic');
  const filteredPresets = allPresets.filter(p => p.category === effectiveCategory);

  // 右クリックメニュー
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; presetName: string } | null>(null);
  // カテゴリー追加
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // ── Refs (描画ループで参照。re-renderしない) ──
  const anchorsRef = useRef<AnchorPoint[]>([]);
  const currentView = useRef<Viewport>({ minX: -0.25, maxX: 1.25, minY: -0.25, maxY: 1.25 });
  const targetView = useRef<Viewport>({ minX: -0.25, maxX: 1.25, minY: -0.25, maxY: 1.25 });
  const animId = useRef(0);
  const isDragging = useRef(false);
  const isPanning = useRef(false);
  const panStart = useRef<Pt>({ x: 0, y: 0 });
  const isSpaceDown = useRef(false);
  const hovRef = useRef<{ idx: number; type: 'point' | 'left' | 'right' | null }>({ idx: -1, type: null });
  // Bounce/Elastic ハンドル用
  const bcHandleDrag = useRef<'h' | 'c' | null>(null);
  const bcHandleHov = useRef<'h' | 'c' | null>(null);
  const selRef = useRef(-1);
  const canvasSz = useRef({ w: 300, h: 200 });
  /** キャンバスのアスペクト比 (正方形グリッド用) */
  const canvasAspect = () => {
    const { w, h } = canvasSz.current;
    if (h <= 0) return 1;
    return (w - PAD * 2) / (h - PAD * 2);
  };
  const curveRef = useRef(curve);
  const mpRef = useRef(multiPoints);
  const curveModeRef = useRef(curveMode);
  const bounceRef = useRef({ height: bounceHeight, count: bounceCount, dir: bounceDir });
  const elasticRef = useRef({ amp: elasticAmp, period: elasticPeriod, dir: elasticDir });

  useEffect(() => { curveRef.current = curve; }, [curve]);
  useEffect(() => { mpRef.current = multiPoints; }, [multiPoints]);
  useEffect(() => { curveModeRef.current = curveMode; }, [curveMode]);

  // Bounce/Elastic パラメータ変更 → ref更新 + 自動ビューポート + 再描画
  useEffect(() => {
    bounceRef.current = { height: bounceHeight, count: bounceCount, dir: bounceDir };
    if (curveModeRef.current === 'bounce') {
      // カーブの値域を計算してビューポート自動調整
      let minY = 0, maxY = 1;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        let y = easeOutBounce(t, bounceHeight, bounceCount);
        if (bounceDir === 'in') y = 1 - easeOutBounce(1 - t, bounceHeight, bounceCount);
        else if (bounceDir === 'inout') y = t < 0.5 ? (1 - easeOutBounce(1 - 2 * t, bounceHeight, bounceCount)) / 2 : (1 + easeOutBounce(2 * t - 1, bounceHeight, bounceCount)) / 2;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const margin = 0.1;
      targetView.current = { minX: -0.1, maxX: 1.1, minY: minY - margin, maxY: maxY + margin };
      startAnim();
    }
    draw();
  }, [bounceHeight, bounceCount, bounceDir]);

  useEffect(() => {
    elasticRef.current = { amp: elasticAmp, period: elasticPeriod, dir: elasticDir };
    if (curveModeRef.current === 'elastic') {
      let minY = 0, maxY = 1;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        let y = easeOutElastic(t, elasticAmp, elasticPeriod);
        if (elasticDir === 'in') y = 1 - easeOutElastic(1 - t, elasticAmp, elasticPeriod);
        else if (elasticDir === 'inout') y = t < 0.5 ? (1 - easeOutElastic(1 - 2 * t, elasticAmp, elasticPeriod)) / 2 : (1 + easeOutElastic(2 * t - 1, elasticAmp, elasticPeriod)) / 2;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const margin = 0.1;
      targetView.current = { minX: -0.1, maxX: 1.1, minY: minY - margin, maxY: maxY + margin };
      startAnim();
    }
    draw();
  }, [elasticAmp, elasticPeriod, elasticDir]);

  // ── アンカー生成 ──
  const genAnchors = useCallback((c: B4, mp: Pt[] | null): AnchorPoint[] => {
    if (mp && mp.length >= 4) {
      const pts: AnchorPoint[] = [];
      for (let i = 0; i < mp.length; i += 3) {
        const a: AnchorPoint = { x: mp[i].x, y: mp[i].y, type: i === 0 ? 'start' : (i >= mp.length - 1 ? 'end' : 'anchor') };
        if (i + 1 < mp.length) a.rightHandle = mp[i + 1];
        if (i - 1 >= 0) a.leftHandle = mp[i - 1];
        pts.push(a);
      }
      return pts;
    }
    return [
      { x: 0, y: 0, type: 'start', rightHandle: { x: c[0], y: c[1] } },
      { x: 1, y: 1, type: 'end', leftHandle: { x: c[2], y: c[3] } },
    ];
  }, []);

  // カーブ変更 → コード表示更新のみ（ビューポート更新は下のuseEffectで）
  useEffect(() => {
    setBezierCode(`cubic-bezier(${curve[0].toFixed(2)}, ${curve[1].toFixed(2)}, ${curve[2].toFixed(2)}, ${curve[3].toFixed(2)})`);
  }, [curve]);

  // ── 座標変換 (Ref ベース) ──
  const toCanvas = useCallback((pt: Pt, w: number, h: number): Pt => {
    const v = currentView.current;
    const gw = w - PAD * 2, gh = h - PAD * 2;
    return {
      x: PAD + ((pt.x - v.minX) / (v.maxX - v.minX)) * gw,
      y: PAD + ((v.maxY - pt.y) / (v.maxY - v.minY)) * gh,
    };
  }, []);

  const fromCanvas = useCallback((cx: number, cy: number, w: number, h: number): Pt => {
    const v = currentView.current;
    const gw = w - PAD * 2, gh = h - PAD * 2;
    return {
      x: v.minX + ((cx - PAD) / gw) * (v.maxX - v.minX),
      y: v.maxY - ((cy - PAD) / gh) * (v.maxY - v.minY),
    };
  }, []);

  // ── 描画 ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasSz.current.w, h = canvasSz.current.h;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const v = currentView.current;
    const gw = w - PAD * 2, gh = h - PAD * 2;
    const points = anchorsRef.current;

    // 背景
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, w, h);

    // 0-1 エリアハイライト
    const origin = toCanvas({ x: 0, y: 0 }, w, h);
    const corner = toCanvas({ x: 1, y: 1 }, w, h);
    ctx.fillStyle = 'rgba(40, 45, 40, 0.5)';
    ctx.fillRect(
      Math.min(origin.x, corner.x), Math.min(origin.y, corner.y),
      Math.abs(corner.x - origin.x), Math.abs(corner.y - origin.y),
    );

    // 無限グリッド
    ctx.lineWidth = 1;
    const firstX = Math.floor(v.minX / CELL) * CELL;
    const firstY = Math.floor(v.minY / CELL) * CELL;

    for (let dx = firstX; dx <= v.maxX + CELL * 0.5; dx += CELL) {
      const sx = PAD + ((dx - v.minX) / (v.maxX - v.minX)) * gw;
      if (sx < PAD - 1 || sx > PAD + gw + 1) continue;
      const isEdge = Math.abs(dx) < 0.001 || Math.abs(dx - 1) < 0.001;
      ctx.strokeStyle = isEdge ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, PAD); ctx.lineTo(Math.round(sx) + 0.5, PAD + gh); ctx.stroke();
    }
    for (let dy = firstY; dy <= v.maxY + CELL * 0.5; dy += CELL) {
      const sy = PAD + ((v.maxY - dy) / (v.maxY - v.minY)) * gh;
      if (sy < PAD - 1 || sy > PAD + gh + 1) continue;
      const isEdge = Math.abs(dy) < 0.001 || Math.abs(dy - 1) < 0.001;
      ctx.strokeStyle = isEdge ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(PAD, Math.round(sy) + 0.5); ctx.lineTo(PAD + gw, Math.round(sy) + 0.5); ctx.stroke();
    }

    // 外枠
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(PAD, PAD, gw, gh);

    // カーブ + ハンドル
    const mode = curveModeRef.current;
    if (mode === 'bounce' || mode === 'elastic') {
      // Bounce/Elastic: 数学関数でlineTo描画
      const steps = 200;
      ctx.strokeStyle = mode === 'bounce' ? '#6b5ce7' : '#e76b5c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        let y: number;
        if (mode === 'bounce') {
          const b = bounceRef.current;
          y = easeOutBounce(t, b.height, b.count);
          if (b.dir === 'in') y = 1 - easeOutBounce(1 - t, b.height, b.count);
          else if (b.dir === 'inout') y = t < 0.5 ? (1 - easeOutBounce(1 - 2 * t, b.height, b.count)) / 2 : (1 + easeOutBounce(2 * t - 1, b.height, b.count)) / 2;
        } else {
          const e = elasticRef.current;
          y = easeOutElastic(t, e.amp, e.period);
          if (e.dir === 'in') y = 1 - easeOutElastic(1 - t, e.amp, e.period);
          else if (e.dir === 'inout') y = t < 0.5 ? (1 - easeOutElastic(1 - 2 * t, e.amp, e.period)) / 2 : (1 + easeOutElastic(2 * t - 1, e.amp, e.period)) / 2;
        }
        const sp = toCanvas({ x: t, y }, w, h);
        if (s === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();

      // Bounce/Elastic ハンドル描画
      const hov = bcHandleHov.current;
      const dragging = bcHandleDrag.current;
      if (mode === 'bounce') {
        const b = bounceRef.current;
        // H ハンドル: 最初のバウンスのピーク位置
        const decay = 0.5;
        let totalRatio = 1;
        for (let i = 1; i <= b.count; i++) {
          totalRatio += 2 * Math.sqrt(b.height * Math.pow(decay, i - 1));
        }
        const peakT = (1 + Math.sqrt(b.height)) / totalRatio;
        const hPt = toCanvas({ x: peakT, y: 1 - b.height }, w, h);
        // C ハンドル: count/10 のX、Y=1
        const cPt = toCanvas({ x: b.count / 10, y: 1 }, w, h);
        // 補助線
        if (hov === 'h' || dragging === 'h') {
          ctx.strokeStyle = 'rgba(107,92,231,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
          ctx.beginPath(); ctx.moveTo(hPt.x, toCanvas({x:0,y:1},w,h).y); ctx.lineTo(hPt.x, hPt.y); ctx.stroke(); ctx.setLineDash([]);
        }
        if (hov === 'c' || dragging === 'c') {
          ctx.strokeStyle = 'rgba(107,92,231,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
          ctx.beginPath(); ctx.moveTo(toCanvas({x:0,y:1},w,h).x, cPt.y); ctx.lineTo(cPt.x, cPt.y); ctx.stroke(); ctx.setLineDash([]);
        }
        // ドット
        [['h', hPt], ['c', cPt]].forEach(([key, pt]: any) => {
          const isAct = hov === key || dragging === key;
          ctx.fillStyle = isAct ? '#6b5ce7' : '#888'; ctx.strokeStyle = isAct ? '#fff' : '#333'; ctx.lineWidth = isAct ? 2 : 1;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, isAct ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (isAct) { ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(key === 'h' ? 'H' : 'C', pt.x, pt.y - 12); }
        });
      } else {
        const e = elasticRef.current;
        // H ハンドル: t=period/2, y=1-amp
        const hPt = toCanvas({ x: e.period / 2, y: 1 - e.amp }, w, h);
        // C ハンドル: t=period, y=1
        const cPt = toCanvas({ x: e.period, y: 1 }, w, h);
        if (hov === 'h' || dragging === 'h') {
          ctx.strokeStyle = 'rgba(231,107,92,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
          ctx.beginPath(); ctx.moveTo(hPt.x, toCanvas({x:0,y:1},w,h).y); ctx.lineTo(hPt.x, hPt.y); ctx.stroke(); ctx.setLineDash([]);
        }
        if (hov === 'c' || dragging === 'c') {
          ctx.strokeStyle = 'rgba(231,107,92,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
          ctx.beginPath(); ctx.moveTo(toCanvas({x:0,y:1},w,h).x, cPt.y); ctx.lineTo(cPt.x, cPt.y); ctx.stroke(); ctx.setLineDash([]);
        }
        [['h', hPt], ['c', cPt]].forEach(([key, pt]: any) => {
          const isAct = hov === key || dragging === key;
          ctx.fillStyle = isAct ? '#e76b5c' : '#888'; ctx.strokeStyle = isAct ? '#fff' : '#333'; ctx.lineWidth = isAct ? 2 : 1;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, isAct ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (isAct) { ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(key === 'h' ? 'A' : 'P', pt.x, pt.y - 12); }
        });
      }
    } else {
      // Bezier: 通常のベジェカーブ描画
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const pA = toCanvas(a, w, h), pB = toCanvas(b, w, h);
        const cp1 = a.rightHandle ? toCanvas(a.rightHandle, w, h) : pA;
        const cp2 = b.leftHandle ? toCanvas(b.leftHandle, w, h) : pB;

        // ハンドル線
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(cp1.x, cp1.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pB.x, pB.y); ctx.lineTo(cp2.x, cp2.y); ctx.stroke();

        // カーブ
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(pA.x, pA.y);
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pB.x, pB.y);
        ctx.stroke();

        // ハンドルドット
        const hov = hovRef.current;
        const dot = (p: Pt, isH: boolean) => {
          ctx.fillStyle = isH ? '#ff6b35' : '#777';
          ctx.strokeStyle = isH ? '#fff' : '#333';
          ctx.lineWidth = isH ? 2 : 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, isH ? 5 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        };
        dot(cp1, hov.idx === i && hov.type === 'right');
        dot(cp2, hov.idx === i + 1 && hov.type === 'left');
      }
    }

    // アンカー（四角）
    points.forEach((p, i) => {
      const pos = toCanvas(p, w, h);
      const hov = hovRef.current;
      const isH = hov.idx === i && hov.type === 'point';
      const isSel = selRef.current === i;
      const sz = isH || isSel ? 8 : 6;
      ctx.fillStyle = '#fff';
      ctx.fillRect(pos.x - sz / 2, pos.y - sz / 2, sz, sz);
      ctx.strokeStyle = isSel ? '#ff6b35' : '#333';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(pos.x - sz / 2, pos.y - sz / 2, sz, sz);
    });
  }, [toCanvas]);

  // ── アニメーションループ ──
  const animate = useCallback(() => {
    const c = currentView.current;
    const t = targetView.current;

    if (isDragging.current) {
      c.minX = t.minX; c.maxX = t.maxX; c.minY = t.minY; c.maxY = t.maxY;
      draw();
      animId.current = 0;
      return;
    }

    c.minX = lerp(c.minX, t.minX, ANIM_SPEED);
    c.maxX = lerp(c.maxX, t.maxX, ANIM_SPEED);
    c.minY = lerp(c.minY, t.minY, ANIM_SPEED);
    c.maxY = lerp(c.maxY, t.maxY, ANIM_SPEED);
    draw();

    const diff = Math.abs(c.minX - t.minX) + Math.abs(c.maxX - t.maxX) +
      Math.abs(c.minY - t.minY) + Math.abs(c.maxY - t.maxY);

    if (diff > 0.0005) {
      animId.current = requestAnimationFrame(animate);
    } else {
      c.minX = t.minX; c.maxX = t.maxX; c.minY = t.minY; c.maxY = t.maxY;
      draw();
      animId.current = 0;
    }
  }, [draw]);

  const startAnim = useCallback(() => {
    if (!animId.current) animId.current = requestAnimationFrame(animate);
  }, [animate]);

  useEffect(() => { return () => { if (animId.current) cancelAnimationFrame(animId.current); }; }, []);

  // ── curve/multiPoints変更時に自動でビューポート再計算（参考: CurveEditor.tsx） ──
  useEffect(() => {
    // Bounce/Elasticモード時はそれぞれのuseEffectでビューポート管理するのでスキップ
    if (curveModeRef.current !== 'bezier') {
      draw();
      return;
    }
    const a = genAnchors(curve, multiPoints);
    anchorsRef.current = a;
    const fit = computeFitView(a, canvasAspect());
    targetView.current = fit;
    currentView.current = { ...fit };
    draw();
  }, [curve, multiPoints, genAnchors, draw]);

  // ── リサイズ ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        canvasSz.current = { w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) };
        // リサイズ時にアスペクト比を再計算してビューポート更新
        const fit = computeFitView(anchorsRef.current, canvasAspect());
        targetView.current = fit;
        currentView.current = { ...fit };
        draw();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // ── ヒットテスト ──
  const hitTest = useCallback((mx: number, my: number) => {
    const w = canvasSz.current.w, h = canvasSz.current.h;
    let idx = -1, type: 'point' | 'left' | 'right' = 'point', min = Infinity;
    const r = 12;
    anchorsRef.current.forEach((p, i) => {
      const chk = (pt: Pt, t: 'point' | 'left' | 'right') => {
        const sc = toCanvas(pt, w, h);
        const d = Math.hypot(mx - sc.x, my - sc.y);
        if (d < r && d < min) { min = d; idx = i; type = t; }
      };
      chk(p, 'point');
      if (p.rightHandle) chk(p.rightHandle, 'right');
      if (p.leftHandle) chk(p.leftHandle, 'left');
    });
    return { idx, type };
  }, [toCanvas]);

  // ── マウス座標変換 ──
  const getMousePos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ── ホイールズーム（ビューポート手動操作） ──
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = canvasSz.current.w, h = canvasSz.current.h;
      const gw = w - PAD * 2, gh = h - PAD * 2;
      const v = currentView.current;
      // マウス位置のデータ座標
      const dataX = v.minX + ((mx - PAD) / gw) * (v.maxX - v.minX);
      const dataY = v.maxY - ((my - PAD) / gh) * (v.maxY - v.minY);
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      // マウス位置を中心にズーム
      currentView.current = {
        minX: dataX - (dataX - v.minX) * factor,
        maxX: dataX + (v.maxX - dataX) * factor,
        minY: dataY - (dataY - v.minY) * factor,
        maxY: dataY + (v.maxY - dataY) * factor,
      };
      targetView.current = { ...currentView.current };
      draw();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [draw]);

  // ── キーボード（Space でパンモード） ──
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.code === 'Space' && !isSpaceDown.current) { e.preventDefault(); isSpaceDown.current = true; }
      if (e.key === '0') { e.preventDefault(); targetView.current = computeFitView(anchorsRef.current, canvasAspect()); startAnim(); }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') { isSpaceDown.current = false; isPanning.current = false; } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [startAnim]);

  // ── マウスダウン ──
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = getMousePos(e);
    const w = canvasSz.current.w, h = canvasSz.current.h;

    // Bounce/Elastic ハンドルのhitTest
    const mode = curveModeRef.current;
    if (mode !== 'bezier') {
      let hPt: Pt, cPt: Pt;
      if (mode === 'bounce') {
        const b = bounceRef.current;
        const decay = 0.5;
        let totalRatio = 1;
        for (let i = 1; i <= b.count; i++) totalRatio += 2 * Math.sqrt(b.height * Math.pow(decay, i - 1));
        const peakT = (1 + Math.sqrt(b.height)) / totalRatio;
        hPt = toCanvas({ x: peakT, y: 1 - b.height }, w, h);
        cPt = toCanvas({ x: b.count / 10, y: 1 }, w, h);
      } else {
        const el = elasticRef.current;
        hPt = toCanvas({ x: el.period / 2, y: 1 - el.amp }, w, h);
        cPt = toCanvas({ x: el.period, y: 1 }, w, h);
      }
      const hitR = 12;
      if (Math.hypot(m.x - hPt.x, m.y - hPt.y) < hitR) {
        bcHandleDrag.current = 'h';
        isDragging.current = true;

        const moveH = (me: MouseEvent) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const my = me.clientY - rect.top;
          const n = fromCanvas(0, my, w, h);
          if (curveModeRef.current === 'bounce') {
            setBounceHeight(Math.max(0.1, Math.min(2.0, parseFloat((1 - n.y).toFixed(2)))));
          } else {
            setElasticAmp(Math.max(0.1, Math.min(2.0, parseFloat((1 - n.y).toFixed(2)))));
          }
        };
        const upH = () => {
          bcHandleDrag.current = null;
          isDragging.current = false;
          window.removeEventListener('mousemove', moveH);
          window.removeEventListener('mouseup', upH);
        };
        window.addEventListener('mousemove', moveH);
        window.addEventListener('mouseup', upH);
        return;
      }
      if (Math.hypot(m.x - cPt.x, m.y - cPt.y) < hitR) {
        bcHandleDrag.current = 'c';
        isDragging.current = true;

        const moveC = (me: MouseEvent) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const mx = me.clientX - rect.left;
          const n = fromCanvas(mx, 0, w, h);
          if (curveModeRef.current === 'bounce') {
            setBounceCount(Math.max(1, Math.min(10, Math.round(n.x * 10))));
          } else {
            setElasticPeriod(Math.max(0.1, Math.min(1.0, parseFloat(n.x.toFixed(2)))));
          }
        };
        const upC = () => {
          bcHandleDrag.current = null;
          isDragging.current = false;
          window.removeEventListener('mousemove', moveC);
          window.removeEventListener('mouseup', upC);
        };
        window.addEventListener('mousemove', moveC);
        window.addEventListener('mouseup', upC);
        return;
      }
    }

    // Space+ドラッグ or 中クリック → パン
    if (isSpaceDown.current || e.button === 1) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: m.x, y: m.y };

      const startView = { ...currentView.current };
      const panMove = (me: MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = me.clientX - rect.left - panStart.current.x;
        const dy = me.clientY - rect.top - panStart.current.y;
        const gw = w - PAD * 2, gh = h - PAD * 2;
        const dataW = startView.maxX - startView.minX;
        const dataH = startView.maxY - startView.minY;
        currentView.current = {
          minX: startView.minX - (dx / gw) * dataW,
          maxX: startView.maxX - (dx / gw) * dataW,
          minY: startView.minY + (dy / gh) * dataH,
          maxY: startView.maxY + (dy / gh) * dataH,
        };
        targetView.current = { ...currentView.current };
        draw();
      };
      const panUp = () => {
        isPanning.current = false;
        window.removeEventListener('mousemove', panMove);
        window.removeEventListener('mouseup', panUp);
      };
      window.addEventListener('mousemove', panMove);
      window.addEventListener('mouseup', panUp);
      return;
    }

    const { idx, type } = hitTest(m.x, m.y);
    if (idx < 0) return;

    // Ctrl+クリックで中間アンカー削除
    if (e.ctrlKey && type === 'point' && anchorsRef.current[idx].type === 'anchor') {
      const mp = mpRef.current;
      if (mp) {
        const nmp = [...mp];
        nmp.splice(idx * 3 - 1, 3);
        setMultiPoints(nmp);
      }
      return;
    }

    e.preventDefault();
    isDragging.current = true;
    selRef.current = idx;

    const move = (me: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = me.clientX - rect.left;
      const my = me.clientY - rect.top;
      const n = fromCanvas(mx, my, w, h);

      const pts = anchorsRef.current;
      const next = [...pts];
      const pt = { ...next[idx] };

      if (type === 'point') {
        if (pt.type === 'start') { pt.x = 0; pt.y = 0; }
        else if (pt.type === 'end') { pt.x = 1; pt.y = 1; }
        else {
          const lo = next[idx - 1]?.x ?? 0;
          const hi = next[idx + 1]?.x ?? 1;
          pt.x = Math.max(lo + 0.01, Math.min(hi - 0.01, n.x));
          pt.y = n.y;
        }
      } else if (type === 'right') {
        // 右ハンドル：アンカーより右に行けない
        pt.rightHandle = { x: Math.max(pt.x, n.x), y: n.y };
      } else {
        // 左ハンドル：アンカーより左に行けない
        pt.leftHandle = { x: Math.min(pt.x, n.x), y: n.y };
      }
      next[idx] = pt;
      anchorsRef.current = next;

      // ドラッグ中: targetViewとcurrentViewを即座に同期して描画
      // (startAnimは使わない - stale closure回避)
      const fit = computeFitView(next, canvasAspect());
      targetView.current = fit;
      currentView.current.minX = fit.minX;
      currentView.current.maxX = fit.maxX;
      currentView.current.minY = fit.minY;
      currentView.current.maxY = fit.maxY;
      draw();
    };

    const up = () => {
      isDragging.current = false;
      selRef.current = -1;

      const pts = anchorsRef.current;
      if (pts.length === 2) {
        const rh = pts[0].rightHandle || { x: 0.25, y: 0 };
        const lh = pts[1].leftHandle || { x: 0.75, y: 1 };
        setCurve([rh.x, rh.y, lh.x, lh.y]);
        setMultiPoints(null);
      } else {
        const mp: Pt[] = [];
        for (let i = 0; i < pts.length; i++) {
          mp.push({ x: pts[i].x, y: pts[i].y });
          if (i < pts.length - 1) {
            const nxt = pts[i + 1];
            mp.push(pts[i].rightHandle || { x: pts[i].x + (nxt.x - pts[i].x) * 0.25, y: pts[i].y });
            mp.push(nxt.leftHandle || { x: nxt.x - (nxt.x - pts[i].x) * 0.25, y: nxt.y });
          }
        }
        setMultiPoints(mp);
        if (mp.length >= 4) setCurve([mp[1].x, mp[1].y, mp[2].x, mp[2].y]);
      }

      // ドラッグ終了 → setCurve/setMultiPointsでuseEffectが発火
      // → targetView再計算 → startAnim → スムーズアニメーション
      forceUpdate(n => n + 1);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [hitTest, fromCanvas, getMousePos, draw]);

  // ── ダブルクリック（マルチポイント追加） ──
  const handleDblClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = getMousePos(e);
    const w = canvasSz.current.w, h = canvasSz.current.h;
    const n = fromCanvas(m.x, m.y, w, h);
    const pts = anchorsRef.current;
    if (pts.some(p => Math.hypot(p.x - n.x, p.y - n.y) < 0.05)) return;
    let insertAt = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      if (n.x >= pts[i].x && n.x <= pts[i + 1].x) { insertAt = i + 1; break; }
    }
    if (insertAt < 0) return;
    const c = curveRef.current;
    const mp = mpRef.current || [{ x: 0, y: 0 }, { x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: 1, y: 1 }];
    const newMp = [...mp];
    newMp.splice((insertAt - 1) * 3 + 2, 0,
      { x: n.x - 0.05, y: n.y }, { x: n.x, y: n.y }, { x: n.x + 0.05, y: n.y });
    setMultiPoints(newMp);
  }, [fromCanvas, getMousePos]);

  // ── マウスムーブ（ホバーのみ） ──
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging.current || isPanning.current) return;
    const m = getMousePos(e);

    // Bounce/Elastic ハンドルホバー
    if (curveModeRef.current !== 'bezier') {
      const w = canvasSz.current.w, h = canvasSz.current.h;
      let hPt: Pt, cPt: Pt;
      if (curveModeRef.current === 'bounce') {
        const b = bounceRef.current;
        const decay = 0.5;
        let totalRatio = 1;
        for (let i = 1; i <= b.count; i++) totalRatio += 2 * Math.sqrt(b.height * Math.pow(decay, i - 1));
        const peakT = (1 + Math.sqrt(b.height)) / totalRatio;
        hPt = toCanvas({ x: peakT, y: 1 - b.height }, w, h);
        cPt = toCanvas({ x: b.count / 10, y: 1 }, w, h);
      } else {
        const el = elasticRef.current;
        hPt = toCanvas({ x: el.period / 2, y: 1 - el.amp }, w, h);
        cPt = toCanvas({ x: el.period, y: 1 }, w, h);
      }
      const hitR = 12;
      const oldHov = bcHandleHov.current;
      if (Math.hypot(m.x - hPt.x, m.y - hPt.y) < hitR) bcHandleHov.current = 'h';
      else if (Math.hypot(m.x - cPt.x, m.y - cPt.y) < hitR) bcHandleHov.current = 'c';
      else bcHandleHov.current = null;
      if (bcHandleHov.current !== oldHov) draw();
      return;
    }

    const old = hovRef.current;
    const { idx, type } = hitTest(m.x, m.y);
    if (old.idx !== idx || old.type !== type) {
      hovRef.current = { idx, type };
      draw();
    }
  }, [hitTest, getMousePos, draw, toCanvas]);

  // ── コード ──
  const handleCodeSubmit = () => {
    const m = bezierCode.match(/cubic-bezier\(\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)\s*\)/);
    if (m) { const v = m.slice(1, 5).map(Number) as B4; if (v.every(n => !isNaN(n))) { setCurve(v); setMultiPoints(null); } }
  };
  const handleCopy = () => { navigator.clipboard.writeText(bezierCode); setCopiedRecently(true); setTimeout(() => setCopiedRecently(false), 1500); };

  // ── ミニプリセット ──
  useEffect(() => {
    miniRefs.current.forEach((canvas, name) => {
      const p = allPresets.find(pr => pr.name === name);
      if (p) {
        const active = !multiPoints && curve[0] === p.value[0] && curve[1] === p.value[1] && curve[2] === p.value[2] && curve[3] === p.value[3];
        drawMiniCurve(canvas, p.value, active);
      }
    });
  }, [curve, multiPoints, allPresets]);

  // ── プリセット保存 ──
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [, forceUpdate] = useState(0);

  const handleSavePreset = () => {
    const cat = newCategory.trim() || saveCategory || 'Custom';
    const name = saveName.trim() || `custom_${Date.now()}`;
    const preset: Preset = {
      name: `custom_${Date.now()}`,
      label: name,
      value: [...curve],
      category: cat,
      multiPoints: multiPoints ? [...multiPoints] : undefined,
    };
    const updated = [...customPresets, preset];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    setShowSaveDialog(false);
    setSaveName('');
    setNewCategory('');
  };

  const handleDeletePreset = (presetName: string) => {
    // 標準プリセットの場合は非表示リストに追加
    if (BUILT_IN_PRESETS.some(p => p.name === presetName)) {
      const updated = [...hiddenBuiltIn, presetName];
      setHiddenBuiltIn(updated);
      saveHiddenBuiltIn(updated);
    } else {
      const updated = customPresets.filter(p => p.name !== presetName);
      setCustomPresets(updated);
      saveCustomPresets(updated);
    }
  };

  const handleDeleteCategory = (cat: string) => {
    if (categories.length <= 1) return;
    // 標準プリセットは非表示リストに追加
    const builtInInCat = BUILT_IN_PRESETS.filter(p => p.category === cat && !hiddenBuiltIn.includes(p.name));
    if (builtInInCat.length > 0) {
      const updated = [...hiddenBuiltIn, ...builtInInCat.map(p => p.name)];
      setHiddenBuiltIn(updated);
      saveHiddenBuiltIn(updated);
    }
    // カスタムプリセットは通常削除
    const updatedCustom = customPresets.filter(p => p.category !== cat);
    setCustomPresets(updatedCustom);
    saveCustomPresets(updatedCustom);
    // カスタムカテゴリーからも削除
    const updatedCats = customCategories.filter(c => c !== cat);
    setCustomCategories(updatedCats);
    saveCustomCategories(updatedCats);
  };

  // ── モード切替時のカーブ表示更新 ──
  useEffect(() => {
    if (curveMode === 'bounce' || curveMode === 'elastic') {
      // 2ポイントのみ表示
      setMultiPoints(null);
      anchorsRef.current = [
        { x: 0, y: 0, type: 'start' },
        { x: 1, y: 1, type: 'end' },
      ];
      // 現在のパラメータでビューポートを計算
      let minY = 0, maxY = 1;
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        let y: number;
        if (curveMode === 'bounce') {
          const b = bounceRef.current;
          y = easeOutBounce(t, b.height, b.count);
          if (b.dir === 'in') y = 1 - easeOutBounce(1 - t, b.height, b.count);
          else if (b.dir === 'inout') y = t < 0.5 ? (1 - easeOutBounce(1 - 2 * t, b.height, b.count)) / 2 : (1 + easeOutBounce(2 * t - 1, b.height, b.count)) / 2;
        } else {
          const e = elasticRef.current;
          y = easeOutElastic(t, e.amp, e.period);
          if (e.dir === 'in') y = 1 - easeOutElastic(1 - t, e.amp, e.period);
          else if (e.dir === 'inout') y = t < 0.5 ? (1 - easeOutElastic(1 - 2 * t, e.amp, e.period)) / 2 : (1 + easeOutElastic(2 * t - 1, e.amp, e.period)) / 2;
        }
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const margin = 0.1;
      targetView.current = { minX: -0.1, maxX: 1.1, minY: minY - margin, maxY: maxY + margin };
      startAnim();
      requestAnimationFrame(() => draw());
    } else {
      // Bezierに戻ったらアンカー再生成 + ビューポート自動フィット
      anchorsRef.current = genAnchors(curveRef.current, mpRef.current);
      const fit = computeFitView(anchorsRef.current, canvasAspect());
      targetView.current = fit;
      startAnim();
      requestAnimationFrame(() => draw());
    }
  }, [curveMode, startAnim, draw, genAnchors]);

  const cursor = isDragging.current || bcHandleDrag.current ? 'grabbing'
    : bcHandleHov.current ? 'grab'
    : hovRef.current.idx >= 0 ? 'grab' : 'crosshair';

  // ── 共通スタイル ──
  const btnS: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#666', fontSize: 11, padding: '2px 4px', borderRadius: 3 };
  const inputS: React.CSSProperties = { background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '3px 6px', fontSize: 10, color: 'var(--color-text-primary)', width: '100%', outline: 'none' };
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '3px 0', fontSize: 9, fontWeight: 600, textAlign: 'center', cursor: 'pointer',
    background: active ? '#3b82f6' : 'transparent', color: active ? '#fff' : '#666',
    border: 'none', borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
    transition: 'all 0.15s',
  });
  const iconBtnS: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', color: '#888',
    padding: '3px', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s',
  };

  // カーブ適用ハンドラー
  const handleApply = () => {
    const st = useLayerStore.getState();
    const id = st.selectedLayerIds[0];
    if (!id) return;
    const anims = st.animations[id];
    if (!anims) return;
    for (const prop of Object.keys(anims)) {
      for (const kf of anims[prop].keyframes) {
        st.addKeyframe(id, prop, { ...kf, bezierPoints: [...curve] });
      }
    }
  };

  // カーブ反転（180度回転 / Bounce・Elastic は方向反転）
  const handleFlipCurve = () => {
    if (curveMode === 'bounce') {
      setBounceDir(d => d === 'out' ? 'in' : d === 'in' ? 'out' : 'inout');
    } else if (curveMode === 'elastic') {
      setElasticDir(d => d === 'out' ? 'in' : d === 'in' ? 'out' : 'inout');
    } else {
      setCurve([1 - curve[2], 1 - curve[3], 1 - curve[0], 1 - curve[1]]);
      setMultiPoints(null);
    }
  };

  // カーブリセット（モードごとにデフォルト値に戻す）
  const handleResetCurve = () => {
    if (curveMode === 'bounce') {
      setBounceHeight(1.0);
      setBounceCount(4);
      setBounceDir('out');
    } else if (curveMode === 'elastic') {
      setElasticAmp(1.0);
      setElasticPeriod(0.3);
      setElasticDir('out');
    } else {
      setCurve([0.42, 0, 0.58, 1]);
      setMultiPoints(null);
    }
  };

  // キーフレームからコピー
  const handleCopyFromKeyframe = () => {
    const st = useLayerStore.getState();
    const id = st.selectedLayerIds[0];
    if (!id) return;
    const anims = st.animations[id];
    if (!anims) return;
    const props = Object.keys(anims);
    if (props.length === 0) return;
    const kfs = anims[props[0]].keyframes;
    if (kfs.length === 0) return;
    const bp = kfs[0].bezierPoints;
    if (bp) { setCurve([...bp] as B4); setMultiPoints(null); }
  };

  // カテゴリー追加ハンドラー
  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name || categories.includes(name)) { setShowAddCategory(false); setNewCategoryName(''); return; }
    // カスタムカテゴリーに追加（プリセットがなくても残る）
    const updatedCats = [...customCategories, name];
    setCustomCategories(updatedCats);
    saveCustomCategories(updatedCats);
    setActiveCategory(name);
    setShowAddCategory(false);
    setNewCategoryName('');
  };

  return (
    <div className="easing-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onClick={() => { setContextMenu(null); }}>
      <DraggablePanelHeader panelId="easing" className="" >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flex: 1, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <svg className="panel-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 20 C 8 20, 8 4, 22 4" />
            </svg>
            イージング
          </div>
          <button onClick={() => setShowSettings(true)} style={{ ...iconBtnS, color: '#666' }} title="設定">
            <MIcon name="settings" size={14} />
          </button>
        </div>
      </DraggablePanelHeader>
      <div className="panel-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

        {/* Bezier / Bounce / Elastic タブ */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
          <button style={tabStyle(curveMode === 'bezier')} onClick={() => { setCurveMode('bezier'); setMultiPoints(null); }}>Bezier</button>
          <button style={tabStyle(curveMode === 'bounce')} onClick={() => setCurveMode('bounce')}>Bounce</button>
          <button style={tabStyle(curveMode === 'elastic')} onClick={() => setCurveMode('elastic')}>Elastic</button>
        </div>

        {/* キャンバス */}
        <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 120, position: 'relative', overflow: 'hidden' }}>
          <canvas ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onDoubleClick={curveMode === 'bezier' ? handleDblClick : undefined}
          />
          {multiPoints && (
            <div style={{ position: 'absolute', top: 4, left: 4, fontSize: 8, color: '#3b82f6', background: 'rgba(0,0,0,0.5)', borderRadius: 3, padding: '1px 5px' }}>
              {curveMode === 'bezier' ? `Multi (${anchorsRef.current.length} pts)` : curveMode.toUpperCase()}
            </div>
          )}
        </div>

        {/* Bounce パラメータ */}
        {curveMode === 'bounce' && showBounceSliders && (
          <div style={{ padding: '5px 8px', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              {(['out', 'in', 'inout'] as const).map(d => (
                <button key={d} onClick={() => setBounceDir(d)}
                  style={{ ...btnS, fontSize: 8, flex: 1, textAlign: 'center', background: bounceDir === d ? '#3b82f6' : 'var(--color-bg-hover)', color: bounceDir === d ? '#fff' : '#888', borderRadius: 3, padding: '2px 0' }}>
                  {d === 'inout' ? 'In-Out' : d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 9, color: '#888' }}>
              <span style={{ minWidth: 32 }}>Height</span>
              <input type="range" min="0.1" max="2" step="0.1" value={bounceHeight}
                onChange={e => setBounceHeight(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#3b82f6' }} />
              <span style={{ minWidth: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 8 }}>{bounceHeight.toFixed(1)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 9, color: '#888', marginTop: 2 }}>
              <span style={{ minWidth: 32 }}>Count</span>
              <input type="range" min="1" max="8" step="1" value={bounceCount}
                onChange={e => setBounceCount(parseInt(e.target.value))}
                style={{ flex: 1, accentColor: '#3b82f6' }} />
              <span style={{ minWidth: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 8 }}>{bounceCount}</span>
            </div>
          </div>
        )}

        {/* Elastic パラメータ */}
        {curveMode === 'elastic' && showElasticSliders && (
          <div style={{ padding: '5px 8px', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              {(['out', 'in', 'inout'] as const).map(d => (
                <button key={d} onClick={() => setElasticDir(d)}
                  style={{ ...btnS, fontSize: 8, flex: 1, textAlign: 'center', background: elasticDir === d ? '#3b82f6' : 'var(--color-bg-hover)', color: elasticDir === d ? '#fff' : '#888', borderRadius: 3, padding: '2px 0' }}>
                  {d === 'inout' ? 'In-Out' : d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 9, color: '#888' }}>
              <span style={{ minWidth: 32 }}>Amp</span>
              <input type="range" min="0.1" max="2" step="0.1" value={elasticAmp}
                onChange={e => setElasticAmp(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#3b82f6' }} />
              <span style={{ minWidth: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 8 }}>{elasticAmp.toFixed(1)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 9, color: '#888', marginTop: 2 }}>
              <span style={{ minWidth: 32 }}>Period</span>
              <input type="range" min="0.1" max="1" step="0.05" value={elasticPeriod}
                onChange={e => setElasticPeriod(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#3b82f6' }} />
              <span style={{ minWidth: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 8 }}>{elasticPeriod.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* コード */}
        {showCode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderTop: '1px solid var(--color-border)' }}>
            <input type="text" value={bezierCode}
              onChange={(e) => setBezierCode(e.target.value)}
              onBlur={handleCodeSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 9, textAlign: 'center' }}
            />
            <button onClick={handleCopy} title="Copy" style={{ ...btnS, color: copiedRecently ? '#4caf50' : '#555' }}>
              {copiedRecently ? '✓' : '⎘'}
            </button>
          </div>
        )}

        {/* 数値（Bezierモードのみ） */}
        {showValues && curveMode === 'bezier' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 3, padding: '3px 8px 5px', borderTop: '1px solid var(--color-border)' }}>
            {(['x1', 'y1', 'x2', 'y2'] as const).map((label, i) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 7, color: '#444', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
                <input type="number" value={Math.round(curve[i] * 1000) / 1000}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 0; const c: B4 = [...curve]; c[i] = v; setCurve(c); setMultiPoints(null); }}
                  step={0.01}
                  style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '2px 3px', fontSize: 9, color: 'var(--color-text-primary)', width: '100%', textAlign: 'center' }}
                />
              </div>
            ))}
          </div>
        )}

        {/* ──── アイコンツールバー ──── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 8px', borderTop: '1px solid var(--color-border)' }}>
          <button onClick={handleApply} title="選択レイヤーに適用"
            style={{ ...iconBtnS, color: '#3b82f6' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <MIcon name="check" size={15} />
          </button>
          <button onClick={() => { setShowSaveDialog(true); setSaveName(''); setSaveCategory(categories[0] || 'Custom'); setNewCategory(''); }}
            title="プリセット保存" style={iconBtnS}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <MIcon name="bookmark_add" size={15} />
          </button>
          <button onClick={handleCopyFromKeyframe} title="キーフレームからコピー" style={iconBtnS}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <MIcon name="content_copy" size={15} />
          </button>
          <button onClick={handleFlipCurve} title="カーブを反転（180°回転）" style={iconBtnS}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <MIcon name="flip" size={15} />
          </button>
          <button onClick={handleResetCurve} title="カーブをリセット" style={iconBtnS}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <MIcon name="restart_alt" size={15} />
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={handleCopy} title="cubic-bezierをコピー"
            style={{ ...iconBtnS, color: copiedRecently ? '#4caf50' : '#888' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <MIcon name={copiedRecently ? 'check_circle' : 'content_paste'} size={15} />
          </button>
        </div>

        {/* プリセット */}
        {showPresets && (
          <div style={{ borderTop: '1px solid var(--color-border)' }}>
            {/* カテゴリードロップダウン + 追加/削除 */}
            <div style={{ display: 'flex', gap: 4, padding: '4px 8px', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
              <select
                value={effectiveCategory}
                onChange={e => setActiveCategory(e.target.value)}
                style={{
                  flex: 1, background: 'var(--color-bg-input)', border: '1px solid var(--color-border)',
                  borderRadius: 3, padding: '2px 6px', fontSize: 9, color: 'var(--color-text-primary)',
                  outline: 'none', appearance: 'auto', cursor: 'pointer',
                }}>
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <button onClick={() => { setShowAddCategory(true); setNewCategoryName(''); }}
                title="カテゴリー追加" style={iconBtnS}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <MIcon name="add" size={14} />
              </button>
              <button
                onClick={() => {
                  if (!activeCategory) return;
                  if (categories.length <= 1) return;
                  handleDeleteCategory(activeCategory);
                }}
                title={!activeCategory ? 'カテゴリーを選択してください' : categories.length <= 1 ? '最後のカテゴリーは削除不可' : `${activeCategory} を削除`}
                style={{ ...iconBtnS, color: (!activeCategory || categories.length <= 1) ? '#444' : '#888' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <MIcon name="delete_outline" size={14} />
              </button>
            </div>

            {/* カテゴリー追加インライン入力 */}
            {showAddCategory && (
              <div style={{ display: 'flex', gap: 4, padding: '4px 8px', alignItems: 'center', borderBottom: '1px solid var(--color-border)', background: 'rgba(59,130,246,0.05)' }}>
                <input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') { setShowAddCategory(false); setNewCategoryName(''); } }}
                  placeholder="カテゴリー名..."
                  autoFocus
                  style={{ flex: 1, background: 'var(--color-bg-input)', border: '1px solid #3b82f6', borderRadius: 3, padding: '2px 6px', fontSize: 9, color: 'var(--color-text-primary)', outline: 'none' }}
                />
                <button onClick={handleAddCategory} style={{ ...iconBtnS, color: '#3b82f6' }}>
                  <MIcon name="check" size={14} />
                </button>
                <button onClick={() => { setShowAddCategory(false); setNewCategoryName(''); }} style={{ ...iconBtnS, color: '#888' }}>
                  <MIcon name="close" size={14} />
                </button>
              </div>
            )}

            {/* プリセットグリッド */}
            <div style={{ padding: '4px 8px 4px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {filteredPresets.map((p) => {
                const active = !multiPoints && curve[0] === p.value[0] && curve[1] === p.value[1] && curve[2] === p.value[2] && curve[3] === p.value[3];
                const mpActive = p.multiPoints && multiPoints && JSON.stringify(multiPoints) === JSON.stringify(p.multiPoints);
                const isOn = active || mpActive;
                return (
                  <div key={p.name} style={{ position: 'relative' }}>
                    <button
                      onClick={() => { setCurve([...p.value]); setMultiPoints(p.multiPoints ? [...p.multiPoints] : null); setCurveMode('bezier'); }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, presetName: p.name });
                      }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '100%',
                        padding: 3, background: isOn ? 'rgba(59,130,246,0.15)' : 'var(--color-bg-hover)',
                        border: isOn ? '1px solid #3b82f6' : '1px solid var(--color-border)',
                        borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                      <canvas ref={(el) => { if (el) miniRefs.current.set(p.name, el); }}
                        style={{ width: '100%', height: 28, display: 'block', borderRadius: 2 }} />
                      <span style={{ fontSize: 7, color: isOn ? '#3b82f6' : '#666' }}>{p.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 右クリックコンテキストメニュー */}
      {contextMenu && (
        <>
          <div onClick={() => setContextMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
          <div
            style={{
              position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
              background: '#1e1e22', border: '1px solid var(--color-border)', borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)', padding: '4px 0', minWidth: 120,
            }}>
            <button
              onClick={() => { handleDeletePreset(contextMenu.presetName); setContextMenu(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                background: 'none', border: 'none', padding: '5px 12px', fontSize: 10, color: '#e53e3e',
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(229,62,62,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <MIcon name="delete" size={14} />
              プリセットを削除
            </button>
          </div>
        </>
      )}

      {/* 設定モーダル */}
      {showSettings && (
        <div onClick={() => setShowSettings(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e1e22', borderRadius: 8, padding: 16, minWidth: 220, border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd', marginBottom: 12 }}>表示設定</div>
            {[
              { label: 'Code (cubic-bezier)', get: showCode, set: setShowCode },
              { label: 'Values (x1,y1,x2,y2)', get: showValues, set: setShowValues },
              { label: 'Presets', get: showPresets, set: setShowPresets },
              { label: 'Bounce スライダー', get: showBounceSliders, set: setShowBounceSliders },
              { label: 'Elastic スライダー', get: showElasticSliders, set: setShowElasticSliders },
            ].map(item => (
              <label key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 10, color: '#aaa', cursor: 'pointer' }}>
                <input type="checkbox" checked={item.get}
                  onChange={() => item.set((v: boolean) => !v)}
                  style={{ accentColor: '#3b82f6' }} />
                {item.label}
              </label>
            ))}
            <button onClick={() => setShowSettings(false)}
              style={{ marginTop: 12, width: '100%', background: '#3b82f6', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* プリセット保存ダイアログ */}
      {showSaveDialog && (
        <div onClick={() => setShowSaveDialog(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1e1e22', borderRadius: 8, padding: 16, minWidth: 240, border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd', marginBottom: 12 }}>プリセットを保存</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#888', marginBottom: 3 }}>名前</div>
              <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="My Easing"
                style={inputS} autoFocus />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#888', marginBottom: 3 }}>カテゴリー</div>
              <select value={saveCategory} onChange={e => setSaveCategory(e.target.value)}
                style={{ ...inputS, appearance: 'auto' }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new">+ 新しいカテゴリー</option>
              </select>
            </div>
            {saveCategory === '__new' && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: '#888', marginBottom: 3 }}>新しいカテゴリー名</div>
                <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Category"
                  style={inputS} />
              </div>
            )}
            <div style={{ fontSize: 9, color: '#555', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
              {curveMode === 'bezier' ? `cubic-bezier(${curve.map(v => v.toFixed(2)).join(', ')})` : curveMode === 'bounce' ? `bounce(${bounceHeight}, ${bounceCount})` : `elastic(${elasticAmp}, ${elasticPeriod})`}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowSaveDialog(false)}
                style={{ flex: 1, background: 'var(--color-bg-hover)', color: '#aaa', border: '1px solid var(--color-border)', padding: '5px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>
                キャンセル
              </button>
              <button onClick={handleSavePreset}
                style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
