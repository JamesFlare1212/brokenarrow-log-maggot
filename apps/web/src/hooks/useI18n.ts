import { createContext, useContext } from 'react';
import type { Locale } from '@ba/contracts';
import { messages } from '../i18n/messages';
import { taxonomy } from '../i18n/taxonomy';
import { titleMessages } from '../i18n/titles';
import { scoreLabelMessages } from '../i18n/score-labels';
export const LocaleContext = createContext<Locale>('zh');
export function translate(
  locale: Locale,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const index = { zh: 0, en: 1 }[locale];
  let value =
    (messages[key] ?? taxonomy[key] ?? titleMessages[key] ?? scoreLabelMessages[key])?.[index] ??
    key;
  for (const [name, replacement] of Object.entries(vars))
    value = value.split('{' + name + '}').join(String(replacement));
  return value;
}
export function useI18n() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
  };
}
