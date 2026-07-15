"use client";

type ProductImportCircularProgressProps = {
  percent: number;
};

const RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProductImportCircularProgress({
  percent,
}: ProductImportCircularProgressProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  return (
    <div className="relative mb-8 flex size-48 items-center justify-center">
      <svg
        aria-hidden
        className="size-full -rotate-90"
        viewBox="0 0 140 140"
      >
        <circle
          className="stroke-surface-container-highest"
          cx="70"
          cy="70"
          fill="none"
          r={RADIUS}
          strokeWidth="8"
        />
        <circle
          className="stroke-primary transition-all duration-500 ease-out"
          cx="70"
          cy="70"
          fill="none"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="8"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight text-on-surface">
          {Math.round(clamped)}
          <span className="text-lg">%</span>
        </span>
      </div>
    </div>
  );
}
