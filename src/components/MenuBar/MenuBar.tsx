import { useProjectStore } from '../../stores/projectStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';
import { useHistoryStore } from '../../stores/historyStore';
import { downloadProject, openProjectPicker } from '../../stores/engine/projectIO';

const MENUS = ['ファイル', '編集', 'コンポジション', 'レイヤー', 'エフェクト', '表示', 'ヘルプ'];

export function MenuBar() {
  const settings = useProjectStore((s) => s.settings);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const activeMenu = useUIStore((s) => s.activeMenu);
  const setActiveMenu = useUIStore((s) => s.setActiveMenu);
  const addLayer = useLayerStore((s) => s.addLayer);
  const resetProject = useProjectStore((s) => s.resetProject);

  const formatTime = (frame: number) => {
    const totalSeconds = frame / settings.fps;
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const frames = frame % Math.round(settings.fps);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  };

  const handleMenuClick = (menu: string) => {
    if (activeMenu === menu) {
      setActiveMenu(null);
    } else {
      setActiveMenu(menu);
    }
  };

  const handleSave = () => {
    const layerState = useLayerStore.getState();
    downloadProject(settings, layerState.layers, layerState.animations);
    setActiveMenu(null);
  };

  const handleOpen = async () => {
    const data = await openProjectPicker();
    if (data) {
      useProjectStore.getState().updateSettings(data.settings);
      // layers と animations を直接セット
      useLayerStore.setState({
        layers: data.layers,
        animations: data.animations,
        selectedLayerIds: [],
      });
      useTimelineStore.getState().setCurrentFrame(0);
      useHistoryStore.getState().clearHistory();
    }
    setActiveMenu(null);
  };

  const handleNewProject = () => {
    useLayerStore.getState().saveSnapshot();
    resetProject();
    useLayerStore.setState({ layers: [], animations: {}, selectedLayerIds: [] });
    useTimelineStore.getState().setCurrentFrame(0);
    useHistoryStore.getState().clearHistory();
    setActiveMenu(null);
  };

  const handleAddLayer = (type: Parameters<typeof addLayer>[0]) => {
    useLayerStore.getState().saveSnapshot();
    addLayer(type);
    setActiveMenu(null);
  };

  const handleUndo = () => {
    useLayerStore.getState().undo();
    setActiveMenu(null);
  };

  const handleRedo = () => {
    useLayerStore.getState().redo();
    setActiveMenu(null);
  };

  return (
    <div className="menubar">
      <div className="menubar-logo">
        <svg viewBox="0 0 64 64" fill="none">
          <defs>
            <linearGradient id="logo-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6C5CE7"/>
              <stop offset="100%" stopColor="#00CEC9"/>
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#logo-grad)"/>
          <path d="M22 18 L44 32 L22 46Z" fill="white" opacity="0.95"/>
        </svg>
        <span>FluxMotion</span>
      </div>

      {MENUS.map((menu) => (
        <div key={menu} className="menu-item-wrapper" style={{ position: 'relative' }}>
          <div
            className={`menu-item${activeMenu === menu ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleMenuClick(menu); }}
            onMouseEnter={() => { if (activeMenu) setActiveMenu(menu); }}
          >
            {menu}
          </div>
          {activeMenu === menu && (
            <div className="dropdown" style={{ top: '100%', left: 0 }} onClick={(e) => e.stopPropagation()}>
              {menu === 'ファイル' && (
                <>
                  <div className="dropdown-item" onClick={handleNewProject}>
                    新規プロジェクト <span className="shortcut">Ctrl+N</span>
                  </div>
                  <div className="dropdown-separator" />
                  <div className="dropdown-item" onClick={handleOpen}>
                    プロジェクトを開く <span className="shortcut">Ctrl+O</span>
                  </div>
                  <div className="dropdown-item" onClick={handleSave}>
                    保存 <span className="shortcut">Ctrl+S</span>
                  </div>
                  <div className="dropdown-separator" />
                  <div className="dropdown-item disabled">書き出し <span className="shortcut">Ctrl+Shift+E</span></div>
                </>
              )}
              {menu === 'レイヤー' && (
                <>
                  <div className="dropdown-item" onClick={() => handleAddLayer('solid')}>
                    新規ソリッドレイヤー
                  </div>
                  <div className="dropdown-item" onClick={() => handleAddLayer('text')}>
                    新規テキストレイヤー
                  </div>
                  <div className="dropdown-item" onClick={() => handleAddLayer('shape')}>
                    新規シェイプレイヤー
                  </div>
                  <div className="dropdown-item" onClick={() => handleAddLayer('null')}>
                    新規ヌルレイヤー
                  </div>
                  <div className="dropdown-item" onClick={() => handleAddLayer('adjustment')}>
                    新規調整レイヤー
                  </div>
                </>
              )}
              {menu === '編集' && (
                <>
                  <div
                    className={`dropdown-item${!useHistoryStore.getState().canUndo() ? ' disabled' : ''}`}
                    onClick={handleUndo}
                  >
                    元に戻す <span className="shortcut">Ctrl+Z</span>
                  </div>
                  <div
                    className={`dropdown-item${!useHistoryStore.getState().canRedo() ? ' disabled' : ''}`}
                    onClick={handleRedo}
                  >
                    やり直し <span className="shortcut">Ctrl+Shift+Z</span>
                  </div>
                  <div className="dropdown-separator" />
                  <div className="dropdown-item disabled">カット <span className="shortcut">Ctrl+X</span></div>
                  <div className="dropdown-item disabled">コピー <span className="shortcut">Ctrl+C</span></div>
                  <div className="dropdown-item disabled">ペースト <span className="shortcut">Ctrl+V</span></div>
                </>
              )}
              {menu === '表示' && (
                <>
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      useUIStore.getState().openPanel('preview');
                      setActiveMenu(null);
                    }}
                  >
                    プレビュー
                  </div>
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      useUIStore.getState().openPanel('timeline');
                      setActiveMenu(null);
                    }}
                  >
                    タイムライン
                  </div>
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      useUIStore.getState().openPanel('properties');
                      setActiveMenu(null);
                    }}
                  >
                    プロパティ
                  </div>
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      useUIStore.getState().openPanel('easing');
                      setActiveMenu(null);
                    }}
                  >
                    イージングエディター
                  </div>
                  <div className="dropdown-separator" />
                  <div
                    className="dropdown-item"
                    onClick={() => {
                      useUIStore.getState().resetLayout();
                      setActiveMenu(null);
                    }}
                  >
                    レイアウトをリセット
                  </div>
                </>
              )}
              {(menu !== 'ファイル' && menu !== 'レイヤー' && menu !== '編集' && menu !== '表示') && (
                <div className="dropdown-item disabled" style={{ color: 'var(--color-text-dim)' }}>
                  Coming soon...
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="menubar-spacer" />

      <div className="menubar-info">
        <span>{settings.width}×{settings.height}</span>
        <span>{settings.fps}fps</span>
        <span>{formatTime(currentFrame)}</span>
      </div>
    </div>
  );
}
