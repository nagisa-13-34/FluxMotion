import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, type ToolType } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  /** クリックでレイヤーを自動追加するタイプ */
  createsLayer?: 'text' | 'solid';
  icon: React.JSX.Element;
  /** 長押しで表示するサブツール */
  subTools?: SubToolDef[];
}

interface SubToolDef {
  label: string;
  shapeType?: string;
  penType?: string;
  icon: React.JSX.Element;
}

/** シェイプのサブツール定義 */
const SHAPE_SUB_TOOLS: SubToolDef[] = [
  {
    label: '長方形',
    shapeType: 'rectangle',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  {
    label: '楕円形',
    shapeType: 'ellipse',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="10" ry="8" />
      </svg>
    ),
  },
  {
    label: '星形',
    shapeType: 'star',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
];

/** ペンツールのサブツール定義 */
const PEN_SUB_TOOLS: SubToolDef[] = [
  {
    label: 'ペンツール',
    penType: 'normal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    label: '頂点削除ツール',
    penType: 'remove',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <line x1="2" y1="2" x2="10" y2="10" stroke="#ff4757" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    label: '頂点切り替えツール',
    penType: 'convert',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 14l8-10 8 10" />
        <line x1="4" y1="14" x2="20" y2="14" strokeDasharray="2 2" />
      </svg>
    ),
  },
];

const TOOLS: (ToolDef | 'separator')[] = [
  {
    id: 'select',
    label: '選択ツール',
    shortcut: 'V',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4L10 20L13 13L20 10L4 4Z" />
      </svg>
    ),
  },
  {
    id: 'hand',
    label: '手のひらツール',
    shortcut: 'H',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v6M10 10V5a2 2 0 0 0-4 0v9" />
        <path d="M18 11a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8V9" />
      </svg>
    ),
  },
  'separator',
  {
    id: 'text',
    label: 'テキスト追加',
    shortcut: 'T',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7V4h16v3M9 20h6M12 4v16" />
      </svg>
    ),
  },
  {
    id: 'shape',
    label: 'シェイプ追加',
    shortcut: 'Q',
    subTools: SHAPE_SUB_TOOLS,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  'separator',
  {
    id: 'pen',
    label: 'ペンツール',
    shortcut: 'G',
    subTools: PEN_SUB_TOOLS,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
];

/** 長押し検出のディレイ (ms) */
const LONG_PRESS_DELAY = 400;

export function Toolbar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);
  const activeShapeType = useUIStore((s) => s.activeShapeType);
  const setActiveShapeType = useUIStore((s) => s.setActiveShapeType);
  const activePenType = useUIStore((s) => s.activePenType);
  const setActivePenType = useUIStore((s) => s.setActivePenType);
  const addLayer = useLayerStore((s) => s.addLayer);

  // サブメニュー表示状態
  const [subMenuToolId, setSubMenuToolId] = useState<string | null>(null);
  // 長押しタイマー
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  // ボタン要素のref（Portal位置計算用）
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // サブメニュー外クリックで閉じる
  useEffect(() => {
    if (!subMenuToolId) return;
    const handleClick = () => setSubMenuToolId(null);
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [subMenuToolId]);

  const handleToolClick = useCallback((tool: ToolDef) => {
    setTool(tool.id);
    if (tool.createsLayer) {
      if (tool.createsLayer === 'text') {
        const toolOptions = useUIStore.getState().toolOptions;
        addLayer('text', {
          textStyle: {
            text: 'Text Layer',
            fontFamily: 'Inter',
            fontSize: 64,
            fontWeight: 400,
            color: toolOptions.fill,
            strokeColor: toolOptions.stroke,
            strokeWidth: toolOptions.strokeWidth,
            textAlign: 'center',
            letterSpacing: 0,
            lineHeight: 1.2
          }
        });
      } else {
        addLayer(tool.createsLayer);
      }
    }
  }, [setTool, addLayer]);

  const handleMouseDown = useCallback((tool: ToolDef) => {
    didLongPress.current = false;
    if (tool.subTools && tool.subTools.length > 0) {
      longPressTimer.current = setTimeout(() => {
        didLongPress.current = true;
        setSubMenuToolId(tool.id);
      }, LONG_PRESS_DELAY);
    }
  }, []);

  const handleMouseUp = useCallback((tool: ToolDef) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // 長押しでなかった場合は通常クリック
    if (!didLongPress.current) {
      handleToolClick(tool);
    }
  }, [handleToolClick]);

  const handleMouseLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    didLongPress.current = false;
  }, []);

  const handleSubToolClick = useCallback((tool: ToolDef, sub: SubToolDef) => {
    if (sub.shapeType) {
      setActiveShapeType(sub.shapeType as any);
    } else if (sub.penType) {
      setActivePenType(sub.penType as any);
    }
    setTool(tool.id);
    setSubMenuToolId(null);
  }, [setTool, setActiveShapeType, setActivePenType]);

  // 現在のシェイプタイプに応じたアイコン
  const getShapeIcon = useCallback(() => {
    const sub = SHAPE_SUB_TOOLS.find(s => s.shapeType === activeShapeType);
    return sub?.icon || SHAPE_SUB_TOOLS[0].icon;
  }, [activeShapeType]);

  // 現在のペンタイプに応じたアイコン
  const getPenIcon = useCallback(() => {
    const sub = PEN_SUB_TOOLS.find(s => s.penType === activePenType);
    return sub?.icon || PEN_SUB_TOOLS[0].icon;
  }, [activePenType]);

  return (
    <div className="toolbar">
      {TOOLS.map((tool, idx) => {
        if (tool === 'separator') {
          return <div key={`sep-${idx}`} className="tool-separator" />;
        }

        const isShapeTool = tool.id === 'shape';
        const isPenTool = tool.id === 'pen';
        const icon = isShapeTool ? getShapeIcon() : (isPenTool ? getPenIcon() : tool.icon);
        const hasSubTools = !!(tool.subTools && tool.subTools.length > 0);

        return (
          <div key={tool.id} className="tool-btn-wrapper">
            <button
              ref={(el) => { btnRefs.current[tool.id] = el; }}
              className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
              title={`${tool.label} (${tool.shortcut})`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleMouseDown(tool);
              }}
              onMouseUp={() => handleMouseUp(tool)}
              onMouseLeave={handleMouseLeave}
            >
              {icon}
              {/* サブツールがあるインジケーター（右下の小さい三角） */}
              {hasSubTools && (
                <span className="subtool-indicator" />
              )}
            </button>

            {/* サブメニュー (Portalでbodyに描画) */}
            {subMenuToolId === tool.id && tool.subTools && (() => {
              const btnEl = btnRefs.current[tool.id];
              if (!btnEl) return null;
              const rect = btnEl.getBoundingClientRect();
              return createPortal(
                <div
                  className="subtool-menu"
                  style={{ position: 'fixed', left: rect.right + 2, top: rect.top }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {tool.subTools.map((sub) => {
                    const isActive = sub.shapeType ? activeShapeType === sub.shapeType : activePenType === sub.penType;
                    return (
                      <button
                        key={sub.shapeType || sub.penType}
                        className={`subtool-item${isActive ? ' active' : ''}`}
                        title={sub.label}
                        onClick={() => handleSubToolClick(tool, sub)}
                      >
                        {sub.icon}
                        <span className="subtool-label">{sub.label}</span>
                      </button>
                    );
                  })}
                </div>,
                document.body
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
