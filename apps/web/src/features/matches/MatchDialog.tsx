import { useApp } from '../../app/state';
import { useI18n } from '../../hooks/useI18n';
import { Dialog } from '../../components/ui';
import { MatchDetails } from './MatchDetails';

export function MatchDialog({ fid }: { fid: string }) {
  const { closeModal, backModal } = useApp();
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={closeModal}
      onBack={backModal}
      title={`${t('matchDetail')} · #${fid}`}
      className="dialog-wide match-dialog"
    >
      <MatchDetails key={fid} fid={fid} />
    </Dialog>
  );
}
