import { useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';

export function ToolOptionsBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const toolOptions = useUIStore((s) => s.toolOptions);
  const setToolOptions = useUIStore((s) => s.setToolOptions);
  const layers = useLayerStore((s) => s.layers);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const updateLayer = useLayerStore((s) => s.updateLayer);

  const isRelevantTool = activeTool === 'shape' || activeTool === 'pen' || activeTool === 'text';

  const handleFillChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fill = e.target.value;
    setToolOptions({ fill, fillOpacity: 100 });
    
    // Update selected layers
    selectedLayerIds.forEach(id => {
      const layer = layers.find(l => l.id === id);
      if (layer) {
        if (layer.type === 'shape' && layer.shapeData) {
          updateLayer(id, { shapeData: { ...layer.shapeData, fill, fillOpacity: 100 } });
        } else if (layer.type === 'text' && layer.textStyle) {
          updateLayer(id, { textStyle: { ...layer.textStyle, color: fill } });
        }
      }
    });
  }, [setToolOptions, selectedLayerIds, layers, updateLayer]);

  const toggleFillTransparent = useCallback(() => {
    const newOpacity = toolOptions.fillOpacity === 0 ? 100 : 0;
    setToolOptions({ fillOpacity: newOpacity });

    selectedLayerIds.forEach(id => {
      const layer = layers.find(l => l.id === id);
      if (layer) {
        if (layer.type === 'shape' && layer.shapeData) {
          updateLayer(id, { shapeData: { ...layer.shapeData, fillOpacity: newOpacity } });
        } else if (layer.type === 'text' && layer.textStyle) {
          // Text doesn't have fillOpacity, we can just skip or handle differently
        }
      }
    });
  }, [toolOptions.fillOpacity, setToolOptions, selectedLayerIds, layers, updateLayer]);

  const handleStrokeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const stroke = e.target.value;
    setToolOptions({ stroke });
    
    selectedLayerIds.forEach(id => {
      const layer = layers.find(l => l.id === id);
      if (layer) {
        if (layer.type === 'shape' && layer.shapeData) {
          updateLayer(id, { shapeData: { ...layer.shapeData, stroke } });
        } else if (layer.type === 'text' && layer.textStyle) {
          updateLayer(id, { textStyle: { ...layer.textStyle, strokeColor: stroke } });
        }
      }
    });
  }, [setToolOptions, selectedLayerIds, layers, updateLayer]);

  const handleStrokeWidthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const strokeWidth = Math.max(0, parseInt(e.target.value, 10) || 0);
    setToolOptions({ strokeWidth });
    
    selectedLayerIds.forEach(id => {
      const layer = layers.find(l => l.id === id);
      if (layer) {
        if (layer.type === 'shape' && layer.shapeData) {
          updateLayer(id, { shapeData: { ...layer.shapeData, strokeWidth } });
        } else if (layer.type === 'text' && layer.textStyle) {
          updateLayer(id, { textStyle: { ...layer.textStyle, strokeWidth } });
        }
      }
    });
  }, [setToolOptions, selectedLayerIds, layers, updateLayer]);

  const handleCreatesMaskToggle = useCallback(() => {
    setToolOptions({ createsMask: !toolOptions.createsMask });
  }, [toolOptions.createsMask, setToolOptions]);

  if (!isRelevantTool) return null;

  return (
    <div className="tool-options-bar">
      <div className="tool-option-group">
        <span className="tool-option-label">塗り</span>
        <div className="color-picker-wrapper">
          <input
            type="color"
            value={toolOptions.fillOpacity === 0 ? '#000000' : toolOptions.fill}
            onChange={handleFillChange}
            disabled={toolOptions.fillOpacity === 0}
            className="tool-color-swatch"
            title="塗りの色"
          />
          {toolOptions.fillOpacity === 0 && (
            <div className="transparent-strike" />
          )}
        </div>
        <button
          className={`tool-icon-btn ${toolOptions.fillOpacity === 0 ? 'active' : ''}`}
          onClick={toggleFillTransparent}
          title="透明にする"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <line x1="4" y1="4" x2="20" y2="20" />
            <circle cx="12" cy="12" r="9" strokeDasharray="4 4" />
          </svg>
        </button>
      </div>

      <div className="tool-option-group">
        <span className="tool-option-label">枠線</span>
        <div className="color-picker-wrapper">
          <input
            type="color"
            value={toolOptions.stroke === 'transparent' ? '#000000' : toolOptions.stroke}
            onChange={handleStrokeChange}
            disabled={toolOptions.stroke === 'transparent'}
            className="tool-color-swatch"
            title="枠線の色"
          />
          {toolOptions.stroke === 'transparent' && (
            <div className="transparent-strike" />
          )}
        </div>
        <button
          className={`tool-icon-btn ${toolOptions.stroke === 'transparent' ? 'active' : ''}`}
          onClick={() => handleStrokeChange({ target: { value: toolOptions.stroke === 'transparent' ? '#FFFFFF' : 'transparent' } } as any)}
          title="透明にする"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <line x1="4" y1="4" x2="20" y2="20" />
            <circle cx="12" cy="12" r="9" strokeDasharray="4 4" />
          </svg>
        </button>
        <input
          type="number"
          className="tool-number-input"
          value={toolOptions.strokeWidth}
          onChange={handleStrokeWidthChange}
          min="0"
          max="200"
          title="枠線サイズ"
          disabled={toolOptions.stroke === 'transparent'}
        />
        <span className="tool-option-unit">px</span>
      </div>

      {(activeTool === 'pen' || activeTool === 'shape') && (
        <>
          <div className="tool-separator" />
          <div className="tool-option-group">
            <button
              className={`tool-toggle-btn ${(!toolOptions.createsMask || selectedLayerIds.length === 0) ? 'active' : ''}`}
              onClick={() => toolOptions.createsMask && handleCreatesMaskToggle()}
              title="シェイプ作成"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
            <button
              className={`tool-toggle-btn ${(toolOptions.createsMask && selectedLayerIds.length > 0) ? 'active' : ''}`}
              onClick={() => selectedLayerIds.length > 0 && !toolOptions.createsMask && handleCreatesMaskToggle()}
              title={selectedLayerIds.length === 0 ? "マスクを作成するにはレイヤーを選択してください" : "マスク作成"}
              disabled={selectedLayerIds.length === 0}
              style={{
                opacity: selectedLayerIds.length === 0 ? 0.3 : 1,
                cursor: selectedLayerIds.length === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="12" cy="12" r="4" strokeDasharray="2 2" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
