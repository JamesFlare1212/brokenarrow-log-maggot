import { useId, useRef, useState } from 'react';
import { formatDuration } from '@ba/shared';
import { useI18n } from '../../hooks/useI18n';

export function ApmChart({
  counts,
  bucketSec,
  durationSec,
  title,
}: {
  counts: number[];
  bucketSec: number;
  durationSec: number;
  title: string;
}) {
  const { t } = useI18n(),
    titleId = useId(),
    points = useRef<Array<SVGGElement | null>>([]),
    [selected, setSelected] = useState<number | null>(null),
    active = Math.min(selected ?? counts.length - 1, counts.length - 1),
    ceiling = Math.max(1, Math.ceil(Math.max(...counts) / 4)) * 4,
    span = Math.max(bucketSec, durationSec),
    end = (index: number) => Math.min((index + 1) * bucketSec, durationSec),
    partial = (index: number) => end(index) - index * bucketSec < bucketSec,
    range = (index: number) =>
      `${formatDuration(index * bucketSec)}–${formatDuration(end(index))}${partial(index) ? ' *' : ''}`,
    x = (index: number) => ((index * bucketSec + end(index)) / 2 / span) * 1000,
    y = (index: number) => 160 - (counts[index]! / ceiling) * 152,
    coordinates = counts.map((_, index) => `${x(index)},${y(index)}`),
    last = counts.length - 1;

  return (
    <figure className="apm-trend" aria-labelledby={titleId}>
      <figcaption id={titleId}>{title}</figcaption>
      <div className="apm-trend-grid">
        <div className="apm-y-axis" aria-hidden="true">
          {[4, 3, 2, 1, 0].map((step) => (
            <span key={step}>{(ceiling * step) / 4}</span>
          ))}
        </div>
        <div>
          <svg
            className="apm-plot"
            viewBox="0 0 1000 160"
            preserveAspectRatio="none"
            role="group"
            aria-label={title}
          >
            <rect
              className="apm-selection-band"
              aria-hidden="true"
              x={((active * bucketSec) / span) * 1000}
              y="0"
              width={Math.max(1, ((end(active) - active * bucketSec) / span) * 1000)}
              height="160"
            />
            {[0, 1, 2, 3, 4].map((step) => (
              <line
                className="apm-grid-line"
                key={step}
                x1="0"
                x2="1000"
                y1={160 - step * 38}
                y2={160 - step * 38}
              />
            ))}
            <polyline
              className="apm-trend-line"
              points={coordinates.slice(0, partial(last) ? -1 : undefined).join(' ')}
            />
            {partial(last) && last > 0 && (
              <polyline
                className="apm-trend-line apm-trend-partial"
                points={coordinates.slice(-2).join(' ')}
              />
            )}
            {counts.map((value, index) => (
              <g
                key={index}
                ref={(element) => {
                  points.current[index] = element;
                }}
                tabIndex={index === active ? 0 : -1}
                role="img"
                aria-label={`${range(index)}: ${value} ${t('totalActions')}`}
                className={`apm-trend-point${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onPointerDown={() => setSelected(index)}
                onFocus={() => setSelected(index)}
                onKeyDown={(event) => {
                  const target =
                    event.key === 'ArrowRight'
                      ? Math.min(last, index + 1)
                      : event.key === 'ArrowLeft'
                        ? Math.max(0, index - 1)
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? last
                            : null;
                  if (target !== null) {
                    event.preventDefault();
                    points.current[target]?.focus();
                  }
                }}
              >
                <title>{`${range(index)}: ${value} ${t('totalActions')}`}</title>
                <rect
                  x={((index * bucketSec) / span) * 1000}
                  y="0"
                  width={Math.max(1, ((end(index) - index * bucketSec) / span) * 1000)}
                  height="160"
                />
                {/* A round zero-length stroke stays circular when the SVG viewBox stretches. */}
                <line x1={x(index)} x2={x(index)} y1={y(index)} y2={y(index)} />
              </g>
            ))}
          </svg>
          <div className="apm-x-axis" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((step) => (
              <span key={step}>{formatDuration((span * step) / 4)}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="apm-chart-detail">
        {range(active)} · {t('totalActions')}: <strong>{counts[active]}</strong>
      </p>
      <p className="muted">{t('apmChartHint')}</p>
    </figure>
  );
}
