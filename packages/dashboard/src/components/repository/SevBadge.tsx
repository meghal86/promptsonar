import type { ReactNode } from "react";
import type { Severity } from "@/types/repository";

type Size = "sm" | "md";

const SIZE: Record<Size, string> = {
  sm: "text-[9.5px] px-[7px] py-[2px]",
  md: "text-[11px] px-[10px] py-[4px]",
};

// Color variants per spec. `critical` is solid; the rest are soft + border.
// NOTE: `medium` is spec'd as `bg-amber-badge/50`. Tailwind's opacity
// modifier can't reliably re-alpha a raw rgba() token, so the lighter amber
// is written as an explicit rgba instead.
const VARIANT: Record<Severity, string> = {
  critical: "bg-crit text-white border border-transparent",
  high: "bg-amber-badge border border-amber-badge-line text-high",
  medium: "bg-[rgba(251,224,160,0.3)] border border-amber-badge-line text-med",
  low: "bg-safe-soft border border-safe-line text-safe",
  info: "bg-neu-soft border border-neu-line text-neu",
};

const LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

/**
 * SevBadge — Critical | High | Medium | Low | Info severity pill.
 */
export function SevBadge({
  severity,
  size = "md",
  children,
  className = "",
}: {
  severity: Severity;
  size?: Size;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-md font-mono font-medium uppercase tracking-[0.06em] whitespace-nowrap",
        SIZE[size],
        VARIANT[severity],
        className,
      ].join(" ")}
    >
      {children ?? LABEL[severity]}
    </span>
  );
}

export default SevBadge;
