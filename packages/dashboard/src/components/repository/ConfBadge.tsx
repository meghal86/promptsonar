import type { Confidence } from "@/types/repository";

const LABEL: Record<Confidence, string> = {
  confirmed: "Confirmed",
  probable: "Probable",
  potential: "Potential",
};

// Dot style: confirmed = filled black, probable = filled amber,
// potential = open circle (transparent w/ border).
const DOT: Record<Confidence, string> = {
  confirmed: "bg-ink border border-ink",
  probable: "bg-amber border border-amber",
  potential: "bg-transparent border border-faint",
};

const TEXT: Record<Confidence, string> = {
  confirmed: "text-ink",
  probable: "text-med",
  potential: "text-faint",
};

/**
 * ConfBadge — Confirmed | Probable | Potential confidence indicator.
 * Renders a status dot + mono label. Pass `dotOnly` to drop the label.
 */
export function ConfBadge({
  confidence,
  dotOnly = false,
  className = "",
}: {
  confidence: Confidence;
  dotOnly?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 font-mono text-[11.5px]",
        TEXT[confidence],
        className,
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${DOT[confidence]}`}
      />
      {!dotOnly && LABEL[confidence]}
    </span>
  );
}

export default ConfBadge;
