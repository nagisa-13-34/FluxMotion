import { create } from 'zustand';
import { Model, Actions, DockLocation } from 'flexlayout-react';
import type { IJsonModel } from 'flexlayout-react';

export type ToolType = 'select' | 'hand' | 'text' | 'shape' | 'pen';
import type { ShapeType } from '../types/layer';

/** パネルID定数 */
export const PANEL_IDS = {
  PREVIEW: 'preview',
  TIMELINE: 'timeline',
  PROPERTIES: 'properties',
  EASING: 'easing',
  TOOLBAR: 'toolbar',
} as const;

/** パネル表示名 */
export const PANEL_LABELS: Record<string, string> = {
  [PANEL_IDS.PREVIEW]: 'プレビュー',
  [PANEL_IDS.TIMELINE]: 'タイムライン',
  [PANEL_IDS.PROPERTIES]: 'プロパティ',
  [PANEL_IDS.EASING]: 'イージング',
  [PANEL_IDS.TOOLBAR]: 'ツールバー',
};

/** FlexLayout のデフォルト JSON モデル */
const DEFAULT_LAYOUT: IJsonModel = {
  global: {
    tabSetEnableMaximize: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 80,
    tabEnableClose: false,
    tabSetEnableClose: false,
    tabEnableRename: false,
    tabSetEnableDeleteWhenEmpty: true,
    borderEnableAutoHide: true,
  },
  borders: [
    {
      type: 'border',
      location: 'left',
      size: 40,
      selected: 0,
      children: [
        {
          type: 'tab',
          id: PANEL_IDS.TOOLBAR,
          name: 'ツール',
          component: PANEL_IDS.TOOLBAR,
          enableClose: false,
          enableDrag: false,
        },
      ],
    },
  ],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 70,
        children: [
          {
            type: 'tabset',
            weight: 70,
            id: 'tabset-preview',
            children: [
              {
                type: 'tab',
                id: PANEL_IDS.PREVIEW,
                name: 'プレビュー',
                component: PANEL_IDS.PREVIEW,
                enableClose: false,
              },
            ],
          },
          {
            type: 'tabset',
            weight: 30,
            id: 'tabset-timeline',
            children: [
              {
                type: 'tab',
                id: PANEL_IDS.TIMELINE,
                name: 'タイムライン',
                component: PANEL_IDS.TIMELINE,
                enableClose: false,
              },
            ],
          },
        ],
      },
      {
        type: 'row',
        weight: 30,
        children: [
          {
            type: 'tabset',
            weight: 60,
            id: 'tabset-properties',
            children: [
              {
                type: 'tab',
                id: PANEL_IDS.PROPERTIES,
                name: 'プロパティ',
                component: PANEL_IDS.PROPERTIES,
                enableClose: false,
              },
            ],
          },
          {
            type: 'tabset',
            weight: 40,
            id: 'tabset-easing',
            children: [
              {
                type: 'tab',
                id: PANEL_IDS.EASING,
                name: 'イージング',
                component: PANEL_IDS.EASING,
                enableClose: false,
              },
            ],
          },
        ],
      },
    ],
  },
};

/** FlexLayout Model (モジュールレベルで保持) */
let flexModel: Model = Model.fromJson(DEFAULT_LAYOUT);
flexModel.setSplitterSize(0);

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface UIState {
  /** 選択中のツール */
  activeTool: ToolType;
  /** メニューの開閉状態 */
  activeMenu: string | null;
  /** コンテキストメニュー */
  contextMenu: {
    show: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  };
  /** ビューポートのズーム（%） */
  viewportZoom: number;
  /** U: キーフレーム付きプロパティのみ表示 */
  showOnlyKeyframed: boolean;
  /** タイムラインで展開中のレイヤーID */
  expandedLayerIds: string[];

  /** 現在選択中のシェイプタイプ */
  activeShapeType: ShapeType;
  setActiveShapeType: (type: ShapeType) => void;

  setTool: (tool: ToolType) => void;
  setActiveMenu: (menu: string | null) => void;
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;
  setViewportZoom: (zoom: number) => void;
  setShowOnlyKeyframed: (v: boolean) => void;
  toggleExpandLayer: (id: string) => void;

  /** コンポジション設定ダイアログ */
  showCompSettings: boolean;
  setShowCompSettings: (v: boolean) => void;

  /** FlexLayout Model を取得 */
  getFlexModel: () => Model;
  /** レイアウトをデフォルトにリセット */
  resetLayout: () => void;
  /** パネルを開く（閉じていた場合） */
  openPanel: (panelId: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTool: 'select',
  activeShapeType: 'rectangle',
  activeMenu: null,
  contextMenu: { show: false, x: 0, y: 0, items: [] },
  viewportZoom: 50,
  showOnlyKeyframed: false,
  expandedLayerIds: [],
  showCompSettings: false,

  setTool: (tool) => set({ activeTool: tool }),
  setActiveShapeType: (type) => set({ activeShapeType: type }),
  setActiveMenu: (menu) => set({ activeMenu: menu }),

  showContextMenu: (x, y, items) =>
    set({ contextMenu: { show: true, x, y, items } }),
  hideContextMenu: () =>
    set((s) => ({ contextMenu: { ...s.contextMenu, show: false } })),

  setViewportZoom: (zoom) =>
    set({ viewportZoom: Math.max(10, Math.min(400, zoom)) }),

  setShowOnlyKeyframed: (v) => set({ showOnlyKeyframed: v }),

  toggleExpandLayer: (id) =>
    set((s) => ({
      expandedLayerIds: s.expandedLayerIds.includes(id)
        ? s.expandedLayerIds.filter((x) => x !== id)
        : [...s.expandedLayerIds, id],
    })),

  setShowCompSettings: (v) => set({ showCompSettings: v }),

  getFlexModel: () => flexModel,

  resetLayout: () => {
    flexModel = Model.fromJson(DEFAULT_LAYOUT);
    // ストアを更新して再レンダリングをトリガー
    set({});
  },

  openPanel: (panelId: string) => {
    // 既にモデル内にあるか確認
    const existing = flexModel.getNodeById(panelId);
    if (existing) return; // 既に表示中

    // パネルをデフォルトの場所に追加
    const targetTabset = panelId === PANEL_IDS.EASING ? 'tabset-properties' : 'tabset-preview';
    const label = PANEL_LABELS[panelId] || panelId;
    flexModel.doAction(
      Actions.addNode(
        {
          type: 'tab',
          id: panelId,
          name: label,
          component: panelId,
          enableClose: false,
        },
        targetTabset,
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    set({});
  },
}));
