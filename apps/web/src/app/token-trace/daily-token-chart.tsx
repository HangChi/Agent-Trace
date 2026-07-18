"use client";

import type { DashboardRunTrendPoint } from "@agent-trace/schema";
import { useState, type KeyboardEvent, type PointerEvent } from "react";

import type { Locale } from "~/lib/i18n";

const chartWidth = 1120;
const chartHeight = 154;
const chartLeft = 20;
const chartRight = 1100;
const chartTop = 16;
const chartBottom = 148;

export function DailyTokenChart({
  points,
  locale,
  label,
  tooltipLabel
}: {
  points: DashboardRunTrendPoint[];
  locale: Locale;
  label: string;
  tooltipLabel: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const maxTokens = Math.max(1, ...points.map((point) => point.totalTokens));
  const chartPoints = points.map((point, index) => {
    const x = points.length > 1
      ? chartLeft + index * ((chartRight - chartLeft) / (points.length - 1))
      : chartWidth / 2;
    const y = chartTop + (1 - point.totalTokens / maxTokens) * (chartBottom - chartTop - 6);

    return { ...point, x, y };
  });
  const activePoint = activeIndex === null ? undefined : chartPoints[activeIndex];
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = chartPoints.length > 0
    ? `M ${chartPoints[0]?.x} ${chartBottom} ${chartPoints.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${chartPoints.at(-1)?.x} ${chartBottom} Z`
    : "";

  function updateFromPointer(event: PointerEvent<SVGSVGElement>) {
    if (points.length === 0) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerRatio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const chartRatio = Math.min(1, Math.max(0, (pointerRatio * chartWidth - chartLeft) / (chartRight - chartLeft)));
    setActiveIndex(Math.round(chartRatio * (points.length - 1)));
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const current = activeIndex ?? points.length - 1;
    setActiveIndex(Math.min(points.length - 1, Math.max(0, current + direction)));
  }

  if (points.length === 0) return null;

  const tooltipLeft = activePoint
    ? Math.min(92, Math.max(8, activePoint.x / chartWidth * 100))
    : 50;

  return (
    <div className="relative">
      {activePoint ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 shadow-[var(--shadow-panel)]"
          style={{ left: `${tooltipLeft}%` }}
        >
          <div className="text-[10px] font-medium text-muted-foreground">
            {formatTooltipDate(activePoint.date, locale)}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="text-[10px] text-muted-foreground">{tooltipLabel}</span>
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {formatInteger(activePoint.totalTokens, locale)}
            </span>
          </div>
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-44 w-full cursor-crosshair rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        aria-label={label}
        tabIndex={0}
        preserveAspectRatio="none"
        onFocus={() => setActiveIndex(points.length - 1)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
        onPointerMove={updateFromPointer}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id="token-trace-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.015" />
          </linearGradient>
          <linearGradient id="token-trace-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--trace)" />
          </linearGradient>
        </defs>
        {[22, 64, 106, chartBottom].map((y) => (
          <line
            key={y}
            x1={chartLeft}
            x2={chartRight}
            y1={y}
            y2={y}
            stroke="var(--border)"
            strokeDasharray="3 6"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={areaPath} fill="url(#token-trace-area)" />
        <polyline
          points={linePoints}
          fill="none"
          stroke="url(#token-trace-line)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {activePoint ? (
          <g aria-hidden>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={chartTop}
              y2={chartBottom}
              stroke="var(--muted-foreground)"
              strokeDasharray="3 4"
              strokeOpacity="0.55"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="4"
              fill="var(--surface-raised)"
              stroke="var(--primary)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>

      <span className="sr-only" aria-live="polite">
        {activePoint
          ? `${formatTooltipDate(activePoint.date, locale)}，${tooltipLabel} ${formatInteger(activePoint.totalTokens, locale)}`
          : ""}
      </span>
    </div>
  );
}

function formatTooltipDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatInteger(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 0
  }).format(value);
}
