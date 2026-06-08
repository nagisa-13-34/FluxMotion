# FluxMotion — 次にやるべきこと

> 作成日: 2026-06-08  
> ベース: `docs/roadmap.md`（最終更新 2026-06-07）  
> 現在の全体完成度: **約 45%**

---

## 🗺️ 実装フロー（推奨順）

```
① プロパティパネル完成（1〜2週）
        ↓
② タイムライン縦スクロール同期（3日）
        ↓
② EasingEditor 独立パネル化（1〜2日）← 作業量少・効果大
        ↓
③ 画像インポート + Canvas2D レンダリング（1〜2週）
        ↓
④ エクスポート MVP（WebCodecs MP4書き出し）（1〜2週）
        ↓
⑤ エフェクト（ブラー / シャドウ / カラー補正）（2〜3週）
        ↓
⑥ 動画インポート / オーディオ（並行可）
        ↓
⑦ マスク / トラックマット（1〜2週）
        ↓
v1.0 リリース 🎉
```

---

## ① プロパティパネルの全プロパティ対応
**完成度: 50% → 100% が目標**  
**対象ファイル**: `src/components/Properties/Properties.tsx`, `Timeline.tsx`

### テキストレイヤー
- [ ] フォントファミリー選択（`<select>` or コンボボックス）
- [ ] フォントサイズ・太さ（`fontWeight`）
- [ ] 文字色（カラーピッカー）
- [ ] 行間・文字間隔（`lineHeight`, `letterSpacing`）
- [ ] テキスト内容のインライン編集（現状ダブルクリックで可能 → プロパティパネルからも編集）
- [ ] テキスト揃え（左・中央・右）

### ソリッドレイヤー
- [ ] 塗り色の編集（カラーピッカー）

### シェイプレイヤー
- [ ] 塗り（Fill）: 色・不透明度
- [ ] 線（Stroke）: 色・幅・線端スタイル（butt / round / square）
- [ ] 角丸（矩形の `borderRadius`）
- [ ] シェイプ種類の切り替え（矩形 / 楕円 / 多角形）

### 全レイヤー共通
- [ ] ブレンドモード（`globalCompositeOperation`）
- [ ] 親子関係（Parent ドロップダウン）

---

## ② タイムラインのスクロール同期
**対象ファイル**: `src/components/Timeline/Timeline.tsx`, `timeline.css`

- [ ] レイヤーリスト（左）↔ トラック（右）の縦スクロール同期  
  → `onScroll` イベントで `scrollTop` を双方向に同期
- [ ] 再生時のプレイヘッド追従（オートスクロール）  
  → 再生中、プレイヘッドが表示領域右端に近づいたらスクロール
- [ ] 水平スクロールバーの追加

---

## ③ 画像・動画インポート
**完成度: 0% → 段階的に**  
**対象ファイル**: `layerStore.ts`, `engine/renderer.ts`, `Preview.tsx`, `Timeline.tsx`

### Step 1: 画像インポート（先にやる）
- [ ] Tauri の `open` ダイアログで PNG / JPEG / WebP を選択
- [ ] `HTMLImageElement` を生成してキャッシュ
- [ ] Canvas2D での `drawImage` レンダリング
- [ ] タイムラインのクリップバー内にサムネイル表示
- [ ] ドラッグ＆ドロップでのインポートも対応

### Step 2: 動画インポート（後でOK）
- [ ] `HTMLVideoElement` を生成してシーク同期
- [ ] `currentTime` を現在フレームに合わせて `drawImage`
- [ ] 再生時のフレームレート同期

---

## ④ エクスポート機能（MVP）
**完成度: 0% → まずMP4書き出しだけ**  
**新規ファイル**: `src/stores/engine/exporter.ts`

- [ ] オフスクリーン Canvas でフレーム連番レンダリング
- [ ] `VideoEncoder`（WebCodecs API）でエンコード
- [ ] `MP4Muxer` または `mux.js` で MP4 にコンテナ化
- [ ] 書き出し進捗バー UI（`<dialog>` or モーダル）
- [ ] 解像度 / FPS 選択ダイアログ
- [ ] Tauri の `save` ダイアログでファイル保存

> **注意**: WebCodecs は Chrome / Tauri（WebView2 / WKWebView）では使えるが、
> Firefox では未サポート。Tauri 前提なら問題なし。

---

## ② EasingEditor 独立パネル化
**現状分析**: コンポーネントはすでに `panel-header` / `panel-content` 構造のパネルとして実装済み。モーダルではないため、変更量は最小限。  
**対象ファイル**: `EasingEditor.tsx`, `uiStore.ts`, `App.tsx`, `Timeline.tsx`

> **コード調査済み**: Bezier / Bounce / Elastic の3モード、カスタムプリセット、ビューポートパン・ズーム、`handleApply` / `handleCopyFromKeyframe` も実装済み。

### Step 1 — `EasingEditor.tsx` の高さを柔軟化（3行修正）

```tsx
// 1150行目: 最外層に height: '100%' を追加
<div className="easing-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} ...>

// 1162行目: panel-content を flex コンテナに
<div className="panel-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

// 1172行目: キャンバス高さ固定 200px → flex: 1 に
<div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 120, position: 'relative', overflow: 'hidden' }}>
```

