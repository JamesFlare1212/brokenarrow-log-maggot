import { faDisplay, faSun, faMoon, faCheck } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '../../components/Icon';
import { TooltipButton } from '../../components/Tooltip';
import { COLOR_SCHEMES, THEME_MODES, type PublicConfig } from '@ba/contracts';
import { useI18n } from '../../hooks/useI18n';
import { colorSchemeFor } from '../../hooks/useAppearance';

const icons = { system: faDisplay, light: faSun, dark: faMoon };
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
            const icon = icons[mode];
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
                  <Icon icon={icon} size={15} aria-hidden="true" />
                  {t('themeMode.' + mode)}
                  {draft.themeMode === mode && <Icon icon={faCheck} size={14} aria-hidden="true" />}
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
                <TooltipButton
                  type="button"
                  className="palette-pair-select"
                  aria-label={pairLabel}
                  aria-pressed={pairSelected}
                  onClick={() => change({ lightTheme: color, darkTheme: color })}
                />
                <div className="palette-preview">
                  {(['light', 'dark'] as const).map((mode) => {
                    const selected = colorSchemeFor(draft, mode) === color;
                    const icon = icons[mode];
                    const label = t('theme.' + color) + ' · ' + t('themeMode.' + mode);
                    return (
                      <TooltipButton
                        key={mode}
                        type="button"
                        className="palette-choice"
                        data-mode={mode}
                        aria-label={label}
                        aria-pressed={selected}
                        onClick={() =>
                          change({
                            [mode === 'light' ? 'lightTheme' : 'darkTheme']: color,
                          })
                        }
                      >
                        <span className="palette-orb" aria-hidden="true" />
                        <span className="palette-mode-icon" aria-hidden="true">
                          {selected ? (
                            <Icon icon={faCheck} size={11} />
                          ) : (
                            <Icon icon={icon} size={11} />
                          )}
                        </span>
                      </TooltipButton>
                    );
                  })}
                </div>
                <span className="palette-label">{t('theme.' + color)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
