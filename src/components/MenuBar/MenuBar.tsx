import { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useTimelineStore } from '../../stores/timelineStore';
import { useUIStore } from '../../stores/uiStore';
import { useLayerStore } from '../../stores/layerStore';
import { useHistoryStore } from '../../stores/historyStore';
import { downloadProject, openProjectPicker } from '../../stores/engine/projectIO';
import { RESOLUTION_PRESETS, FPS_PRESETS } from '../../types/project';

const MENUS = ['ファイル', '編集', 'コンポジション', 'レイヤー', 'エフェクト', '表示', 'ヘルプ'];

export function MenuBar() {
  const settings = useProjectStore((s) => s.settings);
  const currentFrame = useTimelineStore((s) => s.currentFrame);
  const activeMenu = useUIStore((s) => s.activeMenu);
  const setActiveMenu = useUIStore((s) => s.setActiveMenu);
  const addLayer = useLayerStore((s) => s.addLayer);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const resetProject = useProjectStore((s) => s.resetProject);

  // コンポジション設定ダイアログ
  const showCompDialog = useUIStore((s) => s.showCompSettings);
  const setShowCompDialog = useUIStore((s) => s.setShowCompSettings);
  const [compForm, setCompForm] = useState({
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    duration: settings.duration,
    backgroundColor: settings.backgroundColor,
    name: settings.name,
  });

  const openCompDialog = () => {
    setCompForm({
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      duration: settings.duration,
      backgroundColor: settings.backgroundColor,
      name: settings.name,
    });
    setShowCompDialog(true);
    setActiveMenu(null);
  };

  const applyCompSettings = () => {
    updateSettings(compForm);
    setShowCompDialog(false);
  };

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

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!activeMenu) return;
    const handleClickOutside = () => setActiveMenu(null);
    // 少し遅延させてメニュー自体のクリックイベントが先に処理されるようにする
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [activeMenu, setActiveMenu]);

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
                  <div className="dropdown-item" onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*,video/*';
                    input.multiple = true;
                    input.onchange = () => {
                      if (!input.files) return;
                      useLayerStore.getState().saveSnapshot();
                      for (const file of Array.from(input.files)) {
                        const url = URL.createObjectURL(file);
                        const isVideo = file.type.startsWith('video/');
                        addLayer(isVideo ? 'video' : 'image', {
                          mediaSource: url,
                          name: file.name.replace(/\.[^.]+$/, ''),
                        });
                      }
                      setActiveMenu(null);
                    };
                    input.click();
                  }}>
                    メディアをインポート <span className="shortcut">Ctrl+I</span>
                  </div>
                  <div className="dropdown-separator" />
                  <div className="dropdown-item" onClick={() => {
                    // 現在のフレームをPNGで書き出し
                    const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement;
                    if (!canvas) return;
                    const link = document.createElement('a');
                    link.download = `frame_${useTimelineStore.getState().currentFrame}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                    setActiveMenu(null);
                  }}>
                    フレームをPNGで書き出し <span className="shortcut">Ctrl+Shift+E</span>
                  </div>
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
                  <div className="dropdown-item" onClick={() => { useLayerStore.getState().cutLayers(); setActiveMenu(null); }}>
                    カット <span className="shortcut">Ctrl+X</span>
                  </div>
                  <div className="dropdown-item" onClick={() => { useLayerStore.getState().copyLayers(); setActiveMenu(null); }}>
                    コピー <span className="shortcut">Ctrl+C</span>
                  </div>
                  <div className="dropdown-item" onClick={() => { useLayerStore.getState().pasteLayers(); setActiveMenu(null); }}>
                    ペースト <span className="shortcut">Ctrl+V</span>
                  </div>
                  <div className="dropdown-separator" />
                  <div className="dropdown-item" onClick={() => { useLayerStore.getState().duplicateSelected(); setActiveMenu(null); }}>
                    複製 <span className="shortcut">Ctrl+D</span>
                  </div>
                  <div className="dropdown-item" onClick={() => { useLayerStore.getState().deleteSelected(); setActiveMenu(null); }}>
                    削除 <span className="shortcut">Del</span>
                  </div>
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
              {menu === 'コンポジション' && (
                <>
                  <div className="dropdown-item" onClick={openCompDialog}>
                    コンポジション設定 <span className="shortcut">Ctrl+K</span>
                  </div>
                </>
              )}
              {(menu !== 'ファイル' && menu !== 'レイヤー' && menu !== '編集' && menu !== '表示' && menu !== 'コンポジション') && (
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
      {/* コンポジション設定ダイアログ */}
      {showCompDialog && (
        <div className="comp-dialog-overlay" onClick={() => setShowCompDialog(false)}>
          <div className="comp-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="comp-dialog-header">
              <span>コンポジション設定</span>
              <button className="comp-dialog-close" onClick={() => setShowCompDialog(false)}>×</button>
            </div>
            <div className="comp-dialog-body">
              <div className="comp-field">
                <label>プロジェクト名</label>
                <input type="text" value={compForm.name}
                  onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} />
              </div>
              <div className="comp-field">
                <label>プリセット</label>
                <select onChange={(e) => {
                  const preset = RESOLUTION_PRESETS[e.target.value as keyof typeof RESOLUTION_PRESETS];
                  if (preset) setCompForm({ ...compForm, width: preset.width, height: preset.height });
                }} value={
                  Object.entries(RESOLUTION_PRESETS).find(
                    ([, v]) => v.width === compForm.width && v.height === compForm.height
                  )?.[0] || ''
                }>
                  <option value="">カスタム</option>
                  {Object.entries(RESOLUTION_PRESETS).map(([name, v]) => (
                    <option key={name} value={name}>{name} ({v.width}×{v.height})</option>
                  ))}
                </select>
              </div>
              <div className="comp-field-row">
                <div className="comp-field">
                  <label>幅</label>
                  <input type="number" value={compForm.width} min={1}
                    onChange={(e) => setCompForm({ ...compForm, width: parseInt(e.target.value) || 1 })} />
                </div>
                <span className="comp-times">×</span>
                <div className="comp-field">
                  <label>高さ</label>
                  <input type="number" value={compForm.height} min={1}
                    onChange={(e) => setCompForm({ ...compForm, height: parseInt(e.target.value) || 1 })} />
                </div>
              </div>
              <div className="comp-field-row">
                <div className="comp-field">
                  <label>FPS</label>
                  <select value={FPS_PRESETS.includes(compForm.fps as any) ? compForm.fps : 'custom'}
                    onChange={(e) => {
                      if (e.target.value !== 'custom') setCompForm({ ...compForm, fps: parseFloat(e.target.value) });
                    }}>
                    {FPS_PRESETS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                    {!FPS_PRESETS.includes(compForm.fps as any) && (
                      <option value="custom">{compForm.fps} (カスタム)</option>
                    )}
                  </select>
                </div>
                <div className="comp-field">
                  <label>デュレーション(秒)</label>
                  <input type="number" value={compForm.duration} min={1} step={1}
                    onChange={(e) => setCompForm({ ...compForm, duration: parseFloat(e.target.value) || 1 })} />
                </div>
              </div>
              <div className="comp-field">
                <label>背景色</label>
                <div className="comp-color-row">
                  <input type="color" value={compForm.backgroundColor}
                    onChange={(e) => setCompForm({ ...compForm, backgroundColor: e.target.value })} />
                  <span>{compForm.backgroundColor}</span>
                </div>
              </div>
            </div>
            <div className="comp-dialog-footer">
              <button className="comp-btn-cancel" onClick={() => setShowCompDialog(false)}>キャンセル</button>
              <button className="comp-btn-ok" onClick={applyCompSettings}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
