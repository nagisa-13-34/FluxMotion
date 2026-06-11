import { useState, useRef, useCallback, useEffect } from 'react';
import { useUIStore, type ToolType } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';
import type { ShapeType } from '../../types/layer';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  /** クリックでレイヤーを自動追加するタイプ */
  createsLayer?: 'text' | 'shape' | 'solid';
  icon: React.JSX.Element;
  /** 長押しで表示するサブツール */
  subTools?: SubToolDef[];
}

interface SubToolDef {
  label: string;
  shapeType: ShapeType;
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
    createsLayer: 'text',
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
    createsLayer: 'shape',
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
  const addLayer = useLayerStore((s) => s.addLayer);

  // 現在選択中のシェイプタイプ（アイコンに反映）
  const [activeShapeType, setActiveShapeType] = useState<ShapeType>('rectangle');
  // サブメニュー表示状態
  const [subMenuToolId, setSubMenuToolId] = useState<string | null>(null);
  // 長押しタイマー
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  // サブメニュー外クリックで閉じる
  useEffect(() => {
    if (!subMenuToolId) return;
    const handleClick = () => setSubMenuToolId(null);
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [subMenuToolId]);

  const handleToolClick = useCallback((tool: ToolDef) => {
    setTool(tool.id);
    if (tool.createsLayer === 'shape') {
      addLayer('shape', {
        shapeData: {
          shapeType: activeShapeType,
          fill: '#A29BFE',
          fillOpacity: 100,
          stroke: 'transparent',
          strokeWidth: 0,
          strokeLineCap: 'butt',
          cornerRadius: 0,
        },
      });
    } else if (tool.createsLayer) {
      addLayer(tool.createsLayer);
    }
  }, [setTool, addLayer, activeShapeType]);

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
  }, []);

  const handleSubToolClick = useCallback((tool: ToolDef, sub: SubToolDef) => {
    setActiveShapeType(sub.shapeType);
    setTool(tool.id);
    addLayer('shape', {
      shapeData: {
        shapeType: sub.shapeType,
        fill: '#A29BFE',
        fillOpacity: 100,
        stroke: 'transparent',
        strokeWidth: 0,
        strokeLineCap: 'butt',
        cornerRadius: 0,
      },
    });
    setSubMenuToolId(null);
  }, [setTool, addLayer]);

  // 現在のシェイプタイプに応じたアイコン
  const getShapeIcon = useCallback(() => {
    const sub = SHAPE_SUB_TOOLS.find(s => s.shapeType === activeShapeType);
    return sub?.icon || SHAPE_SUB_TOOLS[0].icon;
  }, [activeShapeType]);

  return (
    <div className="toolbar">
      {TOOLS.map((tool, idx) => {
        if (tool === 'separator') {
          return <div key={`sep-${idx}`} className="tool-separator" />;
        }

        const isShapeTool = tool.id === 'shape';
        const icon = isShapeTool ? getShapeIcon() : tool.icon;
        const hasSubTools = !!(tool.subTools && tool.subTools.length > 0);

        return (
          <div key={tool.id} className="tool-btn-wrapper">
            <button
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

            {/* サブメニュー */}
            {subMenuToolId === tool.id && tool.subTools && (
              <div
                className="subtool-menu"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {tool.subTools.map((sub) => (
                  <button
                    key={sub.shapeType}
                    className={`subtool-item${activeShapeType === sub.shapeType ? ' active' : ''}`}
                    title={sub.label}
                    onClick={() => handleSubToolClick(tool, sub)}
                  >
                    {sub.icon}
                    <span className="subtool-label">{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
