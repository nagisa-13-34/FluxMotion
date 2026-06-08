import type React from 'react';
import { useState, useCallback } from 'react';
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

  /** 値変更時、KFが有効なプロパティなら自動でKF更新 */
  const handleValueChange = (propKey: string, value: number | [number, number]) => {
    if (!selectedLayer) return;
    updateTransform(selectedLayer.id, propKey, value);
    // KFが有効なプロパティなら現在フレームのKFも更新
    if (isAnimated(propKey)) {
      handleAddKeyframe(propKey, value);
    }
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
        <svg className="panel-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        プロパティ
        <span style={{
          fontSize: 'var(--font-size-xxs)',
          color: 'var(--color-text-muted)',
          marginLeft: 'auto',
        }}>
          {selectedLayer.name}
        </span>
      </div>
      <div className="panel-content">
        {/* レイヤー基本情報 */}
        <div className="prop-group">
          <div
            className="prop-group-header"
            onClick={() => toggleGroup('layer')}
          >
            <svg className={`chevron${openGroups.layer ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            レイヤー
          </div>
          {openGroups.layer && (
            <>
              <div className="prop-row">
                <div />
                <span className="prop-label">名前</span>
                <div className="prop-value">
                  <input
                    type="text"
                    value={selectedLayer.name}
                    onChange={(e) => updateLayer(selectedLayer.id, { name: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <div className="prop-row">
                <div />
                <span className="prop-label">ブレンド</span>
                <div className="prop-value">
                  <select
                    value={selectedLayer.blendMode}
                    onChange={(e) =>
                      useLayerStore.getState().setBlendMode(
                        selectedLayer.id,
                        e.target.value as any
                      )
                    }
                    style={{
                      background: 'var(--color-bg-input)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 4px',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-primary)',
                      width: '100%',
                    }}
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
            </>
          )}
        </div>

        {/* トランスフォーム */}
        <div className="prop-group">
          <div
            className="prop-group-header"
            onClick={() => toggleGroup('transform')}
          >
            <svg className={`chevron${openGroups.transform ? ' open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            トランスフォーム
          </div>
          {openGroups.transform && (
            <>
              {TRANSFORM_PROPS.map((prop) => {
                const rawValue = selectedLayer.transform[prop.key as keyof typeof selectedLayer.transform];
                const hasKf = hasKeyframe(prop.key);
                const animated = isAnimated(prop.key);

                if (prop.type === 'xy') {
                  const defaultArr = rawValue as [number, number];
                  const displayArr = getDisplayValue(prop.key, defaultArr) as [number, number];
                  return (
                    <div key={prop.key} className="prop-row">
                      <button
                        className={`prop-keyframe-btn${hasKf ? ' has-keyframe' : ''}${animated ? ' animated' : ''}`}
                        onClick={() => {
                          if (hasKf) {
                            removeKeyframe(selectedLayer.id, prop.key, currentFrame);
                          } else {
                            handleAddKeyframe(prop.key, displayArr);
                          }
                        }}
                        title={hasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
                      >
                        <svg viewBox="0 0 12 12" width="10" height="10">
                          <rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)"
                            fill={hasKf ? 'var(--color-keyframe)' : 'none'}
                            stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.5"
                          />
                        </svg>
                      </button>
                      <span className={`prop-label${animated ? ' animated' : ''}`}>{prop.label}</span>
                      <div className="prop-value">
                        <input
                          type="number"
                          value={Math.round(displayArr[0] * 10) / 10}
                          onChange={(e) =>
                            handleValueChange(prop.key, [
                              parseFloat(e.target.value) || 0,
                              displayArr[1],
                            ])
                          }
                          step={prop.key === 'scale' ? 1 : 0.5}
                          title={prop.key === 'scale' ? 'X (幅)' : 'X'}
                          style={{ width: '50%' }}
                        />
                        <input
                          type="number"
                          value={Math.round(displayArr[1] * 10) / 10}
                          onChange={(e) =>
                            handleValueChange(prop.key, [
                              displayArr[0],
                              parseFloat(e.target.value) || 0,
                            ])
                          }
                          step={prop.key === 'scale' ? 1 : 0.5}
                          title={prop.key === 'scale' ? 'Y (高さ)' : 'Y'}
                          style={{ width: '50%' }}
                        />
                      </div>
                    </div>
                  );
                }

                const defaultNum = rawValue as number;
                const displayNum = getDisplayValue(prop.key, defaultNum) as number;
                return (
                  <div key={prop.key} className="prop-row">
                    <button
                      className={`prop-keyframe-btn${hasKf ? ' has-keyframe' : ''}${animated ? ' animated' : ''}`}
                      onClick={() => {
                        if (hasKf) {
                          removeKeyframe(selectedLayer.id, prop.key, currentFrame);
                        } else {
                          handleAddKeyframe(prop.key, displayNum);
                        }
                      }}
                      title={hasKf ? 'キーフレーム削除' : 'キーフレーム追加'}
                    >
                      <svg viewBox="0 0 12 12" width="10" height="10">
                        <rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)"
                          fill={hasKf ? 'var(--color-keyframe)' : 'none'}
                          stroke={animated ? 'var(--color-keyframe)' : 'currentColor'} strokeWidth="1.5"
                        />
                      </svg>
                    </button>
                    <span className={`prop-label${animated ? ' animated' : ''}`}>{prop.label}</span>
                    <div className="prop-value">
                      <input
                        type="number"
                        value={Math.round(displayNum * 10) / 10}
                        onChange={(e) =>
                          handleValueChange(
                            prop.key,
                            parseFloat(e.target.value) || 0
                          )
                        }
                        min={prop.min}
                        max={prop.max}
                        step={prop.key === 'rotation' ? 1 : 0.5}
                      />
                      {prop.suffix && (
                        <span style={{
                          fontSize: 'var(--font-size-xxs)',
                          color: 'var(--color-text-dim)',
                          alignSelf: 'center',
                        }}>
                          {prop.suffix}
                        </span>
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
                {/* テキスト内容 */}
                <div className="prop-row" style={{ gridTemplateColumns: '24px 1fr' }}>
                  <div />
                  <textarea
                    value={selectedLayer.textStyle.text}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, {
                        textStyle: { ...selectedLayer.textStyle!, text: e.target.value },
                      })
                    }
                    rows={3}
                    style={{
                      background: 'var(--color-bg-input)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 6px',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-primary)',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      width: '100%',
                    }}
                  />
                </div>
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
                <div className="prop-row">
                  <div />
                  <span className="prop-label">サイズ</span>
                  <div className="prop-value">
                    <input
                      type="number"
                      value={selectedLayer.textStyle.fontSize}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, fontSize: parseInt(e.target.value) || 12 },
                        })
                      }
                      min={1}
                      step={1}
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>
                      px
                    </span>
                  </div>
                </div>
                {/* フォントウェイト */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">太さ</span>
                  <div className="prop-value">
                    <select
                      value={selectedLayer.textStyle.fontWeight}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, fontWeight: parseInt(e.target.value) },
                        })
                      }
                      style={selectStyle}
                    >
                      <option value={100}>Thin (100)</option>
                      <option value={200}>ExtraLight (200)</option>
                      <option value={300}>Light (300)</option>
                      <option value={400}>Regular (400)</option>
                      <option value={500}>Medium (500)</option>
                      <option value={600}>SemiBold (600)</option>
                      <option value={700}>Bold (700)</option>
                      <option value={800}>ExtraBold (800)</option>
                      <option value={900}>Black (900)</option>
                    </select>
                  </div>
                </div>
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
                <div className="prop-row">
                  <div />
                  <span className="prop-label">行間</span>
                  <div className="prop-value">
                    <input
                      type="number"
                      value={selectedLayer.textStyle.lineHeight}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, lineHeight: parseFloat(e.target.value) || 1 },
                        })
                      }
                      min={0.5}
                      max={5}
                      step={0.1}
                    />
                  </div>
                </div>
                {/* 文字間隔 */}
                <div className="prop-row">
                  <div />
                  <span className="prop-label">文字間隔</span>
                  <div className="prop-value">
                    <input
                      type="number"
                      value={selectedLayer.textStyle.letterSpacing}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          textStyle: { ...selectedLayer.textStyle!, letterSpacing: parseFloat(e.target.value) || 0 },
                        })
                      }
                      step={0.5}
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>
                      px
                    </span>
                  </div>
                </div>
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
                <div className="prop-row">
                  <div />
                  <span className="prop-label">塗り不透明度</span>
                  <div className="prop-value">
                    <input
                      type="number"
                      value={selectedLayer.shapeData.fillOpacity ?? 100}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, fillOpacity: parseFloat(e.target.value) || 100 },
                        })
                      }
                      min={0}
                      max={100}
                      step={1}
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>%</span>
                  </div>
                </div>
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
                <div className="prop-row">
                  <div />
                  <span className="prop-label">線幅</span>
                  <div className="prop-value">
                    <input
                      type="number"
                      value={selectedLayer.shapeData.strokeWidth}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shapeData: { ...selectedLayer.shapeData!, strokeWidth: parseFloat(e.target.value) || 0 },
                        })
                      }
                      min={0}
                      step={0.5}
                    />
                    <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>px</span>
                  </div>
                </div>
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
                {selectedLayer.shapeData.shapeType === 'rectangle' && (
                  <div className="prop-row">
                    <div />
                    <span className="prop-label">角丸</span>
                    <div className="prop-value">
                      <input
                        type="number"
                        value={selectedLayer.shapeData.cornerRadius ?? 0}
                        onChange={(e) =>
                          updateLayer(selectedLayer.id, {
                            shapeData: { ...selectedLayer.shapeData!, cornerRadius: parseFloat(e.target.value) || 0 },
                          })
                        }
                        min={0}
                        step={1}
                      />
                      <span style={{ fontSize: 'var(--font-size-xxs)', color: 'var(--color-text-dim)', alignSelf: 'center' }}>px</span>
                    </div>
                  </div>
                )}
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
