import { Moon, Sun } from 'lucide-react';
import { COLOR_SCHEMES, THEME_MODES, type PublicConfig } from '@ba/contracts';
import { useI18n } from '../../hooks/useI18n';
import { colorSchemeFor } from '../../hooks/useAppearance';
import { Tooltip } from '../../components/Tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ThemePreviewCircle, previewColorsFor } from './ThemePreviewCircle';
import { ThemeWireframe } from './ThemeWireframe';

export function AppearanceSettings({
  draft,
  change,
}: {
  draft: PublicConfig;
  change: (patch: Partial<PublicConfig>) => void;
}) {
  const { t } = useI18n();
  const lightTheme = colorSchemeFor(draft, 'light');
  const darkTheme = colorSchemeFor(draft, 'dark');
  const pickPair = (color: (typeof COLOR_SCHEMES)[number]) =>
    change({ lightTheme: color, darkTheme: color });
  return (
    <div className="appearance-settings">
      <section className="appearance-section" aria-labelledby="settings-mode-heading">
        <h3 className="appearance-section-title" id="settings-mode-heading">
          {t('appearanceColorScheme')}
        </h3>
        <FieldGroup>
          <Field>
            <ToggleGroup
              type="single"
              value={draft.themeMode}
              variant="appearance"
              className="appearance-modes"
              aria-labelledby="settings-mode-heading"
              onValueChange={(value) => {
                if (value) change({ themeMode: value as PublicConfig['themeMode'] });
              }}
            >
              {THEME_MODES.map((mode) => (
                <ToggleGroupItem
                  key={mode}
                  value={mode}
                  className="appearance-mode-option h-auto min-w-0 flex-col items-stretch gap-2 p-2"
                >
                  <ThemeWireframe
                    className="appearance-mode-preview"
                    panes={
                      mode === 'system'
                        ? [
                            { clip: 'left', colors: previewColorsFor(lightTheme, 'light') },
                            { clip: 'right', colors: previewColorsFor(darkTheme, 'dark') },
                          ]
                        : [
                            {
                              colors: previewColorsFor(
                                mode === 'light' ? lightTheme : darkTheme,
                                mode,
                              ),
                            },
                          ]
                    }
                  />
                  <span className="appearance-mode-label">{t('themeMode.' + mode)}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </section>
      <section className="appearance-section" aria-labelledby="appearance-themes-heading">
        <h3 className="appearance-section-title" id="appearance-themes-heading">
          {t('appearanceThemes')}
        </h3>
        <div className="appearance-theme-grid">
          {COLOR_SCHEMES.map((color) => {
            const label = t('theme.' + color);
            const activeModes = (['light', 'dark'] as const).filter(
              (mode) => colorSchemeFor(draft, mode) === color,
            );
            return (
              <Card
                key={color}
                variant="appearance"
                className="appearance-theme-card"
                data-theme-library-card={color}
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) pickPair(color);
                }}
              >
                <CardHeader className="sr-only">
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent className="appearance-theme-content">
                  <ToggleGroup
                    type="multiple"
                    variant="sphere"
                    className="appearance-theme-swatches"
                    aria-label={t('appearanceThemeVariants', { theme: label })}
                    value={activeModes}
                    onValueChange={(values) => {
                      const mode = values.find(
                        (value) => !activeModes.includes(value as 'light' | 'dark'),
                      );
                      if (mode === 'light' || mode === 'dark')
                        change({ [mode === 'light' ? 'lightTheme' : 'darkTheme']: color });
                    }}
                  >
                    {(['light', 'dark'] as const).map((mode) => {
                      const ModeIcon = mode === 'light' ? Sun : Moon;
                      return (
                        <Tooltip
                          key={mode}
                          content={t('appearanceUseMode', { mode: t('themeMode.' + mode) })}
                        >
                          <ToggleGroupItem
                            value={mode}
                            className="appearance-theme-swatch size-[68px] min-w-0 rounded-full p-1"
                            aria-label={`${label} · ${t('themeMode.' + mode)}`}
                          >
                            <ThemePreviewCircle
                              colors={previewColorsFor(color, mode)}
                              mode={mode}
                            />
                            <span className="appearance-swatch-state" aria-hidden="true">
                              <ModeIcon />
                            </span>
                          </ToggleGroupItem>
                        </Tooltip>
                      );
                    })}
                  </ToggleGroup>
                </CardContent>
                <CardFooter variant="plain" className="appearance-theme-footer">
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 justify-start p-0"
                    aria-label={`${label} · ${t('selectPalettePair')}`}
                    aria-pressed={activeModes.length === 2}
                    title={t('selectPalettePair')}
                    onClick={() => pickPair(color)}
                  >
                    {label}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
