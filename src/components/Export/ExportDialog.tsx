import { useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLayerStore } from '../../stores/layerStore';
import { exportVideo } from '../../stores/engine/exporter';

// #region agent log
const debugExportDialogLog = (hypothesisId: string, message: string, data: Record<string, unknown> = {}) => {
  fetch('/__debug_ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '262bcc',
    },
    body: JSON.stringify({
      sessionId: '262bcc',
      runId: 'pre-fix',
      hypothesisId,
      location: 'components/Export/ExportDialog.tsx',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

export function ExportDialog() {
  const show = useUIStore(s => s.showExportDialog);
  const setShow = useUIStore(s => s.setShowExportDialog);
  const settings = useProjectStore(s => s.settings);
  const layers = useLayerStore(s => s.layers);
  const animations = useLayerStore(s => s.animations);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!show) return null;

  const handleExport = async () => {
    debugExportDialogLog('H1', 'handleExport clicked', {
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      duration: settings.duration,
      layerCount: layers.length,
    });

    setIsExporting(true);
    setProgress(0);
    setError(null);

    try {
      const blob = await exportVideo(settings, layers, animations, (p) => {
        setProgress(p);
        debugExportDialogLog('H5', 'progress callback', { progress: p });
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${settings.name || 'fluxmotion_export'}.mp4`;
      a.click();
      URL.revokeObjectURL(url);

      debugExportDialogLog('H1', 'export completed, triggering download', {
        fileName: `${settings.name || 'fluxmotion_export'}.mp4`,
      });
      setShow(false);
    } catch (e: any) {
      setError(e.message || 'エクスポート中にエラーが発生しました');
      debugExportDialogLog('H3', 'exportVideo threw in dialog', {
        error: e?.message ?? String(e),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="comp-settings-overlay">
      <div className="comp-settings-dialog">
        <h2 className="comp-settings-title">動画を書き出し (MP4)</h2>

        <div className="comp-settings-form">
          <div className="comp-settings-row">
            <span className="comp-settings-label">解像度</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
              {settings.width} × {settings.height}
            </span>
          </div>
          <div className="comp-settings-row">
            <span className="comp-settings-label">フレームレート</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
              {settings.fps} fps
            </span>
          </div>
          <div className="comp-settings-row">
            <span className="comp-settings-label">長さ</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
              {settings.duration} 秒
            </span>
          </div>

          {error && (
            <div style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-xs)', marginTop: 8 }}>
              {error}
            </div>
          )}

          {isExporting && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--font-size-xs)' }}>
                <span>書き出し中...</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div style={{ width: '100%', height: 8, background: 'var(--color-bg-darker)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress * 100}%`, background: 'var(--color-accent)', transition: 'width 0.1s' }} />
              </div>
            </div>
          )}
        </div>

        <div className="comp-settings-actions">
          <button
            className="comp-settings-cancel"
            onClick={() => setShow(false)}
            disabled={isExporting}
          >
            キャンセル
          </button>
          <button
            className="comp-settings-submit"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? '処理中...' : '書き出す'}
          </button>
        </div>
      </div>
    </div>
  );
}
