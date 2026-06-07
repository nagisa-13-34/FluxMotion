import { useUIStore } from '../../stores/uiStore';

export function ContextMenu() {
  const { show, x, y, items } = useUIStore((s) => s.contextMenu);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);

  if (!show) return null;

  return (
    <div
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
        if (item.separator) {
          return <div key={idx} className="dropdown-separator" />;
        }
        return (
          <div
            key={idx}
            className={`dropdown-item${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                hideContextMenu();
              }
            }}
            style={item.disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
          >
            {item.label}
            {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}