### Step 2 — `uiStore.ts` に開閉状態を追加

```ts
isEasingEditorOpen: boolean;   // 初期値: false
easingPanelHeight: number;     // 初期値: 260

toggleEasingEditor: () => set(s => ({ isEasingEditorOpen: !s.isEasingEditorOpen })),
setEasingPanelHeight: (h: number) => set({ easingPanelHeight: h }),
```

### Step 3 — `App.tsx` にパネルを追加（タイムライン直下）

```tsx
{isEasingEditorOpen && (
  <div style={{ height: easingPanelHeight, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
    {/* リサイズハンドル */}
    <div style={{ height: 4, cursor: 'ns-resize' }}
      onMouseDown={(e) => {
        const startY = e.clientY, startH = easingPanelHeight;
        const onMove = (e: MouseEvent) =>
          setEasingPanelHeight(Math.max(180, Math.min(600, startH - (e.clientY - startY))));
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }}
    />
    <EasingEditor />
  </div>
)}
```

### Step 4 — `Timeline.tsx` の KF 右クリックメニューに開閉トリガーを追加

```tsx
<MenuItem onClick={() => {
  if (!isEasingEditorOpen) toggleEasingEditor();
  // handleCopyFromKeyframe() は EasingEditor 側の既存実装を利用
}}>
  イージングを編集
</MenuItem>
```

### パネルの開閉トリガー一覧

| 操作 | 挙動 |
|------|------|
| KF 右クリック →「イージングを編集」 | パネルが開く |
| View メニュー → 「イージングエディター」 | トグル |
| パネルヘッダーの設定ボタン横に ✕ を追加 | 閉じる |
| `0` キー | ビューポートをカーブにフィット（既存実装済み） |

### `localStorage` について
現状の実装（プリセット・カテゴリーの永続化）はそのまま動作可。将来 `tauri-plugin-store` に移行する場合は `loadCustomPresets` / `saveCustomPresets` 等の関数を差し替えるだけでOK。

---

## ⑥ エフェクト・フィルター
**完成度: 0%**  
**新規ファイル**: `src/types/effect.ts`, `src/stores/engine/effects.ts`

### 実装順（難易度の低い順）
1. [ ] **カラー補正**（明るさ / コントラスト / 彩度） — Canvas2D の `filter` CSS で簡単に実装可
2. [ ] **ガウスブラー** — `filter: blur(Npx)` or WebGPU カーネル
3. [ ] **ドロップシャドウ** — `filter: drop-shadow(...)`
4. [ ] **グロー** — ブラーを重ねて合成
5. [ ] **カラーオーバーレイ** — ブレンドモード活用
6. [ ] エフェクトパラメータのキーフレーム対応
7. [ ] エフェクトパネル UI（プロパティパネル内に追加）

---

## ⑦ オーディオ対応
**新規ファイル**: `src/stores/engine/audio.ts`

- [ ] 音声レイヤー（`type: 'audio'`）の追加
- [ ] `AudioContext` + `AudioBufferSourceNode` で再生同期
- [ ] 波形データの事前計算・描画（タイムライントラック内）
- [ ] 音量のキーフレームアニメーション（`GainNode`）

---

## ⑧ マスク / トラックマット
**新規ファイル**: `src/types/mask.ts`

- [ ] 矩形 / 楕円マスクの実装（Canvas2D の `clip()`）
- [ ] パスマスク（ベジェ曲線）
- [ ] マスクのキーフレームアニメーション
- [ ] トラックマット（上のレイヤーをアルファ / 輝度マットとして使う）

---

## 🔧 技術的負債（並行して対処）

| 優先度 | 項目 | 対処法 |
|--------|------|--------|
| 🔴 | プロパティキーが `string` ベースで型安全性が弱い | `PropertyKey` 型を `union` に変更 |
| 🟡 | `getAnimatedValue` とレンダラーの統合が一部不完全 | レンダラー呼び出し箇所を全点検 |
| 🟡 | 大量KF同時ドラッグのパフォーマンス | `useMemo` / `useCallback` で再レンダリング抑制 |
| 🟢 | ユニットテスト未作成 | Vitest でキーフレーム補間のテストから着手 |

---

## 🔮 将来構想（v2以降）

- **Plugin / Script システム**: エクスプレッション対応・WASM プラグイン
- **プリコンポーズ / ネスト**: コンポジション概念の導入
- **3DCG 統合**: Three.js + wgpu による 3D ビューポート・モデリング
- **コラボレーション**: リアルタイム共同編集・バージョン履歴

---

## 📊 完成度トラッカー

| 機能 | 現在 | 目標 |
|------|------|------|
| コア機能 | 80% | 100% |
| タイムライン | 85% | 100% |
| キーフレーム | 85% | 100% |
| プレビュー | 65% | 90% |
| **プロパティパネル** | **50%** | **100%** |
| **エフェクト** | **0%** | **60%** |
| **エクスポート** | **0%** | **80%** |
| **メディア対応** | **0%** | **80%** |
| 全体 | 45% | **80%（v1.0）** |
