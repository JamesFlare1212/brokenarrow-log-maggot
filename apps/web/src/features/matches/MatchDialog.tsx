import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Dialog } from '../../components/ui';
import { MatchDetails } from './MatchDetails';

export function MatchDialog({ fid }: { fid: string }) {
  const { closeModal, backModal } = useApp();
  const { t } = useI18n();
  return (
    <MatchDetails
      key={fid}
      matchId={fid}
      renderDialog={(content, actions) => (
        <Dialog
          open
          onClose={closeModal}
          onBack={backModal}
          title={`${t('matchDetail')} · ${/^\d+$/.test(fid) ? '#' + fid : t('matchLocalOnly')}`}
          className="dialog-wide match-dialog w-[calc(100%_-_3rem)] max-w-400 sm:max-w-400 viewport-max-767:w-[calc(100%_-_1.5rem)]"
          headerActions={actions}
        >
          {content}
        </Dialog>
      )}
    />
  );
}
