import type { Provenance } from "@/types/repository";

// Short labels shown on the badge (the spec uses Prod | Config | Doc).
const LABEL: Record<Provenance, string> = {
  production: "Prod",
  configuration: "Config",
  documentation: "Doc",
  test: "Test",
  fixture: "Fixture",
};

// Color variants. `test`/`fixture` aren't spec'd explicitly; they reuse the
// neutral documentation styling since they're likewise non-production.
const VARIANT: Record<Provenance, string> = {
  production: "bg-[#44403c] text-white border border-transparent",
  configuration: "bg-blue-soft border border-blue-line text-blue",
  documentation: "bg-neu-soft border border-neu-line text-ink-muted",
  test: "bg-neu-soft border border-neu-line text-ink-muted",
  fixture: "bg-neu-soft border border-neu-line text-ink-muted",
};

/**
 * ProvBadge — Prod | Config | Doc provenance tag.
 * Geist Mono · 9px · 0.08em tracking · uppercase.
 */
export function ProvBadge({
  provenance,
  className = "",
}: {
  provenance: Provenance;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-[7px] py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] whitespace-nowrap",
        VARIANT[provenance],
        className,
      ].join(" ")}
    >
      {LABEL[provenance]}
    </span>
  );
}

export default ProvBadge;
