export const SETTINGS_TABS = [
  'general',
  'appearance',
  'connection',
  'automation',
  'cache',
  'recording',
  'navigation',
  'accounts',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export function settingsTabFromHash(hash: string): SettingsTab | null {
  if (['#about', '#settings/about', '#settings/updates'].includes(hash)) return 'general';
  if (hash === '#settings') return 'appearance';
  return SETTINGS_TABS.find((tab) => hash === `#settings/${tab}`) ?? null;
}
