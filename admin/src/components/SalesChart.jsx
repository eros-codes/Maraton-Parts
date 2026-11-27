import { useState } from 'react';
import { formatToman } from '../lib/format';

// A column's caption. Days read as their number, with the Persian month
// underneath on the first column and wherever the month changes - thirty
// "۱۸ مهر"s side by side would not fit. Months read in full ("مهر ۱۴۰۵").
function caption(periods, index, granularity) {
  const { label, period } = periods[index];
  if (!label) return { main: period.slice(5) };
  if (granularity === 'month') return { main: label };
  const monthOf = (text) => text?.split(' ').slice(1).join(' ');
  const month = monthOf(label);
  return {
    main: label.split(' ')[0],
    sub: month !== monthOf(periods[index - 1]?.label) ? month : null,
  };
}

// The scale runs a quarter above the best period, so the highest point always
// has clear air above it (and room for its tooltip).
const HEADROOM = 1.25;
// Zero sits a little above the floor, so a flat line does not hug the labels.
const FLOOR = 94;

// Net sales per period, as the API's /reports/sales returns them: days are
// Tehran days, months are Persian months. Drawn as a line, oldest period at
// the start (the right, in Persian).
export default function SalesChart({ periods, granularity = 'day' }) {
  const [hovered, setHovered] = useState(null);
  const count = periods.length;
  if (!count) return null;

  const values = periods.map((period) => Math.max(0, Number(period.net) || 0));
  const peak = Math.max(...values);
  const scale = Math.max(1, peak) * HEADROOM;
  const points = values.map((value, index) => ({
    x: ((index + 0.5) / count) * 100,
    y: FLOOR - (value / scale) * FLOOR,
  }));
  const peakIndex = peak > 0 ? values.indexOf(peak) : -1;

  // SVG x runs left to right; the page runs right to left, so the drawing is
  // mirrored in CSS (.chart-svg) to line up with the columns and labels.
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const area = `${line} L${points[count - 1].x} 100 L${points[0].x} 100 Z`;

  const tip = hovered === null ? null : points[hovered];
  // Near either edge the tooltip grows inward instead of from its centre, and
  // a point near the top shows it underneath - so it never leaves the frame.
  const tipAlign =
    hovered === null
      ? null
      : hovered < count / 4
        ? 'start'
        : hovered >= count - count / 4
          ? 'end'
          : 'center';

  return (
    <div className="chart">
      <div className="chart-inner" style={{ minWidth: count * 30 }}>
        <div className="chart-plot" onPointerLeave={() => setHovered(null)}>
          <svg
            className="chart-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--wheat-500)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--wheat-500)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[25, 50, 75].map((y) => (
              <line key={y} className="chart-grid" x1="0" x2="100" y1={y} y2={y} />
            ))}
            <path d={area} fill="url(#chart-fill)" />
            <path d={line} className="chart-line" />
            {tip ? <line className="chart-guide" x1={tip.x} x2={tip.x} y1="0" y2="100" /> : null}
          </svg>

          {points.map((p, index) => (
            <span
              key={periods[index].period}
              className={[
                'chart-dot',
                index === peakIndex ? 'is-peak' : '',
                index === hovered ? 'is-active' : '',
              ].join(' ')}
              style={{ insetInlineStart: `${p.x}%`, top: `${p.y}%` }}
            />
          ))}

          {/* One invisible strip per period: hover, tap or focus shows its figure. */}
          <div className="chart-hits">
            {periods.map((period, index) => (
              <button
                key={period.period}
                type="button"
                className="chart-hit"
                aria-label={`${period.label ?? period.period}: ${formatToman(values[index])}`}
                onPointerEnter={() => setHovered(index)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                onClick={() => setHovered(index)}
              />
            ))}
          </div>

          {tip ? (
            <span
              className="chart-tip-anchor"
              data-align={tipAlign}
              data-below={tip.y < 30 ? 'true' : undefined}
              style={{ insetInlineStart: `${tip.x}%`, top: `${tip.y}%` }}
            >
              <span className="chart-tip">
                <span className="chart-tip-label">
                  {periods[hovered].label ?? periods[hovered].period}
                </span>
                <strong>{formatToman(values[hovered])}</strong>
              </span>
            </span>
          ) : null}
        </div>

        <div className="chart-labels">
          {periods.map((period, index) => {
            const { main, sub } = caption(periods, index, granularity);
            return (
              <span className="chart-label" key={period.period}>
                {main}
                {sub ? <small>{sub}</small> : null}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
