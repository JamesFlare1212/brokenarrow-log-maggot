import type { PublicConfig } from './models';
import { rpcSchemas, type RpcMethod } from './rpc';

const methods = new Set<RpcMethod>([
  'app.bootstrap',
  'config.update',
  'cache.stats',
  'cache.clear',
  'updates.check',
  'players.search',
  'players.report',
  'players.maggot',
  'players.profile',
  'session.query',
  'matches.list',
  'matches.scan',
  'matches.local',
  'matches.detail',
  'matches.timeline',
  'matches.add',
  'matches.delete',
  'bans.list',
  'bans.sync',
  'accounts.list',
  'accounts.delete',
  'decks.list',
  'replays.list',
  'replays.directory',
  'displays.list',
  'displays.thumbnail',
  'api.health',
]);
const preferences = new Set<keyof PublicConfig>([
  'analyticsEnabled',
  'analyticsChoiceSaved',
  'theme',
  'themeMode',
  'lightTheme',
  'darkTheme',
  'glassOpacity',
  'eloColorScheme',
  'sidebarCollapsed',
  'sidebarWidth',
  'lang',
  'panelOrder',
  'hiddenPanels',
  'collapsedPanels',
  'banCardVisible',
  'multiAccountBond',
]);
export const browserFixtureAccess = {
  method: (method: RpcMethod) => methods.has(method),
  preference: (key: keyof PublicConfig) => preferences.has(key),
};

export function assertBrowserFixtureRequest(
  method: unknown,
  input: unknown,
): asserts method is RpcMethod {
  if (typeof method === 'string' && methods.has(method as RpcMethod)) {
    if (method !== 'config.update') return;
    const patch = rpcSchemas['config.update'].parse(input);
    if (Object.keys(patch).every((key) => preferences.has(key as keyof PublicConfig))) return;
  }
  throw new Error(
    '浏览器开发模式仅使用测试数据，此功能请通过桌面应用使用。 / This operation requires the desktop application.',
  );
}
