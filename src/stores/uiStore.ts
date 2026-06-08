import { create } from 'zustand';

export type ToolType = 'select' | 'hand' | 'text' | 'shape' | 'pen';

/** パネル配置 */
export type PanelPosition = 'left' | 'right-top' | 'right-bottom' | 'bottom';
export interface PanelLayout {
  id: string;
  label: string;
  position: PanelPosition;
}

const DEFAULT_PANELS: PanelLayout[] = [
  { id: 'properties', label: 'プロパティ', position: 'right-top' },
  { id: 'easing', label: 'イージング', position: 'right-bottom' },
];

interface UIState {
  /** 選択中のツール */
  activeTool: ToolType;
  /** プロパティパネルの表示 */
  showProperties: boolean;
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
  /** パネルレイアウト */
  panels: PanelLayout[];
  /** ドラッグ中のパネルID */
  draggingPanelId: string | null;
  /** イージングエディターパネルの開閉 */
  isEasingEditorOpen: boolean;
  /** イージングエディターパネルの高さ（px） */
  easingPanelHeight: number;

  setTool: (tool: ToolType) => void;
  toggleProperties: () => void;
  setActiveMenu: (menu: string | null) => void;
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;
  setViewportZoom: (zoom: number) => void;
  setShowOnlyKeyframed: (v: boolean) => void;
  toggleExpandLayer: (id: string) => void;
  movePanel: (panelId: string, newPosition: PanelPosition) => void;
  setDraggingPanel: (id: string | null) => void;
  toggleEasingEditor: () => void;
  setEasingPanelHeight: (h: number) => void;
}

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: boolean;
  disabled?: boolean;
}

export const useUIStore = create<UIState>((set) => ({
  activeTool: 'select',
  showProperties: true,
  activeMenu: null,
  contextMenu: { show: false, x: 0, y: 0, items: [] },
  viewportZoom: 50,
  showOnlyKeyframed: false,
  expandedLayerIds: [],
  panels: DEFAULT_PANELS,
  draggingPanelId: null,
  isEasingEditorOpen: false,
  easingPanelHeight: 260,

  setTool: (tool) => set({ activeTool: tool }),
  toggleProperties: () => set((s) => ({ showProperties: !s.showProperties })),
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

  movePanel: (panelId, newPosition) =>
    set((s) => ({
      panels: s.panels.map((p) =>
        p.id === panelId ? { ...p, position: newPosition } : p
      ),
    })),

  setDraggingPanel: (id) => set({ draggingPanelId: id }),

  toggleEasingEditor: () =>
    set((s) => ({ isEasingEditorOpen: !s.isEasingEditorOpen })),

  setEasingPanelHeight: (h) =>
    set({ easingPanelHeight: Math.max(180, Math.min(600, h)) }),
}));
