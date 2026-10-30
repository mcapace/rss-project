"use client";

import { useId, useMemo, useRef, useState } from "react";

/* Quiet charts: thin marks, hairline grid, text in text tokens, a crosshair tooltip that lists every series. */

export type Series = { id: string; label: string; color: string; values: number[]; dashed?: boolean };

const compact = (value: number) => value >= 10_000 ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}K` : value.toLocaleString();

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value * 1000) / 1000);
  return ticks;
}

export function LineChart({ labels, series, height = 240, formatLabel = label => label, ariaLabel }: { labels: string[]; series: Series[]; height?: number; formatLabel?: (label: string) => string; ariaLabel: string }) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { top: 12, right: 16, bottom: 28, left: 44 };
  const innerWidth = width - pad.left - pad.right, innerHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.flatMap(item => item.values));
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] || max;
  const x = (index: number) => pad.left + (labels.length > 1 ? (index / (labels.length - 1)) * innerWidth : innerWidth / 2);
  const y = (value: number) => pad.top + innerHeight - (value / top) * innerHeight;
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = (values: number[]) => `${path(values)} L${x(values.length - 1).toFixed(1)},${(pad.top + innerHeight).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerHeight).toFixed(1)} Z`;
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.round(((px - pad.left) / innerWidth) * (labels.length - 1));
    setHover(Math.min(labels.length - 1, Math.max(0, index)));
  };
  const labelEvery = Math.max(1, Math.ceil(labels.length / 6));
  return <div className="ed-chart">
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onFocus={() => setHover(labels.length - 1)} onBlur={() => setHover(null)} tabIndex={0}>
      {ticks.map(tick => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="ed-chart-grid" />
        <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="ed-chart-axis">{compact(tick)}</text>
      </g>)}
      {labels.map((label, index) => (index % labelEvery === 0 && labels.length - 1 - index >= Math.ceil(labelEvery / 2)) || index === labels.length - 1 ? <text key={label} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle"} className="ed-chart-axis">{formatLabel(label)}</text> : null)}
      {series.map(item => item.dashed ? null : <path key={`${item.id}-area`} d={area(item.values)} fill={item.color} opacity={0.08} />)}
      {series.map(item => <path key={item.id} d={path(item.values)} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={item.dashed ? "4 5" : undefined} />)}
      {hover !== null && <g>
        <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerHeight} className="ed-chart-crosshair" />
        {series.map(item => <circle key={item.id} cx={x(hover)} cy={y(item.values[hover] ?? 0)} r={4} fill={item.color} stroke="var(--surface)" strokeWidth={2} />)}
      </g>}
    </svg>
    {hover !== null && <div className="ed-chart-tooltip" role="status" style={{ left: `${(x(hover) / width) * 100}%` }} id={`${id}-tip`}>
      <strong>{formatLabel(labels[hover])}</strong>
      {series.map(item => <div key={item.id}><i style={{ background: item.color }} /><b>{(item.values[hover] ?? 0).toLocaleString()}</b><span>{item.label}</span></div>)}
    </div>}
  </div>;
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return <div className="ed-legend">{series.map(item => <span key={item.id}><i style={{ background: item.color, borderStyle: item.dashed ? "dashed" : "solid" }} />{item.label}</span>)}</div>;
}

export function BarList({ rows, color = "var(--foreground)", format = (value: number) => value.toLocaleString() }: { rows: { label: string; value: number; detail?: string }[]; color?: string; format?: (value: number) => string }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return <div className="ed-barlist">
    {rows.map(row => <div key={row.label} className="ed-barlist-row" title={row.detail}>
      <span className="ed-barlist-label">{row.label}</span>
      <span className="ed-barlist-track"><i style={{ width: `${(row.value / max) * 100}%`, background: color }} /></span>
      <span className="ed-barlist-value">{format(row.value)}</span>
    </div>)}
  </div>;
}

export function Sparkline({ values, color = "var(--accent)", width = 96, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values), min = Math.min(...values, 0);
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * (width - 2) + 1},${height - 2 - ((value - min) / Math.max(1, max - min)) * (height - 4)}`);
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
