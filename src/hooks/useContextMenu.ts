import { useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import type { ContextMenuItem } from '../stores/uiStore';

export function useContextMenu() {
  const showContextMenu = useUIStore((s) => s.showContextMenu);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);

  const handleContextMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, items);
  }, [showContextMenu]);

  return {
    show: handleContextMenu,
    hide: hideContextMenu,
  };
}
