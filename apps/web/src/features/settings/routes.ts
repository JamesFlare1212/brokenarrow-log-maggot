export const SETTINGS_TABS = [
  'general',
  'appearance',
  'connection',
  'automation',
  'navigation',
  'accounts',
  'updates',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export function settingsTabFromHash(hash: string): SettingsTab | null {
  if (hash === '#settings') return 'appearance';
  return SETTINGS_TABS.find((tab) => hash === `#settings/${tab}`) ?? null;
}
