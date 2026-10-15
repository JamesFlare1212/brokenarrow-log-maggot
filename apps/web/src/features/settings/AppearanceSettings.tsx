import { Monitor, Sun, Moon, Check } from 'lucide-react';
import { COLOR_SCHEMES, THEME_MODES, type PublicConfig } from '@ba/contracts';
import { useI18n } from '../../hooks/useI18n';
import { colorSchemeFor } from '../../hooks/useAppearance';

const icons = { system: Monitor, light: Sun, dark: Moon };
export function AppearanceSettings({
  draft,
  change,
}: {
  draft: PublicConfig;
  change: (patch: Partial<PublicConfig>) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className="settings-section" aria-labelledby="settings-mode-heading">
        <h3 id="settings-mode-heading">{t('theme')}</h3>
        <div className="appearance-modes" role="group" aria-labelledby="settings-mode-heading">
          {THEME_MODES.map((mode) => {
            const Icon = icons[mode];
            return (
              <button
                key={mode}
                type="button"
                className="appearance-mode"
                aria-pressed={draft.themeMode === mode}
                onClick={() => change({ themeMode: mode })}
              >
                <span className={'mode-preview mode-preview-' + mode} aria-hidden="true">
                  <span className="mode-preview-sidebar">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="mode-preview-main">
                    <i />
                    <i />
                    <span />
                  </span>
                </span>
                <span className="appearance-mode-label">
                  <Icon size={15} aria-hidden="true" />
                  {t('themeMode.' + mode)}
                  {draft.themeMode === mode && <Check size={14} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-colors-heading">
        <h3 id="settings-colors-heading">{t('colorScheme')}</h3>
        <p>{t('colorSchemeHint')}</p>
        <div className="color-schemes" role="group" aria-labelledby="settings-colors-heading">
          {COLOR_SCHEMES.map((color) => {
            const pairSelected = (['light', 'dark'] as const).every(
              (mode) => colorSchemeFor(draft, mode) === color,
            );
            const pairLabel = t('theme.' + color) + ' · ' + t('selectPalettePair');
            return (
              <div
                key={color}
                className="color-scheme"
                data-palette={color}
                role="group"
                aria-label={t('theme.' + color)}
              >
                <button
                  type="button"
                  className="palette-pair-select"
                  aria-label={pairLabel}
                  title={pairLabel}
                  aria-pressed={pairSelected}
                  onClick={() => change({ lightTheme: color, darkTheme: color })}
                />
                <div className="palette-preview">
                  {(['light', 'dark'] as const).map((mode) => {
                    const selected = colorSchemeFor(draft, mode) === color;
                    const Icon = icons[mode];
                    const label = t('theme.' + color) + ' · ' + t('themeMode.' + mode);
                    return (
                      <button
                        key={mode}
                        type="button"
                        className="palette-choice"
                        data-mode={mode}
                        aria-label={label}
                        title={label}
                        aria-pressed={selected}
                        onClick={() =>
                          change({
                            [mode === 'light' ? 'lightTheme' : 'darkTheme']: color,
                          })
                        }
                      >
                        <span className="palette-orb" aria-hidden="true" />
                        <span className="palette-mode-icon" aria-hidden="true">
                          {selected ? <Check size={11} /> : <Icon size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className="palette-label">{t('theme.' + color)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <p className="settings-preview-note">{t('themeHint')}</p>
    </>
  );
}
