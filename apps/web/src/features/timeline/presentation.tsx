import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import type { TimelineData } from '@ba/contracts';
import { translate, useI18n } from '@/hooks/useI18n';
import { presentMoment, type Moment } from './model';

type Presentation = {
  data: Omit<TimelineData, 'moments'> & { moments: Moment[] };
  ids: {
    keys: string;
    method: string;
    visuals: string;
    details: string;
    navigation: string;
    compact: string;
    evidence: string;
  };
};
const TimelineContext = createContext<Presentation | null>(null);

export function TimelinePresentationProvider({
  data,
  children,
}: {
  data: TimelineData;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const id = useId();
  const value = useMemo(
    () => ({
      data: {
        ...data,
        moments: data.moments.map((moment) =>
          presentMoment(moment, (key, vars) => translate(locale, key, vars)),
        ),
      },
      ids: {
        keys: `${id}-keys`,
        method: `${id}-method`,
        visuals: `${id}-visuals`,
        details: `${id}-details`,
        navigation: `${id}-navigation`,
        compact: `${id}-compact`,
        evidence: `${id}-evidence`,
      },
    }),
    [data, locale, id],
  );
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

export function useTimeline() {
  const context = useContext(TimelineContext);
  if (!context) throw new Error('Timeline presentation requires its provider');
  const { locale, t } = useI18n();
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 0 }),
    [locale],
  );
  const number = (value: number) => formatter.format(Math.round(value));
  const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
  return { ...context, t, number, signed };
}
