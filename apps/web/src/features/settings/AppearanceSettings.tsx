import { Moon, RotateCcw, Sun } from 'lucide-react';
import {
  COLOR_SCHEMES,
  GLASS_OPACITY,
  SIDEBAR_WIDTH_LIMITS,
  THEME_MODES,
  type PublicConfig,
} from '@ba/contracts';
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
    <div className="appearance-settings flex flex-col gap-(--content-gap) @container/appearance">
      <section
        className="appearance-section flex min-w-0 flex-col gap-3"
        aria-labelledby="settings-mode-heading"
      >
        <h3
          className="appearance-section-title px-4 text-[color-mix(in_oklab,_var(--foreground)_70%,_transparent)] text-[0.875rem] font-normal"
          id="settings-mode-heading"
        >
          {t('appearanceThemes')}
        </h3>
        <FieldGroup>
          <Field>
            <ToggleGroup
              type="single"
              value={draft.themeMode}
              variant="card"
              className="appearance-modes grid w-full grid-cols-3 gap-(--content-gap) items-stretch"
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
                    className="appearance-mode-preview h-35 appearance-max-28:h-20"
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
                  <span className="appearance-mode-label block min-h-5 whitespace-normal text-center">
                    {t('themeMode.' + mode)}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </section>
      <section
        className="appearance-section flex min-w-0 flex-col gap-3"
        aria-labelledby="appearance-sidebar-heading"
      >
        <h3
          className="appearance-section-title px-4 text-muted-foreground text-sm font-normal"
          id="appearance-sidebar-heading"
        >
          {t('sidebarSettings')}
        </h3>
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('sidebarWidth')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field
                orientation="horizontal"
                className="has-[>[data-slot=field-content]]:items-center grid grid-cols-[minmax(0,_1fr)_minmax(14rem,_20rem)] items-center gap-6 appearance-max-36:grid-cols-1 appearance-max-36:gap-4"
              >
                <FieldContent className="min-w-0">
                  <div className="flex items-center gap-1">
                    <FieldLabel id="sidebar-width-label" htmlFor="sidebar-width">
                      {t('sidebarWidth')}
                    </FieldLabel>
                    <TooltipButton
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('sidebarWidthReset')}
                      tooltip={t('sidebarWidthReset')}
                      disabled={draft.sidebarWidth === SIDEBAR_WIDTH_LIMITS.default}
                      onClick={() => change({ sidebarWidth: SIDEBAR_WIDTH_LIMITS.default })}
                    >
                      <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    </TooltipButton>
                  </div>
                  <FieldDescription id="sidebar-width-hint">
                    {t('sidebarWidthHint')}
                  </FieldDescription>
                </FieldContent>
                <div className="flex min-w-0 items-center gap-3.5">
                  <Badge
                    variant="secondary"
                    className="h-7 shrink-0 tabular-nums"
                    aria-hidden="true"
                  >
                    {t('sidebarWidthPixels', { width: draft.sidebarWidth })}
                  </Badge>
                  <Slider
                    id="sidebar-width"
                    className="min-h-6"
                    min={SIDEBAR_WIDTH_LIMITS.min}
                    max={SIDEBAR_WIDTH_LIMITS.max}
                    step={1}
                    value={[draft.sidebarWidth]}
                    aria-labelledby="sidebar-width-label"
                    aria-describedby="sidebar-width-hint"
                    aria-valuetext={t('sidebarWidthPixels', { width: draft.sidebarWidth })}
                    onValueChange={([value]) => {
                      if (value !== undefined) change({ sidebarWidth: value }, 180);
                    }}
                  />
                </div>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </section>
      <section
        className="appearance-section flex min-w-0 flex-col gap-3"
        aria-labelledby="appearance-glass-heading"
      >
        <h3
          className="appearance-section-title px-4 text-[color-mix(in_oklab,_var(--foreground)_70%,_transparent)] text-[0.875rem] font-normal"
          id="appearance-glass-heading"
        >
          {t('appearanceGlass')}
        </h3>
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{t('glassOpacity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field
                orientation="horizontal"
                className="appearance-opacity-field has-[>[data-slot=field-content]]:items-center grid grid-cols-[minmax(0,_1fr)_minmax(14rem,_20rem)] items-center gap-6 appearance-max-36:grid-cols-1 appearance-max-36:gap-4"
              >
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
                <div className="appearance-opacity-control flex min-w-0 items-center gap-3.5">
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
      <section
        className="appearance-section flex min-w-0 flex-col gap-3"
        aria-labelledby="appearance-elo-heading"
      >
        <h3
          className="appearance-section-title px-4 text-[color-mix(in_oklab,_var(--foreground)_70%,_transparent)] text-[0.875rem] font-normal"
          id="appearance-elo-heading"
        >
          {t('eloColorScheme')}
        </h3>
        <FieldGroup>
          <Field>
            <ToggleGroup
              type="single"
              value={draft.eloColorScheme}
              variant="card"
              className="w-full flex-wrap"
              aria-labelledby="appearance-elo-heading"
              onValueChange={(value) => {
                if (value === 'green-up' || value === 'red-up') change({ eloColorScheme: value });
              }}
            >
              {(['green-up', 'red-up'] as const).map((scheme) => (
                <ToggleGroupItem
                  key={scheme}
                  value={scheme}
                  className="h-auto min-w-0 flex-1 flex-col gap-2 py-3 whitespace-normal"
                >
                  <span>{t('eloColorScheme.' + scheme)}</span>
                  <span className="flex items-center gap-4 tabular-nums" aria-hidden="true">
                    <span className={scheme === 'green-up' ? 'text-success' : 'text-destructive'}>
                      +20.00
                    </span>
                    <span className={scheme === 'green-up' ? 'text-destructive' : 'text-success'}>
                      -20.00
                    </span>
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </section>
      <section
        className="appearance-section flex min-w-0 flex-col gap-3"
        aria-labelledby="appearance-themes-heading"
      >
        <h3
          className="appearance-section-title px-4 text-[color-mix(in_oklab,_var(--foreground)_70%,_transparent)] text-[0.875rem] font-normal"
          id="appearance-themes-heading"
        >
          {t('appearanceColorScheme')}
        </h3>
        <div className="appearance-theme-grid grid grid-cols-3 gap-(--content-gap) appearance-max-44:grid-cols-2 appearance-max-28:grid-cols-1">
          {COLOR_SCHEMES.map((color) => {
            const label = t('theme.' + color);
            const activeModes = (['light', 'dark'] as const).filter(
              (mode) => colorSchemeFor(draft, mode) === color,
            );
            return (
              <Card
                key={color}
                variant="appearance"
                className="appearance-theme-card relative min-w-0 gap-0 p-0 cursor-pointer"
                data-theme-library-card={color}
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) pickPair(color);
                }}
              >
                <CardHeader className="sr-only">
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent className="appearance-theme-content pt-3 px-3 pb-0">
                  <ToggleGroup
                    type="multiple"
                    variant="sphere"
                    className="appearance-theme-swatches min-h-17 justify-center gap-2.5 mx-auto"
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
                            className="appearance-theme-swatch relative flex-none transition-shadow duration-(--motion-fast) ease-(--ease-out) [&[aria-pressed='true']]:shadow-[inset_0_0_0_2px_var(--appearance-selection)] size-[68px] min-w-0 rounded-full p-1"
                            aria-label={`${label} · ${t('themeMode.' + mode)}`}
                          >
                            <ThemePreviewCircle
                              colors={previewColorsFor(color, mode)}
                              mode={mode}
                            />
                            <span
                              className="appearance-swatch-state absolute right-0.5 bottom-0.5 flex w-5 h-5 items-center justify-center border border-border rounded-[50%] bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0_/_0.1)] opacity-0 pointer-events-none [.appearance-theme-swatch[aria-pressed='true']>&]:opacity-100 [&>svg]:w-3 [&>svg]:h-3"
                              aria-hidden="true"
                            >
                              <ModeIcon />
                            </span>
                          </ToggleGroupItem>
                        </Tooltip>
                      );
                    })}
                  </ToggleGroup>
                </CardContent>
                <CardFooter
                  variant="plain"
                  className="appearance-theme-footer gap-2 pt-2 px-3 pb-3"
                >
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
