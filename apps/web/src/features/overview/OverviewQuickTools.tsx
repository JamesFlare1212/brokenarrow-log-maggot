import { ArrowRight, Layers, Search, ShieldCheck } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Button, Card } from '../../components/ui';
import { OverviewRecordingStatus } from './OverviewRecordingStatus';

export function OverviewQuickTools() {
  const { setPage } = useApp(),
    { t } = useI18n();
  return (
    <aside className="dashboard-side" aria-label={t('quickTools')}>
      <Card title={t('quickTools')} showHeader={false} className="quick-tools">
        <ItemGroup>
          {(
            [
              { page: 'players', icon: Search, hint: 'playerShortcut' },
              { page: 'decks', icon: Layers, hint: 'deckShortcut' },
              { page: 'bans', icon: ShieldCheck, hint: 'banShortcut' },
            ] as const
          ).map(({ page, icon: ToolIcon, hint }) => (
            <Item size="xs" asChild key={page}>
              <Button
                variant="ghost"
                className="h-auto w-full min-w-0 flex-nowrap justify-start whitespace-normal"
                onClick={() => setPage(page)}
              >
                <ItemMedia variant="icon">
                  <ToolIcon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t(page)}</ItemTitle>
                  <ItemDescription>{t(hint)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ArrowRight />
                </ItemActions>
              </Button>
            </Item>
          ))}
          <OverviewRecordingStatus />
        </ItemGroup>
      </Card>
    </aside>
  );
}
