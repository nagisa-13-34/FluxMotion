import { useEffect, useRef, useCallback } from 'react';
import { MenuBar } from './components/MenuBar/MenuBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Preview } from './components/Preview/Preview';
import { Timeline } from './components/Timeline/Timeline';
import { Properties } from './components/Properties/Properties';
import { EasingEditor } from './components/EasingEditor/EasingEditor';
import { ContextMenu } from './components/common/ContextMenu';
import { useTimelineStore } from './stores/timelineStore';
import { useProjectStore } from './stores/projectStore';
import { useUIStore } from './stores/uiStore';
import { useLayerStore } from './stores/layerStore';
import { AnimationLoop } from './stores/engine/animation';
import { EASING_PRESETS } from './types/keyframe';

export default function App() {
  const { isPlaying, togglePlay } = useTimelineStore();
  const settings = useProjectStore((s) => s.settings);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const hideContextMenu = useUIStore((s) => s.hideContextMenu);
  const animLoopRef = useRef<AnimationLoop | null>(null);
  const renderCallbackRef = useRef<(() => void) | null>(null);

  /** レンダーコールバックを外部から設定できるようにする */
  const setRenderCallback = useCallback((cb: () => void) => {
    renderCallbackRef.current = cb;
  }, []);

  // アニメーションループ管理
  useEffect(() => {
    const loop = new AnimationLoop(
      settings.fps,
      (_frame) => {
        renderCallbackRef.current?.();
      },
      () => useTimelineStore.getState().currentFrame,
      (frame) => useTimelineStore.getState().setCurrentFrame(frame),
      () => useProjectStore.getState().totalFrames(),
    );
    animLoopRef.current = loop;
    return () => loop.stop();
  }, [settings.fps]);

  // 再生/停止の同期
  useEffect(() => {
    const loop = animLoopRef.current;
    if (!loop) return;
    if (isPlaying) {
      loop.start();
    } else {
      loop.stop();
    }
  }, [isPlaying]);

  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // input/textarea の中では無視
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          useTimelineStore.getState().stepForward();
          renderCallbackRef.current?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          useTimelineStore.getState().stepBackward();
          renderCallbackRef.current?.();
          break;
        case 'Home':
          e.preventDefault();
          useTimelineStore.getState().goToStart();
          renderCallbackRef.current?.();
          break;
        case 'End':
          e.preventDefault();
          useTimelineStore.getState().goToEnd(totalFrames());
          renderCallbackRef.current?.();
          break;
      }

      // Ctrl/Cmd + キー
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              useLayerStore.getState().redo();
            } else {
              useLayerStore.getState().undo();
            }
            renderCallbackRef.current?.();
            break;
          case 'x':
            e.preventDefault();
            useLayerStore.getState().cutLayers();
            renderCallbackRef.current?.();
            break;
          case 'c':
            e.preventDefault();
            useLayerStore.getState().copyLayers();
            break;
          case 'v':
            e.preventDefault();
            useLayerStore.getState().pasteLayers();
            renderCallbackRef.current?.();
            break;
          case 'd':
            e.preventDefault();
            if (e.shiftKey) {
              // Ctrl+Shift+D: 分割
              useLayerStore.getState().splitLayer(
                useTimelineStore.getState().currentFrame
              );
            } else {
              // Ctrl+D: 複製
              useLayerStore.getState().duplicateSelected();
            }
            renderCallbackRef.current?.();
            break;
        }
        return;
      }

      // 修飾キーなしの単独キー
      switch (e.code) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          useLayerStore.getState().deleteSelected();
          renderCallbackRef.current?.();
          break;
        case 'KeyU': {
          // U: 選択レイヤーを展開 + キーフレーム付きプロパティのみ表示（AE準拠）
          const uiState = useUIStore.getState();
          const layerState = useLayerStore.getState();
          const selectedIds = layerState.selectedLayerIds;
          if (selectedIds.length === 0) break;

          // 全選択レイヤーが既に展開済み＆showOnlyKeyframedがオンなら → 折りたたむ
          const allExpanded = selectedIds.every(id => uiState.expandedLayerIds.includes(id));
          if (allExpanded && uiState.showOnlyKeyframed) {
            // 折りたたむ
            for (const id of selectedIds) {
              uiState.toggleExpandLayer(id);
            }
            uiState.setShowOnlyKeyframed(false);
          } else {
            // 展開してキーフレーム付きのみ表示
            uiState.setShowOnlyKeyframed(true);
            for (const id of selectedIds) {
              if (!uiState.expandedLayerIds.includes(id)) {
                uiState.toggleExpandLayer(id);
              }
            }
          }
          break;
        }
        case 'KeyI': {
          // I: 選択レイヤーの全トランスフォームに現在フレームのKFを一括追加
          e.preventDefault();
          const ls = useLayerStore.getState();
          const ts = useTimelineStore.getState();
          const selIds = ls.selectedLayerIds;
          if (selIds.length === 0) break;
          const props = ['anchorPoint', 'position', 'scale', 'rotation', 'opacity'];
          for (const id of selIds) {
            const layer = ls.layers.find(l => l.id === id);
            if (!layer) continue;
            for (const propKey of props) {
              const val = layer.transform[propKey as keyof typeof layer.transform];
              ls.addKeyframe(id, propKey, {
                time: ts.currentFrame,
                value: Array.isArray(val) ? [...val] : val as number,
                interpolation: 'bezier',
                bezierPoints: EASING_PRESETS.easeInOut,
              });
            }
          }
          renderCallbackRef.current?.();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, totalFrames]);
  const panels = useUIStore((s) => s.panels);
  const movePanel = useUIStore((s) => s.movePanel);
  const draggingPanelId = useUIStore((s) => s.draggingPanelId);
  const setDraggingPanel = useUIStore((s) => s.setDraggingPanel);
  const isEasingEditorOpen = useUIStore((s) => s.isEasingEditorOpen);
  const easingPanelHeight = useUIStore((s) => s.easingPanelHeight);
  const setEasingPanelHeight = useUIStore((s) => s.setEasingPanelHeight);
  const toggleEasingEditor = useUIStore((s) => s.toggleEasingEditor);

  // パネルIDからコンポーネントへのマップ（イージングは独立パネルに移動）
  const panelComponents: Record<string, React.JSX.Element> = {
    properties: <Properties />,
  };

  // パネルのドラッグ開始
  const handlePanelDragStart = (panelId: string) => {
    setDraggingPanel(panelId);
  };
  const handlePanelDragEnd = () => {
    setDraggingPanel(null);
  };
  const handlePanelDrop = (targetPanelId: string) => {
    if (!draggingPanelId || draggingPanelId === targetPanelId) return;
    // 位置を入れ替え
    const dragPanel = panels.find((p) => p.id === draggingPanelId);
    const targetPanel = panels.find((p) => p.id === targetPanelId);
    if (dragPanel && targetPanel) {
      movePanel(draggingPanelId, targetPanel.position);
      movePanel(targetPanelId, dragPanel.position);
    }
    setDraggingPanel(null);
  };

  // 右パネルの表示順（イージングは独立パネルなので除外）
  const rightTop = panels.filter((p) => p.position === 'right-top' && p.id !== 'easing');
  const rightBottom = panels.filter((p) => p.position === 'right-bottom' && p.id !== 'easing');

  const renderPanel = (panel: typeof panels[0]) => (
    <div
      key={panel.id}
      className={`panel-draggable${draggingPanelId === panel.id ? ' dragging' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => handlePanelDrop(panel.id)}
    >
      <div
        className="panel-drag-handle"
        draggable
        onDragStart={() => handlePanelDragStart(panel.id)}
        onDragEnd={handlePanelDragEnd}
        title="ドラッグで並べ替え"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
          <circle cx="8" cy="6" r="1.5" /><circle cx="16" cy="6" r="1.5" />
          <circle cx="8" cy="12" r="1.5" /><circle cx="16" cy="12" r="1.5" />
          <circle cx="8" cy="18" r="1.5" /><circle cx="16" cy="18" r="1.5" />
        </svg>
        <span>{panel.label}</span>
      </div>
      {panelComponents[panel.id]}
    </div>
  );

  // EasingEditorパネルのリサイズハンドル
  const handleEasingResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = easingPanelHeight;
    const onMove = (me: MouseEvent) => {
      setEasingPanelHeight(startH - (me.clientY - startY));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="app-layout" onClick={() => hideContextMenu()}>
      <MenuBar />
      <Toolbar />
      <Preview
        onRenderReady={setRenderCallback}
      />
      <div className="right-panels">
        {rightTop.map(renderPanel)}
        {rightBottom.map(renderPanel)}
      </div>
      <Timeline />
      {isEasingEditorOpen && (
        <div
          className="easing-panel-standalone"
          style={{
            height: easingPanelHeight,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            gridColumn: '2 / -1',
            background: 'var(--color-bg-panel)',
          }}
        >
          {/* リサイズハンドル */}
          <div
            className="easing-resize-handle"
            style={{
              height: 4,
              cursor: 'ns-resize',
              background: 'transparent',
              flexShrink: 0,
              position: 'relative',
            }}
            onMouseDown={handleEasingResize}
          >
            <div style={{
              position: 'absolute',
              top: 1,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 32,
              height: 2,
              borderRadius: 1,
              background: 'rgba(255, 255, 255, 0.15)',
            }} />
          </div>
          {/* 閉じるボタン付きヘッダーラッパー */}
          <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <button
              onClick={toggleEasingEditor}
              style={{
                position: 'absolute',
                top: 6,
                right: 36,
                zIndex: 10,
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-dim)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-xs)',
                fontSize: 14,
                lineHeight: 1,
              }}
              title="イージングエディターを閉じる"
            >
              ✕
            </button>
            <EasingEditor />
          </div>
        </div>
      )}
      <ContextMenu />
    </div>
  );
}
