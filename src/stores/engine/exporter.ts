import * as Muxer from 'mp4-muxer';
import { Renderer } from './renderer';
import type { Layer } from '../../types/layer';
import type { ProjectSettings } from '../../types/project';
import type { AnimatedProperty } from '../../types/keyframe';

// #region agent log
const debugExportLog = (hypothesisId: string, message: string, data: Record<string, unknown> = {}) => {
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
      location: 'stores/engine/exporter.ts',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

export async function exportVideo(
  settings: ProjectSettings,
  layers: Layer[],
  animations: Record<string, Record<string, AnimatedProperty>>,
  onProgress: (progress: number) => void
): Promise<Blob> {
  debugExportLog('H1', 'exportVideo called', {
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    duration: settings.duration,
    layerCount: layers.length,
  });

  const { width, height, fps } = settings;
  let canvas: OffscreenCanvas;
  try {
    canvas = new OffscreenCanvas(width, height);
  } catch (e) {
    debugExportLog('H2', 'OffscreenCanvas creation failed', {
      error: (e as Error).message,
    });
    throw e;
  }
  const renderer = new Renderer(canvas as any as HTMLCanvasElement, width, height);
  renderer.backgroundColor = settings.backgroundColor;
  renderer.fps = fps;

  const muxer = new Muxer.Muxer({
    target: new Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

  let error: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      error = e;
      debugExportLog('H3', 'VideoEncoder error callback', {
        error: (e as Error).message,
      });
    },
  });

  try {
    videoEncoder.configure({
      codec: 'avc1.42E01F', // H.264 baseline profile
      width,
      height,
      bitrate: 8_000_000,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
    });
    debugExportLog('H3', 'VideoEncoder configured', { width, height, fps });
  } catch (e) {
    debugExportLog('H3', 'VideoEncoder.configure threw', {
      error: (e as Error).message,
    });
    throw e;
  }

  const totalFrames = Math.floor(settings.duration * fps);
  const frameDuration = 1000000 / fps; // in microseconds

  for (let frame = 0; frame <= totalFrames; frame++) {
    if (error) break;

    // 1フレームをレンダリング
    renderer.renderFrame(layers, frame, animations);

    // VideoFrameを作成
    const videoFrame = new VideoFrame(canvas, {
      timestamp: frame * frameDuration,
      duration: frameDuration,
    });

    // 2秒に1回キーフレームを挿入
    const keyFrame = frame % (Math.round(fps) * 2) === 0;
    try {
      videoEncoder.encode(videoFrame, { keyFrame });
    } catch (e) {
      debugExportLog('H4', 'VideoEncoder.encode threw', {
        frame,
        error: (e as Error).message,
      });
      videoFrame.close();
      throw e;
    }
    videoFrame.close();

    // UIをブロックしないように非同期で少し待つ
    if (frame % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      debugExportLog('H5', 'export progress', {
        frame,
        totalFrames,
        progress: frame / totalFrames,
      });
    }

    onProgress(frame / totalFrames);
  }

  // エンコーダーのフラッシュを待つ
  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  if (error) {
    debugExportLog('H3', 'exportVideo finished with encoder error', {
      error: error.message,
    });
    throw error;
  }

  const { buffer } = muxer.target as Muxer.ArrayBufferTarget;
  debugExportLog('H1', 'exportVideo succeeded', {
    totalFrames,
    bufferBytes: buffer.byteLength,
  });
  return new Blob([buffer], { type: 'video/mp4' });
}
