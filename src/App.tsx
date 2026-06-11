import { useEffect, useRef, useCallback } from 'react';
import { Layout, Actions } from 'flexlayout-react';
import type { TabNode, TabSetNode, BorderNode, Model, Action } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';

import { MenuBar } from './components/MenuBar/MenuBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Preview } from './components/Preview/Preview';
import { Timeline } from './components/Timeline/Timeline';
import { Properties } from './components/Properties/Properties';
import { EasingEditor } from './components/EasingEditor/EasingEditor';
import { ContextMenu } from './components/common/ContextMenu';
import { useTimelineStore } from './stores/timelineStore';
import { useProjectStore } from './stores/projectStore';
import { useUIStore, PANEL_IDS } from './stores/uiStore';
import { useLayerStore } from './stores/layerStore';
import { useHistoryStore } from './stores/historyStore';
import { AnimationLoop } from './stores/engine/animation';
import { EASING_PRESETS } from './types/keyframe';
import { downloadProject, openProjectPicker } from './stores/engine/projectIO';

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

  // FlexLayout Model
  const flexModel = useUIStore((s) => s.getFlexModel)();

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
              useLayerStore.getState().splitLayer(
                useTimelineStore.getState().currentFrame
              );
            } else {
              useLayerStore.getState().duplicateSelected();
            }
            renderCallbackRef.current?.();
            break;
          case 'k':
            e.preventDefault();
            useUIStore.getState().setShowCompSettings(true);
            break;
          case 's': {
            e.preventDefault();
            const s = useProjectStore.getState().settings;
            const ls = useLayerStore.getState();
            downloadProject(s, ls.layers, ls.animations);
            break;
          }
          case 'o': {
            e.preventDefault();
            (async () => {
              const data = await openProjectPicker();
              if (data) {
                useProjectStore.getState().updateSettings(data.settings);
                useLayerStore.setState({ layers: data.layers, animations: data.animations, selectedLayerIds: [] });
                useTimelineStore.getState().setCurrentFrame(0);
                useHistoryStore.getState().clearHistory();
              }
            })();
            break;
          }
          case 'n':
            e.preventDefault();
            useLayerStore.getState().saveSnapshot();
            useProjectStore.getState().resetProject();
            useLayerStore.setState({ layers: [], animations: {}, selectedLayerIds: [] });
            useTimelineStore.getState().setCurrentFrame(0);
            useHistoryStore.getState().clearHistory();
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
          const uiState = useUIStore.getState();
          const layerState = useLayerStore.getState();
          const selectedIds = layerState.selectedLayerIds;
          if (selectedIds.length === 0) break;

          const allExpanded = selectedIds.every(id => uiState.expandedLayerIds.includes(id));
          if (allExpanded && uiState.showOnlyKeyframed) {
            for (const id of selectedIds) {
              uiState.toggleExpandLayer(id);
            }
            uiState.setShowOnlyKeyframed(false);
          } else {
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

  /** FlexLayout ファクトリー: パネルIDに応じたコンポーネントを返す */
  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    switch (component) {
      case PANEL_IDS.PREVIEW:
        return <Preview onRenderReady={setRenderCallback} />;
      case PANEL_IDS.TIMELINE:
        return <Timeline />;
      case PANEL_IDS.PROPERTIES:
        return <Properties />;
      case PANEL_IDS.EASING:
        return <EasingEditor />;
      case PANEL_IDS.TOOLBAR:
        return <Toolbar />;
      default:
        return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>Unknown: {component}</div>;
    }
  }, [setRenderCallback]);

  /** パネルタブの右クリックメニュー */
  const onContextMenu = useCallback((node: TabNode | TabSetNode | BorderNode, event: React.MouseEvent<HTMLElement, MouseEvent>) => {
    event.preventDefault();
    event.stopPropagation();

    // タブノードの場合のみメニュー表示
    if (node.getType() === 'tab') {
      const tabNode = node as TabNode;
      const panelId = tabNode.getId();
      const items = [
        {
          label: 'パネルを閉じる',
          action: () => {
            flexModel.doAction(Actions.deleteTab(panelId));
          },
        },
      ];
      useUIStore.getState().showContextMenu(event.clientX, event.clientY, items);
    }
  }, [flexModel]);

  /** モデル変更後に空タブセットを自動削除 */
  const onModelChange = useCallback((model: Model, _action: Action) => {
    // 全アクション後に空タブセット掃除（枠が残らないように）
    requestAnimationFrame(() => {
      const emptyTabsets: string[] = [];
      model.visitNodes((node) => {
        if (node.getType() === 'tabset') {
          const tabset = node as TabSetNode;
          if (tabset.getChildren().length === 0) {
            emptyTabsets.push(tabset.getId());
          }
        }
      });
      for (const id of emptyTabsets) {
        try {
          model.doAction(Actions.deleteTabset(id));
        } catch {
          // 既に削除済みの場合は無視
        }
      }
    });
  }, []);

  return (
    <div className="app-shell" onClick={() => hideContextMenu()}>
      <MenuBar />
      <div className="dock-container">
        <Layout
          model={flexModel}
          factory={factory}
          onContextMenu={onContextMenu}
          onModelChange={onModelChange}
          realtimeResize={true}
        />
      </div>
      <ContextMenu />
    </div>
  );
}
