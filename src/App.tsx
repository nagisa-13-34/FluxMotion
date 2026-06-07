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

      // Ctrl+Z / Ctrl+Shift+Z (Undo/Redo)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useLayerStore.getState().redo();
        } else {
          useLayerStore.getState().undo();
        }
        renderCallbackRef.current?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, totalFrames]);

  return (
    <div className="app-layout" onClick={() => hideContextMenu()}>
      <MenuBar />
      <Toolbar />
      <Preview
        onRenderReady={setRenderCallback}
      />
      <div className="right-panels">
        <Properties />
        <EasingEditor />
      </div>
      <Timeline />
      <ContextMenu />
    </div>
  );
}
