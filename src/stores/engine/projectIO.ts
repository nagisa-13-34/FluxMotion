/**
 * プロジェクトのJSON保存/読み込み
 */
import type { ProjectSettings } from '../../types/project';
import type { Layer } from '../../types/layer';
import type { AnimatedProperty } from '../../types/keyframe';

interface ProjectFile {
  version: 1;
  app: 'FluxMotion';
  settings: ProjectSettings;
  layers: Layer[];
  animations: Record<string, Record<string, AnimatedProperty>>;
}

/** プロジェクトをJSONとしてシリアライズ */
export function serializeProject(
  settings: ProjectSettings,
  layers: Layer[],
  animations: Record<string, Record<string, AnimatedProperty>>,
): string {
  const project: ProjectFile = {
    version: 1,
    app: 'FluxMotion',
    settings,
    layers,
    animations,
  };
  return JSON.stringify(project, null, 2);
}

/** JSONからプロジェクトをデシリアライズ */
export function deserializeProject(json: string): ProjectFile | null {
  try {
    const data = JSON.parse(json);
    if (data.app !== 'FluxMotion' || !data.version) return null;
    return data as ProjectFile;
  } catch {
    return null;
  }
}

/** プロジェクトをファイルとしてダウンロード */
export function downloadProject(
  settings: ProjectSettings,
  layers: Layer[],
  animations: Record<string, Record<string, AnimatedProperty>>,
) {
  const json = serializeProject(settings, layers, animations);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${settings.name || 'project'}.fmproj`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** ファイルピッカーからプロジェクトを読み込み */
export function openProjectPicker(): Promise<ProjectFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fmproj,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const text = await file.text();
      resolve(deserializeProject(text));
    };
    input.click();
  });
}
