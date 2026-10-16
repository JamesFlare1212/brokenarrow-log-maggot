import { BATRACE_ORIGIN } from '@ba/contracts';
import type { Player, MiniInfo } from '@ba/contracts';
import { formatMetric } from '@ba/shared';
import { useApp } from '../../app/state';
import { Button, Menu } from '../../components/ui';
import { useI18n } from '../../hooks/useI18n';
export function PlayerActions({ player, info }: { player: Player; info?: MiniInfo | null }) {
  const { api, openModal, notify } = useApp(),
    { t } = useI18n();
  return (
    <Menu label={`${t('actions')}: ${player.name}`}>
      <Button onClick={() => openModal({ type: 'profile', id: player.id, name: player.name })}>
        {t('investigate')}
      </Button>
      <Button
        onClick={() => {
          void api
            .invoke('external.open', { url: `${BATRACE_ORIGIN}/player/${player.id}` })
            .catch((e) => notify(String(e), true));
        }}
      >
        {t('openBatrace')}
      </Button>
      <Button
        onClick={() => {
          void navigator.clipboard
            .writeText(
              info
                ? `${player.name} (${player.id}) · ELO ${formatMetric(info.elo, 0)} · ${t(info.fallback ? 'winRate' : 'recentWinRate')} ${formatMetric(info.winRate, 0)}% · ${info.category || '—'} · ${info.topUnits}`
                : `${player.name} ${player.id}`,
            )
            .then(() => notify(t('copied')))
            .catch((e) => notify(String(e), true));
        }}
      >
        {t('copy')}
      </Button>
    </Menu>
  );
}
