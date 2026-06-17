import type { NonProdGroup } from "@/types/repository";
import { Disclosure } from "./Disclosure";

/**
 * NonProdFindings — findings excluded from the trust verdict, shown for
 * completeness. Inside a collapsed Disclosure.
 */
export function NonProdFindings({ groups }: { groups: NonProdGroup[] }) {
  return (
    <Disclosure
      title="Non-production findings"
      subtitle="Excluded from the trust verdict · shown for completeness"
    >
      <div className="mt-1">
        {groups.map((group, i) => (
          <div
            key={group.label}
            className={`flex items-baseline gap-4 py-3 ${
              i === 0 ? "" : "border-t border-hairline"
            }`}
          >
            <span className="w-12 shrink-0 text-[20px] font-normal tabular-nums text-ink-muted">
              {group.count}
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-ink">
                {group.label}
              </span>
              <span className="mt-0.5 block font-mono text-[12px] text-faint">
                {group.note}
              </span>
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 border-t border-hairline pt-4 font-mono text-[12px] text-ink-muted">
        These do not affect the repository trust verdict.
      </p>
    </Disclosure>
  );
}

export default NonProdFindings;
