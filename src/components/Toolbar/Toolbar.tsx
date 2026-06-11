import { useUIStore, type ToolType } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';
import { DraggablePanelHeader } from '../common/DraggablePanelHeader';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  /** クリックでレイヤーを自動追加するタイプ */
  createsLayer?: 'text' | 'shape' | 'solid';
  icon: React.JSX.Element;
}

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

export function Toolbar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);
  const addLayer = useLayerStore((s) => s.addLayer);

  const handleToolClick = (tool: ToolDef) => {
    setTool(tool.id);
    // テキスト・シェイプツールはクリックでレイヤーも追加する
    if (tool.createsLayer) {
      addLayer(tool.createsLayer);
    }
  };

  return (
    <div className="toolbar">
      <DraggablePanelHeader panelId="toolbar" className="toolbar-drag-handle">
        <span className="drag-grip">⋮⋮</span>
      </DraggablePanelHeader>
      {TOOLS.map((tool, idx) => {
        if (tool === 'separator') {
          return <div key={`sep-${idx}`} className="tool-separator" />;
        }
        return (
          <button
            key={tool.id}
            className={`tool-btn${activeTool === tool.id ? ' active' : ''}`}
            title={`${tool.label} (${tool.shortcut})`}
            onClick={() => handleToolClick(tool)}
          >
            {tool.icon}
          </button>
        );
      })}
    </div>
  );
}
