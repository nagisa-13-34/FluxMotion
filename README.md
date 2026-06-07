# FluxMotion

GPU加速対応のデスクトップ映像編集アプリ。After Effects風のUIで、ブラウザ技術（React + WebGPU）とネイティブ性能（Tauri / Rust）を両立。

## ✨ 特徴

- 🎬 **キーフレームアニメーション** — cubic-bezier補間、Bounce / Elastic カーブ対応
- 🎮 **WebGPU レンダラー** — WGSLシェーダーによるGPU描画（Canvas2D自動フォールバック付き）
- 🖥️ **ネイティブアプリ** — Tauri v2 による軽量デスクトップアプリ（.exe / .msi）
- 🎨 **AE風タイムライン** — レイヤー管理、ドラッグ＆ドロップ並べ替え、クリップトリム
- 💎 **イージングエディタ** — Bezier / Bounce / Elastic カーブをビジュアル編集、プリセット保存
- ↩️ **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z（50件履歴）
- 💾 **プロジェクト保存** — `.fmproj` 形式でJSON書き出し/読み込み
- 🧩 **レイヤータイプ** — ソリッド、テキスト、シェイプ（矩形/楕円/星型）、ヌル、調整

## 🛠️ 技術スタック

| 領域 | 技術 |
|------|------|
| フロントエンド | React 19 + TypeScript |
| ビルド | Vite 8 |
| 状態管理 | Zustand |
| レンダリング | Canvas 2D / WebGPU (WGSL) |
| デスクトップ | Tauri v2 (Rust) |
| スタイル | Vanilla CSS (カスタムプロパティ) |

## 📦 セットアップ

### 必要なもの

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (Tauriビルド用)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### インストール

```bash
npm install
```

### 開発サーバー（ブラウザ）

```bash
npm run dev
```

`http://localhost:1420` でアクセス。

### 開発サーバー（Tauriウィンドウ）

```bash
npx tauri dev
```

### プロダクションビルド（.exe）

```bash
npx tauri build
```

出力先: `src-tauri/target/release/FluxMotion.exe`  
インストーラー: `src-tauri/target/release/bundle/`

## 🗂️ ディレクトリ構造

```
src/
├── components/
│   ├── EasingEditor/   # イージングカーブエディタ
│   ├── MenuBar/        # メニューバー
│   ├── Preview/        # プレビュー / ビューポート
│   ├── Properties/     # プロパティパネル
│   ├── Timeline/       # タイムライン
│   ├── Toolbar/        # ツールバー
│   └── common/         # 共通コンポーネント
├── stores/
│   ├── engine/
│   │   ├── renderer.ts        # Canvas 2D レンダラー
│   │   ├── webgpuRenderer.ts  # WebGPU レンダラー
│   │   ├── keyframe.ts        # キーフレーム補間エンジン
│   │   ├── animation.ts       # アニメーションループ
│   │   └── projectIO.ts       # プロジェクト保存/読み込み
│   ├── layerStore.ts    # レイヤー状態管理
│   ├── historyStore.ts  # Undo/Redo 履歴
│   ├── timelineStore.ts # タイムライン状態
│   ├── projectStore.ts  # プロジェクト設定
│   └── uiStore.ts       # UI状態
├── types/               # TypeScript型定義
└── styles/              # CSSデザインシステム

src-tauri/               # Tauri (Rust) バックエンド
```

## ⌨️ ショートカット

| キー | 操作 |
|------|------|
| `Space` | 再生 / 停止 |
| `←` `→` | 1フレーム移動 |
| `Home` | 先頭へ |
| `End` | 末尾へ |
| `Ctrl+Z` | 元に戻す |
| `Ctrl+Shift+Z` | やり直し |

## 📄 ライセンス

Private
