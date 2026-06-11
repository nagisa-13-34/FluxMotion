import React, { useContext } from 'react';
import { LayoutContext } from '../../App';
import { useUIStore } from '../../stores/uiStore';
import type { TabNode } from 'flexlayout-react';

interface DraggablePanelHeaderProps {
  panelId: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * FlexLayoutのタブD&Dをパネルヘッダーから開始可能にするラッパー。
 * panel-headerに draggable を付けて、onDragStartで
 * Layout.moveTabWithDragAndDrop を呼ぶ。
 */
export function DraggablePanelHeader({ panelId, children, className }: DraggablePanelHeaderProps) {
  const layoutRef = useContext(LayoutContext);
  const flexModel = useUIStore((s) => s.getFlexModel)();

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const layout = layoutRef.current;
    if (!layout || !flexModel) return;

    // モデルからTabNodeを検索
    const node = flexModel.getNodeById(panelId);
    if (!node) return;

    layout.moveTabWithDragAndDrop(e.nativeEvent, node as TabNode);
  };

  return (
    <div
      className={`panel-header ${className || ''}`}
      draggable
      onDragStart={handleDragStart}
    >
      {children}
    </div>
  );
}
