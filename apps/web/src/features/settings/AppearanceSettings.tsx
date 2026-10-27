import { Moon, RotateCcw, Sun } from 'lucide-react';
import { COLOR_SCHEMES, GLASS_OPACITY, THEME_MODES, type PublicConfig } from '@ba/contracts';
import { useI18n } from '../../hooks/useI18n';
import { colorSchemeFor } from '../../hooks/useAppearance';
import { Tooltip, TooltipButton } from '../../components/Tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ThemePreviewCircle, previewColorsFor } from './ThemePreviewCircle';
import { ThemeWireframe } from './ThemeWireframe';

export function AppearanceSettings({
  draft,
  change,
}: {
  draft: PublicConfig;
  change: (patch: Partial<PublicConfig>, delay?: number) => void;
}) {
  const { t } = useI18n();
  const lightTheme = colorSchemeFor(draft, 'light');
  const darkTheme = colorSchemeFor(draft, 'dark');
  const resetOpacityLabel = t('glassOpacityReset', { opacity: GLASS_OPACITY.default });
  const pickPair = (color: (typeof COLOR_SCHEMES)[number]) =>
    change({ lightTheme: color, darkTheme: color });
  return (
    <div className="appearance-settings">
      <section className="appearance-section" aria-labelledby="settings-mode-heading">
        <h3 className="appearance-section-title" id="settings-mode-heading">
          {t('appearanceThemes')}
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
      <section className="appearance-section" aria-labelledby="appearance-glass-heading">
        <h3 className="appearance-section-title" id="appearance-glass-heading">
          {t('appearanceGlass')}
        </h3>
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('glassOpacity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal" className="appearance-opacity-field">
                <FieldContent className="min-w-0">
                  <div className="flex items-center gap-1">
                    <FieldLabel id="glass-opacity-label" htmlFor="glass-opacity">
                      {t('glassOpacity')}
                    </FieldLabel>
                    <TooltipButton
                      variant="ghost"
                      size="icon-xs"
                      aria-label={resetOpacityLabel}
                      tooltip={resetOpacityLabel}
                      disabled={draft.glassOpacity === GLASS_OPACITY.default}
                      onClick={() => change({ glassOpacity: GLASS_OPACITY.default })}
                    >
                      <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    </TooltipButton>
                  </div>
                  <FieldDescription>{t('glassOpacityHint')}</FieldDescription>
                </FieldContent>
                <div className="appearance-opacity-control">
                  <Badge
                    variant="secondary"
                    className="h-7 min-w-14 rounded-lg tabular-nums"
                    aria-hidden="true"
                  >
                    {draft.glassOpacity}%
                  </Badge>
                  <Slider
                    id="glass-opacity"
                    className="min-h-6"
                    min={GLASS_OPACITY.min}
                    max={GLASS_OPACITY.max}
                    step={GLASS_OPACITY.step}
                    value={[draft.glassOpacity]}
                    aria-labelledby="glass-opacity-label"
                    aria-valuetext={`${draft.glassOpacity}%`}
                    onValueChange={([value]) => {
                      if (value !== undefined) change({ glassOpacity: value }, 180);
                    }}
                  />
                </div>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </section>
      <section className="appearance-section" aria-labelledby="appearance-themes-heading">
        <h3 className="appearance-section-title" id="appearance-themes-heading">
          {t('appearanceColorScheme')}
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
