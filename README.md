# FluxMotion

GPU加速対応のデスクトップ映像編集アプリ。After Effects風のUIでブラウザ技術とネイティブ性能を両立させてる。

## 特徴

- キーフレームアニメーション対応で、cubic-bezier補間やBounce/Elasticカーブも使える
- WebGPUレンダラーでGPU描画できる。Canvas2Dへの自動フォールバックもある
- Tauri v2を使ったネイティブアプリとして動く
- AE風のタイムラインでレイヤー管理やドラッグでの並べ替え、クリップのトリムができる
- ベジェイージングエディタでカーブをビジュアル編集、プリセットの保存も可能
- Ctrl+Z / Ctrl+Shift+Zで50件のUndo/Redo対応
- `.fmproj`形式でプロジェクトをJSON書き出し/読み込みできる
- レイヤーはソリッド/テキスト/シェイプ/ヌル/調整が使える

## 技術スタック

| 領域 | 技術 |
|------|------|
| フロントエンド | React 19 + TypeScript |
| ビルド | Vite 8 |
| 状態管理 | Zustand |
| レンダリング | Canvas 2D / WebGPU |
| デスクトップ | Tauri v2 / Rust |
| スタイル | Vanilla CSS |

## セットアップ

### 必要なもの

- Node.js 18以上
- Rust (Tauriビルド用)
- Tauri CLI

### インストール

```bash
npm install
```

### 開発サーバー

ブラウザで動かす場合:

```bash
npm run dev
```

`http://localhost:1420`でアクセスできる。

Tauriウィンドウで動かす場合:

```bash
npx tauri dev
```

### プロダクションビルド

```bash
npx tauri build
```

出力先は `src-tauri/target/release/FluxMotion.exe`、インストーラーは `src-tauri/target/release/bundle/` に生成される。

## 実装済み機能

### コア機能
- レイヤーの追加/削除/複製/並べ替え
- 複数レイヤー選択、表示/非表示切替、ロック
- Undo/Redo、コピー/ペースト/カット
- レイヤー分割

### タイムライン
- ルーラー表示とプレイヘッド移動
- クリップバーの移動/左右トリム
- Ctrl+ホイールでズーム
- スペースキーで再生/停止、矢印キーでフレーム送り

### キーフレーム
- ベジェ/リニア/ホールドの3種類の補間に対応
- ダイヤモンドの形で補間タイプがわかる。ベジェは◆、リニアは●、ホールドは■
- Shift/Ctrlクリックで複数選択、Deleteで一括削除
- 右クリックメニューから補間タイプを変更できる
- ドラッグで複数KFをまとめて移動
- Uキーでアニメーション済みプロパティだけ展開
- Iキーで全プロパティに一括KF追加

### プレビュー
- Canvas2DとWebGPUでのレンダリング
- テキスト/ソリッド/シェイプの表示
- バウンディングボックスが常に表示されて、ドラッグで位置を移動できる
- テキストのダブルクリックでインライン編集

### プロパティパネル
- トランスフォームの編集。位置/スケール/回転/不透明度/アンカーポイント
- アニメーション済みプロパティがハイライト表示される
- 値を変更すると現在フレームのKFが自動更新される

## ディレクトリ構造

```
src/
├── components/
│   ├── EasingEditor/   # イージングカーブエディタ
│   ├── MenuBar/        # メニューバー
│   ├── Preview/        # プレビュー
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

src-tauri/               # Tauri / Rust バックエンド
docs/                    # ドキュメント
├── progress_report.md   # 開発進捗レポート
└── roadmap.md           # 完成形ロードマップ
```

## ショートカット

| キー | 操作 |
|------|------|
| Space | 再生/停止 |
| ← → | 1フレーム移動 |
| Home | 先頭へ |
| End | 末尾へ |
| Ctrl+Z | 元に戻す |
| Ctrl+Y / Ctrl+Shift+Z | やり直し |
| Ctrl+C / X / V | コピー/カット/ペースト |
| Ctrl+D | レイヤー複製 |
| Ctrl+Shift+D | レイヤー分割 |
| Delete | レイヤー削除 / 選択KF削除 |
| U | KF付きプロパティ展開 |
| I | 全プロパティにKF一括追加 |

## ロードマップ

残りの主な機能は以下の通り。詳細は `docs/roadmap.md` を参照。

- プロパティパネルの全プロパティ対応。テキストのフォントや色、シェイプの塗り/線の編集
- 画像/動画のインポートとレンダリング
- エクスポート機能。WebCodecs APIでのMP4/WebM書き出し
- グラフエディタとの統合
- エフェクト/フィルター
- オーディオ対応

## ライセンス

MIT License. 詳しくは [LICENSE](LICENSE) を参照。
