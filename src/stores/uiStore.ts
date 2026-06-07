import { create } from 'zustand';

export type ToolType = 'select' | 'hand' | 'text' | 'shape' | 'pen';

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

  setTool: (tool: ToolType) => void;
  toggleProperties: () => void;
  setActiveMenu: (menu: string | null) => void;
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;
  setViewportZoom: (zoom: number) => void;
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

  setTool: (tool) => set({ activeTool: tool }),
  toggleProperties: () => set((s) => ({ showProperties: !s.showProperties })),
  setActiveMenu: (menu) => set({ activeMenu: menu }),

  showContextMenu: (x, y, items) =>
    set({ contextMenu: { show: true, x, y, items } }),
  hideContextMenu: () =>
    set((s) => ({ contextMenu: { ...s.contextMenu, show: false } })),

  setViewportZoom: (zoom) =>
    set({ viewportZoom: Math.max(10, Math.min(400, zoom)) }),
}));
