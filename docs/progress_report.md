# NGS_MovieEditor — 開発進捗レポート

> 最終更新: 2026-06-17

---

## プロジェクト概要

**FluxMotion** — ブラウザベースのモーショングラフィックスエディタ（After Effects風）
- **フレームワーク**: Tauri + React + TypeScript + Vite
- **レンダリング**: Canvas2D + WebGPU（実験的）
- **状態管理**: Zustand
- **スタイル**: Vanilla CSS（カスタムデザインシステム）

---

## アーキテクチャ

```
src/
├── App.tsx                    # メインレイアウト + グローバルショートカット
├── main.tsx                   # エントリーポイント
├── components/
│   ├── Preview/Preview.tsx    # プレビューキャンバス + レイヤーオーバーレイ
│   ├── Timeline/Timeline.tsx  # タイムライン（ルーラー・トラック・KF）
│   ├── Properties/Properties.tsx # プロパティパネル
│   ├── EasingEditor/          # ベジェイージングエディタ
│   ├── MenuBar/               # メニューバー
│   ├── Toolbar/               # ツールバー
│   └── common/                # 共通コンポーネント（ContextMenu等）
├── stores/
│   ├── layerStore.ts          # レイヤー管理（CRUD・アニメーション・Undo）
│   ├── timelineStore.ts       # タイムライン状態（再生・フレーム・ズーム）
│   ├── projectStore.ts        # プロジェクト設定（解像度・FPS）
│   ├── uiStore.ts             # UI状態（パネル・コンテキストメニュー）
│   ├── historyStore.ts        # Undo/Redo履歴管理
│   └── engine/
│       ├── keyframe.ts        # キーフレーム補間エンジン
│       ├── animation.ts       # アニメーションループ
│       ├── renderer.ts        # Canvas2Dレンダラー（方向別スケール対応）
│       ├── webgpuRenderer.ts  # WebGPUレンダラー
│       └── projectIO.ts       # プロジェクトファイル入出力
├── types/
│   ├── layer.ts               # レイヤー型定義
│   ├── keyframe.ts            # キーフレーム型定義
│   └── project.ts             # プロジェクト型定義
└── styles/
    ├── index.css              # デザインシステム + グローバルスタイル
    ├── panels.css             # パネル（プロパティ等）専用スタイル
    └── timeline.css           # タイムライン専用スタイル
```

---

## 実装済み機能一覧

### コア機能
| 機能 | 状態 | ファイル |
|------|------|----------|
| レイヤー追加（ソリッド/テキスト/シェイプ） | ✅ | layerStore.ts |
| レイヤー削除・複製 | ✅ | layerStore.ts |
| レイヤー選択（単体/複数） | ✅ | layerStore.ts |
| レイヤー全選択 | ✅ | layerStore.ts |
| レイヤー並べ替え（マウスドラッグ） | ✅ | Timeline.tsx |
| レイヤー表示/非表示切替 | ✅ | layerStore.ts |
| レイヤーロック | ✅ | layerStore.ts |
| Undo/Redo（Ctrl+Z/Y） | ✅ | historyStore.ts |
| コピー/ペースト/カット（Ctrl+C/V/X） | ✅ | layerStore.ts |
| レイヤー複製（Ctrl+D） | ✅ | layerStore.ts |
| レイヤー分割（Ctrl+Shift+D） | ✅ | layerStore.ts |
| メディアインポート（画像/動画） | ✅ | MenuBar.tsx, App.tsx |
| プリコンポジション（Ctrl+Shift+C） | ✅ | layerStore.ts |
| ラベルカラー（8色プリセット） | ✅ | layerStore.ts, Timeline.tsx |
| モーションブラー（マルチサンプル） | ✅ | renderer.ts, Timeline.tsx |

### タイムライン
| 機能 | 状態 | ファイル |
|------|------|----------|
| ルーラー表示（時間/フレーム） | ✅ | Timeline.tsx |
| プレイヘッド移動 | ✅ | Timeline.tsx |
| クリップバー表示 | ✅ | Timeline.tsx |
| クリップ移動ドラッグ | ✅ | Timeline.tsx |
| トリム（左端/右端） | ✅ | Timeline.tsx |
| ズーム（Ctrl+ホイール） | ✅ | Timeline.tsx |
| 再生/停止（スペースキー） | ✅ | App.tsx |
| フレーム送り（← →） | ✅ | App.tsx |
| ワークエリア（B/Nキー） | ✅ | timelineStore.ts, Timeline.tsx |

### キーフレーム
| 機能 | 状態 | ファイル |
|------|------|----------|
| キーフレーム補間エンジン | ✅ | engine/keyframe.ts |
| ベジェ/リニア/ホールド補間 | ✅ | engine/keyframe.ts |
| プロパティパネルで補間値表示 | ✅ | Properties.tsx |
| KF追加/削除（◆ボタン） | ✅ | Properties.tsx, Timeline.tsx |
| KFドラッグ移動 | ✅ | Timeline.tsx |
| KF複数選択（Shift/Ctrl+クリック） | ✅ | Timeline.tsx |
| KF一括削除（Delete/Backspace） | ✅ | Timeline.tsx |
| 右クリックコンテキストメニュー | ✅ | Timeline.tsx |
| 補間タイプ変更（リニア/ベジェ/ホールド） | ✅ | Timeline.tsx |
| 補間タイプ別のダイヤモンド表示 | ✅ | timeline.css |
| Uキー展開（KF付きプロパティ） | ✅ | App.tsx |
| Iキー一括KF追加 | ✅ | App.tsx |

