import { errorMessage } from '@ba/shared';
import { useApp } from '../app/state';
import { useI18n } from './useI18n';

export function useClipboard() {
  const { notify } = useApp();
  const { t } = useI18n();
  return async (text: string) => {
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText !== 'function') {
        notify(t('clipboardUnavailable'), true);
        return;
      }
      await clipboard.writeText(text);
      notify(t('copied'));
    } catch (error) {
      notify(t('clipboardWriteFailed', { error: errorMessage(error) }), true);
    }
  };
}
