import React, { useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';

export function ContextMenu() {
  const { show, x, y, items } = useUIStore((s) => s.contextMenu);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);
  const menuRef = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!show) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideContextMenu();
    };

    // 次のフレームでリスナーを追加（右クリックイベントが即座に発火するのを防ぐ）
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    });

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, hideContextMenu]);

  if (!show) return null;

  return (
    <div
      ref={menuRef}
      className="dropdown"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => {
        // separatorのみ（labelなし）の場合
        if (item.separator && !item.label) {
          return <div key={idx} className="dropdown-separator" />;
        }
        return (
          <React.Fragment key={idx}>
            <div
              className={`dropdown-item${item.disabled ? ' disabled' : ''}`}
              onClick={() => {
                if (!item.disabled) {
                  item.action();
                  hideContextMenu();
                }
              }}
              style={item.disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
            >
              {item.color && (
                <span style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: item.color,
                  marginRight: 6,
                  verticalAlign: 'middle',
                  border: '1px solid rgba(255,255,255,0.2)',
                }} />
              )}
              {item.label}
              {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
            </div>
            {item.separator && <div className="dropdown-separator" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
