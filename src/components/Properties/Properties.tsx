import type React from 'react';
import { useState, useCallback, useRef } from 'react';
import { useLayerStore } from '../../stores/layerStore';
import { useTimelineStore } from '../../stores/timelineStore';
import type { Keyframe } from '../../types/keyframe';
import { EASING_PRESETS } from '../../types/keyframe';
import { interpolateValue } from '../../stores/engine/keyframe';

/** トランスフォームのプロパティ定義 */
const TRANSFORM_PROPS = [
  { key: 'anchorPoint', label: 'アンカー', type: 'xy' as const },
  { key: 'position', label: '位置', type: 'xy' as const },
  { key: 'scale', label: 'スケール', type: 'xy' as const, suffix: '%' },
  { key: 'rotation', label: '回転', type: 'number' as const, suffix: '°' },
  { key: 'opacity', label: '不透明度', type: 'number' as const, suffix: '%', min: 0, max: 100 },
];

/** セレクトボックスの共通スタイル */
const selectStyle: React.CSSProperties = {
  background: 'var(--color-bg-input)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 4px',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-primary)',
  width: '100%',
};

export function Properties() {
  const layers = useLayerStore((s) => s.layers);
  const selectedLayerIds = useLayerStore((s) => s.selectedLayerIds);
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const updateTransform = useLayerStore((s) => s.updateTransform);
  const addKeyframe = useLayerStore((s) => s.addKeyframe);
  const removeKeyframe = useLayerStore((s) => s.removeKeyframe);
  const animations = useLayerStore((s) => s.animations);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    transform: true,
    text: true,
    shape: true,
    layer: true,
  });

  const selectedLayer = layers.find((l) => l.id === selectedLayerIds[0]);

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  /** キーフレームを追加するヘルパー */
  const handleAddKeyframe = useCallback(
    (propName: string, value: number | number[]) => {
      if (!selectedLayer) return;
      const kf: Keyframe = {
        time: currentFrame,
        value,
        interpolation: 'bezier',
        bezierPoints: EASING_PRESETS.easeInOut,
      };
      addKeyframe(selectedLayer.id, propName, kf);
    },
    [selectedLayer, currentFrame, addKeyframe]
  );

  /** プロパティにキーフレームがあるか */
  const hasKeyframe = (propName: string): boolean => {
    if (!selectedLayer) return false;
    const propAnim = animations[selectedLayer.id]?.[propName];
    return propAnim?.keyframes.some((kf) => kf.time === currentFrame) || false;
  };

  /** プロパティにKFが1つでもあるか（ストップウォッチ状態） */
  const isAnimated = (propName: string): boolean => {
    if (!selectedLayer) return false;
    const propAnim = animations[selectedLayer.id]?.[propName];
    return (propAnim?.keyframes.length ?? 0) > 0;
  };

  /** 前のKF時間を取得 */
  const getPrevKfTime = (propName: string): number | null => {
    if (!selectedLayer) return null;
    const kfs = animations[selectedLayer.id]?.[propName]?.keyframes;
    if (!kfs) return null;
    const prev = kfs.filter(kf => kf.time < currentFrame).sort((a, b) => b.time - a.time);
    return prev.length > 0 ? prev[0].time : null;
  };

  /** 次のKF時間を取得 */
  const getNextKfTime = (propName: string): number | null => {
    if (!selectedLayer) return null;
    const kfs = animations[selectedLayer.id]?.[propName]?.keyframes;
    if (!kfs) return null;
    const next = kfs.filter(kf => kf.time > currentFrame).sort((a, b) => a.time - b.time);
    return next.length > 0 ? next[0].time : null;
  };

  const setCurrentFrame = useTimelineStore.getState().setCurrentFrame;

  /** ドラッグスクラブ用ref */
  const dragRef = useRef<{ startX: number; startVal: number; step: number; min?: number; max?: number } | null>(null);

  /** ラベルをドラッグしてスクラブ */
  const handleDragStart = (
    e: React.MouseEvent,
    currentVal: number,
    onChange: (v: number) => void,
    opts?: { step?: number; min?: number; max?: number },
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const step = opts?.step ?? 1;
    dragRef.current = { startX, startVal: currentVal, step, min: opts?.min, max: opts?.max };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      let newVal = dragRef.current.startVal + dx * dragRef.current.step * 0.5;
      if (dragRef.current.min !== undefined) newVal = Math.max(dragRef.current.min, newVal);
      if (dragRef.current.max !== undefined) newVal = Math.min(dragRef.current.max, newVal);
      // stepで丸める
      newVal = Math.round(newVal / step) * step;
      onChange(newVal);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** キーフレーム補間を考慮した値を返す */
  const getResolvedValue = (propName: string): number | number[] | undefined => {
    if (!selectedLayer) return undefined;
    const propAnim = animations[selectedLayer.id]?.[propName];
    if (!propAnim || propAnim.keyframes.length === 0) return undefined;
    return interpolateValue(propAnim, currentFrame) ?? undefined;
  };

  /** トランスフォームの表示値を取得（KF補間 > デフォルト） */
  const getDisplayValue = (propKey: string, defaultValue: number | [number, number]): number | [number, number] => {
    const resolved = getResolvedValue(propKey);
    if (resolved !== undefined) return resolved as any;
    return defaultValue;
  };

  /** 数値プロパティの表示値を取得（汎用） */
  const getDisplayNumeric = (propKey: string, defaultValue: number): number => {
    const resolved = getResolvedValue(propKey);
    if (resolved !== undefined && typeof resolved === 'number') return resolved;
    return defaultValue;
  };

  /** 値変更時、KFが有効なプロパティなら自動でKF更新 */
  const handleValueChange = (propKey: string, value: number | [number, number]) => {
    if (!selectedLayer) return;
    updateTransform(selectedLayer.id, propKey, value);
    // KFが有効なプロパティなら現在フレームのKFも更新
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
  };

  /** テキストプロパティ変更（KF自動更新対応） */
  const handleTextValueChange = (field: string, propKey: string, value: number) => {
    if (!selectedLayer?.textStyle) return;
    updateLayer(selectedLayer.id, {
      textStyle: { ...selectedLayer.textStyle, [field]: value },
    });
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
  };

  /** シェイププロパティ変更（KF自動更新対応） */
  const handleShapeValueChange = (field: string, propKey: string, value: number) => {
    if (!selectedLayer?.shapeData) return;
    updateLayer(selectedLayer.id, {
      shapeData: { ...selectedLayer.shapeData, [field]: value },
    });
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
  };

  /** KFボタン付き数値プロパティ行（ナビ矢印+ドラッグスクラブ対応） */
  const renderKfNumericRow = (
    propKey: string,
    label: string,
    value: number,
    onChange: (v: number) => void,
    opts?: { min?: number; max?: number; step?: number; suffix?: string },
  ) => {
    const hasKf = hasKeyframe(propKey);
    const animated = isAnimated(propKey);
    const display = getDisplayNumeric(propKey, value);
    const prevTime = animated ? getPrevKfTime(propKey) : null;
    const nextTime = animated ? getNextKfTime(propKey) : null;
    return (
      <div key={propKey} className="prop-row prop-row-kf">
        <div className="prop-kf-controls">
          {animated && (
            <button
              className={`prop-kf-nav${prevTime !== null ? '' : ' disabled'}`}
              onClick={() => prevTime !== null && setCurrentFrame(prevTime)}
              title="前のキーフレーム"
            >
              <svg viewBox="0 0 10 12" width="8" height="10"><path d="M8 6L2 2L2 10Z" fill="currentColor" /></svg>
            </button>
          )}
          <button
            className={`prop-keyframe-btn${hasKf ? ' has-keyframe' : ''}${animated ? ' animated' : ''}`}
            onClick={() => {
              if (hasKf) {
                removeKeyframe(selectedLayer!.id, propKey, currentFrame);
              } else {
                handleAddKeyframe(propKey, display);
              }
            }}
            title={hasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
          >
            <svg viewBox="0 0 14 14" width="12" height="12">
              <circle cx="7" cy="8" r="4.5"
                fill={hasKf ? 'var(--color-keyframe)' : 'none'}
                stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.2"
              />
              <line x1="7" y1="8" x2="7" y2="5.5" stroke={hasKf ? '#fff' : 'currentColor'} strokeWidth="1" />
              <line x1="5" y1="2.5" x2="9" y2="2.5" stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1" />
            </svg>
          </button>
          {animated && (
            <button
              className={`prop-kf-nav${nextTime !== null ? '' : ' disabled'}`}
              onClick={() => nextTime !== null && setCurrentFrame(nextTime)}
              title="次のキーフレーム"
            >
              <svg viewBox="0 0 10 12" width="8" height="10"><path d="M2 6L8 2L8 10Z" fill="currentColor" /></svg>
            </button>
          )}
        </div>
        <span
          className={`prop-label scrub${animated ? ' animated' : ''}`}
          onMouseDown={(e) => handleDragStart(e, display, onChange, opts)}
          title="ドラッグで値を変更"
        >{label}</span>
        <div className="prop-value">
          <input
            type="number"
            value={Math.round(display * 100) / 100}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            readOnly
            onMouseDown={(e) => {
              if (!(e.currentTarget as HTMLInputElement).readOnly) return;
              handleDragStart(e, display, onChange, opts);
            }}
            onDoubleClick={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              el.readOnly = false;
              el.focus();
              el.select();
            }}
            onBlur={(e) => { (e.currentTarget as HTMLInputElement).readOnly = true; }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            min={opts?.min}
            max={opts?.max}
            step={opts?.step ?? 1}
          />
          {opts?.suffix && (
            <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>
              {opts.suffix}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (!selectedLayer) {
    return (
      <div className="properties">
        <div className="panel-header">
          <svg className="panel-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          プロパティ
        </div>
        <div className="panel-content">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l16 16M20 4L4 20" />
            </svg>
            <p>レイヤーを選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="properties">
      <div className="panel-header">
        プロパティ: {selectedLayer.name}
        <span style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: 'var(--font-size-sm)', opacity: 0.5 }}>≡</span>
      </div>
      <div className="panel-content">

        {/* トランスフォーム */}
        <div className="prop-group">
          <div
            className="prop-group-header"
            onClick={() => toggleGroup('transform')}
          >
            <svg className={`chevron${openGroups.transform ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            レイヤートランスフォーム
            <span className="reset-btn" onClick={(e) => {
              e.stopPropagation();
              updateTransform(selectedLayer.id, 'anchorPoint', [0, 0]);
              updateTransform(selectedLayer.id, 'position', [960, 540]);
              updateTransform(selectedLayer.id, 'scale', [100, 100]);
              updateTransform(selectedLayer.id, 'rotation', 0);
              updateTransform(selectedLayer.id, 'opacity', 100);
            }}>リセット</span>
          </div>
          {openGroups.transform && (
            <>
              {TRANSFORM_PROPS.map((prop) => {
                const rawValue = selectedLayer.transform[prop.key as keyof typeof selectedLayer.transform];
                const hasKf = hasKeyframe(prop.key);
                const animated = isAnimated(prop.key);
                const prevTime = animated ? getPrevKfTime(prop.key) : null;
                const nextTime = animated ? getNextKfTime(prop.key) : null;

                const kfControls = (
                  <div className="prop-kf-controls">
                    {animated && (
                      <button className={`prop-kf-nav${prevTime !== null ? '' : ' disabled'}`}
                        onClick={() => prevTime !== null && setCurrentFrame(prevTime)} title="前のキーフレーム">
                        <svg viewBox="0 0 10 12" width="8" height="10"><path d="M8 6L2 2L2 10Z" fill="currentColor" /></svg>
                      </button>
                    )}
                    <button
                      className={`prop-keyframe-btn${hasKf ? ' has-keyframe' : ''}${animated ? ' animated' : ''}`}
                      onClick={() => {
                        if (hasKf) { removeKeyframe(selectedLayer.id, prop.key, currentFrame); }
                        else {
                          const v = prop.type === 'xy'
                            ? (getDisplayValue(prop.key, rawValue as [number, number]) as [number, number])
                            : (getDisplayValue(prop.key, rawValue as number) as number);
                          handleAddKeyframe(prop.key, v);
                        }
                      }}
                      title={hasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12">
                        <circle cx="7" cy="8" r="4.5" fill={hasKf ? 'var(--color-keyframe)' : 'none'}
                          stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.2" />
                        <line x1="7" y1="8" x2="7" y2="5.5" stroke={hasKf ? '#fff' : 'currentColor'} strokeWidth="1" />
                        <line x1="5" y1="2.5" x2="9" y2="2.5" stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1" />
                      </svg>
                    </button>
                    {animated && (
                      <button className={`prop-kf-nav${nextTime !== null ? '' : ' disabled'}`}
                        onClick={() => nextTime !== null && setCurrentFrame(nextTime)} title="次のキーフレーム">
                        <svg viewBox="0 0 10 12" width="8" height="10"><path d="M2 6L8 2L8 10Z" fill="currentColor" /></svg>
                      </button>
                    )}
                  </div>
                );

                if (prop.type === 'xy') {
                  const defaultArr = rawValue as [number, number];
                  const displayArr = getDisplayValue(prop.key, defaultArr) as [number, number];
                  return (
                    <div key={prop.key} className="prop-row prop-row-kf">
                      {kfControls}
                      <span
                        className={`prop-label scrub${animated ? ' animated' : ''}`}
                        onMouseDown={(e) => handleDragStart(e, displayArr[0], (v) => handleValueChange(prop.key, [v, displayArr[1]]), { step: prop.key === 'scale' ? 1 : 0.5 })}
                        title="ドラッグで値を変更"
                      >{prop.label}</span>
                      <div className="prop-value">
                        <input type="number" value={Math.round(displayArr[0] * 10) / 10}
                          onChange={(e) => handleValueChange(prop.key, [parseFloat(e.target.value) || 0, displayArr[1]])}
                          readOnly
                          onMouseDown={(e) => { if (!(e.currentTarget as HTMLInputElement).readOnly) return; handleDragStart(e, displayArr[0], (v) => handleValueChange(prop.key, [v, displayArr[1]]), { step: prop.key === 'scale' ? 1 : 0.5 }); }}
                          onDoubleClick={(e) => { const el = e.currentTarget; el.readOnly = false; el.focus(); el.select(); }}
                          onBlur={(e) => { e.currentTarget.readOnly = true; }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          step={prop.key === 'scale' ? 1 : 0.5} style={{ width: '50%' }} />
                        <input type="number" value={Math.round(displayArr[1] * 10) / 10}
                          onChange={(e) => handleValueChange(prop.key, [displayArr[0], parseFloat(e.target.value) || 0])}
                          readOnly
                          onMouseDown={(e) => { if (!(e.currentTarget as HTMLInputElement).readOnly) return; handleDragStart(e, displayArr[1], (v) => handleValueChange(prop.key, [displayArr[0], v]), { step: prop.key === 'scale' ? 1 : 0.5 }); }}
                          onDoubleClick={(e) => { const el = e.currentTarget; el.readOnly = false; el.focus(); el.select(); }}
                          onBlur={(e) => { e.currentTarget.readOnly = true; }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          step={prop.key === 'scale' ? 1 : 0.5} style={{ width: '50%' }} />
                      </div>
                    </div>
                  );
                }

                const defaultNum = rawValue as number;
                const displayNum = getDisplayValue(prop.key, defaultNum) as number;
                return (
                  <div key={prop.key} className="prop-row prop-row-kf">
                    {kfControls}
                    <span
                      className={`prop-label scrub${animated ? ' animated' : ''}`}
                      onMouseDown={(e) => handleDragStart(e, displayNum, (v) => handleValueChange(prop.key, v), { step: prop.key === 'rotation' ? 1 : 0.5, min: prop.min, max: prop.max })}
                      title="ドラッグで値を変更"
                    >{prop.label}</span>
                    <div className="prop-value">
                      <input type="number" value={Math.round(displayNum * 10) / 10}
                        onChange={(e) => handleValueChange(prop.key, parseFloat(e.target.value) || 0)}
                        readOnly
                        onMouseDown={(e) => { if (!(e.currentTarget as HTMLInputElement).readOnly) return; handleDragStart(e, displayNum, (v) => handleValueChange(prop.key, v), { step: prop.key === 'rotation' ? 1 : 0.5, min: prop.min, max: prop.max }); }}
                        onDoubleClick={(e) => { const el = e.currentTarget; el.readOnly = false; el.focus(); el.select(); }}
                        onBlur={(e) => { e.currentTarget.readOnly = true; }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        min={prop.min} max={prop.max} step={prop.key === 'rotation' ? 1 : 0.5} />
                      {prop.suffix && (
                        <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>{prop.suffix}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* テキスト固有プロパティ */}
        {selectedLayer.type === 'text' && selectedLayer.textStyle && (
          <div className="prop-group">
            <div
              className="prop-group-header"
              onClick={() => toggleGroup('text')}
            >
              <svg className={`chevron${openGroups.text ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6l6 6-6 6V6z" />
              </svg>
              テキスト
            </div>
            {openGroups.text && (
              <>
                {/* フォントファミリー */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">フォント</span>
                  <div className="prop-value">
                    <input
                      type="text"
                      value={selectedLayer.textStyle.fontFamily}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, fontFamily: e.target.value },
                        })
                      }
                      style={{ width: '100%' }}
                      list="font-list"
                    />
                    <datalist id="font-list">
                      <option value="Inter" />
                      <option value="Roboto" />
                      <option value="Noto Sans JP" />
                      <option value="Arial" />
                      <option value="Helvetica" />
                      <option value="Georgia" />
                      <option value="Times New Roman" />
                      <option value="monospace" />
                    </datalist>
                  </div>
                </div>
                {/* フォントサイズ */}
                {renderKfNumericRow(
                  'text.fontSize', 'サイズ',
                  selectedLayer.textStyle.fontSize,
                  (v) => handleTextValueChange('fontSize', 'text.fontSize', v),
                  { min: 1, step: 1, suffix: 'px' },
                )}
                {/* フォントウェイト */}
                {renderKfNumericRow(
                  'text.fontWeight', '太さ',
                  selectedLayer.textStyle.fontWeight,
                  (v) => handleTextValueChange('fontWeight', 'text.fontWeight', v),
                  { min: 100, max: 900, step: 100 },
                )}
                {/* 文字色 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">色</span>
                  <div className="prop-value">
                    <input
                      type="color"
                      value={selectedLayer.textStyle.color}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, color: e.target.value },
                        })
                      }
                      className="color-swatch"
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLayer.textStyle.color}
                    </span>
                  </div>
                </div>
                {/* 行間 */}
                {renderKfNumericRow(
                  'text.lineHeight', '行間',
                  selectedLayer.textStyle.lineHeight,
                  (v) => handleTextValueChange('lineHeight', 'text.lineHeight', v),
                  { min: 0.5, max: 5, step: 0.1 },
                )}
                {/* 文字間隔 */}
                {renderKfNumericRow(
                  'text.letterSpacing', '文字間隔',
                  selectedLayer.textStyle.letterSpacing,
                  (v) => handleTextValueChange('letterSpacing', 'text.letterSpacing', v),
                  { step: 0.5, suffix: 'px' },
                )}
                {/* テキスト揃え */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">揃え</span>
                  <div className="prop-value" style={{ gap: 2 }}>
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() =>
                          updateLayer(selectedLayer.id, {
                            textStyle: { ...selectedLayer.textStyle!, textAlign: align },
                          })
                        }
                        style={{
                          flex: 1,
                          padding: '3px',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-xs)',
                          background: selectedLayer.textStyle!.textAlign === align ? 'var(--color-accent-light)' : 'var(--color-bg-input)',
                          color: selectedLayer.textStyle!.textAlign === align ? 'var(--color-accent)' : 'var(--color-text-muted)',
                          cursor: 'pointer',
                          fontSize: 'var(--font-size-xxs)',
                          fontWeight: 600,
                        }}
                        title={align === 'left' ? '左揃え' : align === 'center' ? '中央揃え' : '右揃え'}
                      >
                        {align === 'left' ? '◁' : align === 'center' ? '◇' : '▷'}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ソリッド固有プロパティ */}
        {selectedLayer.type === 'solid' && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('shape')}>
              <svg className={`chevron${openGroups.shape ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6l6 6-6 6V6z" />
              </svg>
              ソリッド
            </div>
            {openGroups.shape && (
              <div className="prop-row">
                <div />
                <span className="prop-label">色</span>
                <div className="prop-value">
                  <input
                    type="color"
                    value={selectedLayer.solidColor || '#6C5CE7'}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { solidColor: e.target.value })
                    }
                    className="color-swatch"
                  />
                  <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {selectedLayer.solidColor || '#6C5CE7'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* シェイプ固有プロパティ */}
        {selectedLayer.type === 'shape' && selectedLayer.shapeData && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('shape')}>
              <svg className={`chevron${openGroups.shape ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6l6 6-6 6V6z" />
              </svg>
              シェイプ
            </div>
            {openGroups.shape && (
              <>
                {/* シェイプタイプ */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">タイプ</span>
                  <div className="prop-value">
                    <select
                      value={selectedLayer.shapeData.shapeType}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, shapeType: e.target.value as any },
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="rectangle">矩形</option>
                      <option value="ellipse">楕円</option>
                      <option value="star">★ 星</option>
                    </select>
                  </div>
                </div>
                {/* 塗り色 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">塗り</span>
                  <div className="prop-value">
                    <input
                      type="color"
                      value={selectedLayer.shapeData.fill}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, fill: e.target.value },
                        })
                      }
                      className="color-swatch"
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLayer.shapeData.fill}
                    </span>
                  </div>
                </div>
                {/* 塗り不透明度 */}
                {renderKfNumericRow(
                  'shape.fillOpacity', '塗り不透明度',
                  selectedLayer.shapeData.fillOpacity ?? 100,
                  (v) => handleShapeValueChange('fillOpacity', 'shape.fillOpacity', v),
                  { min: 0, max: 100, step: 1, suffix: '%' },
                )}
                {/* 線色 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">線色</span>
                  <div className="prop-value">
                    <input
                      type="color"
                      value={selectedLayer.shapeData.stroke === 'transparent' ? '#000000' : selectedLayer.shapeData.stroke}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, stroke: e.target.value },
                        })
                      }
                      className="color-swatch"
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLayer.shapeData.stroke}
                    </span>
                  </div>
                </div>
                {/* 線幅 */}
                {renderKfNumericRow(
                  'shape.strokeWidth', '線幅',
                  selectedLayer.shapeData.strokeWidth,
                  (v) => handleShapeValueChange('strokeWidth', 'shape.strokeWidth', v),
                  { min: 0, step: 0.5, suffix: 'px' },
                )}
                {/* 線端 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">線端</span>
                  <div className="prop-value">
                    <select
                      value={selectedLayer.shapeData.strokeLineCap ?? 'butt'}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, strokeLineCap: e.target.value as any },
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="butt">Butt</option>
                      <option value="round">Round</option>
                      <option value="square">Square</option>
                    </select>
                  </div>
                </div>
                {/* 角丸（矩形のみ） */}
                {selectedLayer.shapeData.shapeType === 'rectangle' &&
                  renderKfNumericRow(
                    'shape.cornerRadius', '角丸',
                    selectedLayer.shapeData.cornerRadius ?? 0,
                    (v) => handleShapeValueChange('cornerRadius', 'shape.cornerRadius', v),
                    { min: 0, step: 1, suffix: 'px' },
                  )
                }
              </>
            )}
          </div>
        )}

        {/* レイヤー共通プロパティ */}
        <div className="prop-group">
          <div className="prop-group-header" onClick={() => toggleGroup('layer')}>
            <svg className={`chevron${openGroups.layer ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            レイヤー
          </div>
          {openGroups.layer && (
            <>
              {/* ブレンドモード */}
              <div className="prop-row">
                <div />
                <span className="prop-label">ブレンド</span>
                <div className="prop-value">
                  <select
                    value={selectedLayer.blendMode}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { blendMode: e.target.value as any })
                    }
                    style={selectStyle}
                  >
                    <option value="normal">通常</option>
                    <option value="multiply">乗算</option>
                    <option value="screen">スクリーン</option>
                    <option value="overlay">オーバーレイ</option>
                    <option value="add">加算</option>
                    <option value="darken">比較（暗）</option>
                    <option value="lighten">比較（明）</option>
                  </select>
                </div>
              </div>
              {/* 親レイヤー */}
              <div className="prop-row">
                <div />
                <span className="prop-label">親</span>
                <div className="prop-value">
                  <select
                    value={selectedLayer.parentId || ''}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { parentId: e.target.value || null })
                    }
                    style={selectStyle}
                  >
                    <option value="">なし</option>
                    {layers
                      .filter((l) => l.id !== selectedLayer.id)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