### プレビュー
| 機能 | 状態 | ファイル |
|------|------|----------|
| Canvas2Dレンダリング | ✅ | engine/renderer.ts |
| WebGPUレンダリング（実験的） | ✅ | engine/webgpuRenderer.ts |
| テキスト表示 | ✅ | engine/renderer.ts |
| ソリッド・シェイプ表示 | ✅ | engine/renderer.ts |
| 画像レイヤー表示 | ✅ | engine/renderer.ts |
| 動画レイヤー表示 | ✅ | engine/renderer.ts |
| バウンディングボックス表示 | ✅ | Preview.tsx |
| 8方向リサイズハンドル | ✅ | Preview.tsx |
| レイヤーのドラッグ移動 | ✅ | Preview.tsx |
| テキストインライン編集 | ✅ | Preview.tsx |
| ドラッグ中のカーソルロック | ✅ | Preview.tsx |
| グリッドオーバーレイ（Ctrl+'） | ✅ | Preview.tsx, uiStore.ts |
| スナップ（中心/グリッド） | ✅ | Preview.tsx |
| スナップライン表示 | ✅ | Preview.tsx |
| モーションブラー描画 | ✅ | renderer.ts |
| ツールオプションバー（動的UI） | ✅ | ToolOptionsBar.tsx |
| テキストのキャンバス直接入力 | ✅ | Preview.tsx |
| ペンツール（頂点の追加/削除） | ✅ | usePenTool.ts, Preview.tsx |
| マスク・シェイプモード切替 | ✅ | ToolOptionsBar.tsx |

### プロパティパネル
| 機能 | 状態 | ファイル |
|------|------|----------|
| トランスフォーム編集（位置/スケール/回転/不透明度） | ✅ | Properties.tsx |
| アニメーション済みプロパティのハイライト | ✅ | Properties.tsx |
| KF自動更新（値変更時） | ✅ | Properties.tsx |
| スケール次元分割（統合 ↔ X/Y ↔ 上下左右） | ✅ | Properties.tsx |
| 方向別スケール（上/下/左/右の独立スケーリング） | ✅ | Properties.tsx, renderer.ts |
| スケールリンク（比率保持でX/Y連動） | ✅ | Properties.tsx |
| 次元統合時の位置補正（視覚的重心維持） | ✅ | Properties.tsx |
| 位置/アンカーポイントの次元分割 | ✅ | Properties.tsx |
| テキストプロパティ編集（フォントサイズ/色/行間等） | ✅ | Properties.tsx |
| シェイププロパティ編集（塗り/線/角丸等） | ✅ | Properties.tsx |
| ブレンドモード選択 | ✅ | Properties.tsx |
| ラベルドラッグで値変更 | ✅ | Properties.tsx |

### その他
| 機能 | 状態 | ファイル |
|------|------|----------|
| プロジェクト保存/読み込み | ✅ | engine/projectIO.ts |
| メニューバー | ✅ | MenuBar.tsx |
| メニュー外クリックで閉じる | ✅ | MenuBar.tsx |
| コンテキストメニュー | ✅ | common/ContextMenu |
| パネルレイアウト | ✅ | App.tsx |
| イージングエディタ | ✅ | EasingEditor.tsx |
| AE風プロパティパネルUI | ✅ | Properties.tsx, panels.css |
| フレームPNGエクスポート | ✅ | MenuBar.tsx, App.tsx |

---

## ショートカット一覧

| キー | 動作 |
|------|------|
| Space | 再生/停止 |
| ← → | 1フレーム送り/戻り |
| Home | 先頭フレームへ |
| End | 最終フレームへ |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C | レイヤーコピー |
| Ctrl+V | レイヤーペースト |
| Ctrl+X | レイヤーカット |
| Ctrl+D | レイヤー複製 |
| Ctrl+Shift+D | レイヤー分割 |
| Ctrl+A | 全選択 |
| Ctrl+I | メディアインポート |
| Ctrl+Shift+E | フレームPNGエクスポート |
| Ctrl+S | プロジェクト保存 |
| Ctrl+O | プロジェクトを開く |
| Ctrl+N | 新規プロジェクト |
| Ctrl+K | コンポジション設定 |
| Delete | レイヤー削除 / 選択KF削除 |
| V | 選択ツール |
| H | 手のひらツール |
| T | テキストツール（+レイヤー追加） |
| Q | シェイプツール |
| G | ペンツール |
| U | KF付きプロパティ展開/折りたたみ |
| I | 全プロパティにKF一括追加 |
| B | ワークエリアIn点設定 |
| N | ワークエリアOut点設定 |
| Ctrl+Shift+C | プリコンポジション |
| Ctrl+' | グリッド表示切替 |
| Ctrl+Shift+; | スナップ有効/無効 |
| Shift/Ctrl+クリック | KF複数選択 |

---

## 完成度の見積もり

```
コア機能       ███████████████████████░  95%
タイムライン   ██████████████████████░░  90%
キーフレーム   █████████████████████░░░  85%
プレビュー     ██████████████████████░░  90%
プロパティ     ████████████████████░░░░  80%
エフェクト     ░░░░░░░░░░░░░░░░░░░░░░░░  0%
エクスポート   ███░░░░░░░░░░░░░░░░░░░░░  15%
メディア対応   ██████████░░░░░░░░░░░░░░  40%
─────────────────────────────────
全体           █████████████████░░░░░░░  65%
```
