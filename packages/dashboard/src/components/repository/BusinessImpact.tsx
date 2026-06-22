import type { RepositoryScan } from "@/types/repository";

/**
 * BusinessImpact — three plain-language consequence cards in a 3-col grid.
 * Amber-tinted cards, each led by a red [!] marker.
 */
export function BusinessImpact({
  items,
}: {
  items: RepositoryScan["businessImpact"];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.title}
          className="flex gap-3 rounded-2xl border border-amber-line bg-[rgba(254,243,199,0.22)] p-4"
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-danger-line bg-danger-soft font-mono text-[13px] font-semibold text-crit"
          >
            !
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug text-ink">
              {item.title}
            </h3>
            <p className="mt-1 font-mono text-[12px] leading-relaxed text-ink-muted">
              {item.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default BusinessImpact;
