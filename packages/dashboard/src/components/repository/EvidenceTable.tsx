import type { EvidenceRecord } from "@/types/repository";
import { Disclosure } from "./Disclosure";
import { ConfBadge } from "./ConfBadge";

/**
 * EvidenceTable — file/line/snippet/rule/confidence for every finding,
 * inside a collapsed Disclosure.
 */
export function EvidenceTable({ evidence }: { evidence: EvidenceRecord[] }) {
  return (
    <Disclosure
      title="Evidence behind every finding"
      subtitle="File, line, snippet, rule, confidence"
    >
      <div className="mt-1 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline">
              {["Location", "Snippet", "Rule", "Confidence"].map((h) => (
                <th
                  key={h}
                  className="py-2 pr-4 font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-faint"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evidence.map((e, i) => (
              <tr
                key={`${e.file}-${e.line}-${i}`}
                className={i === 0 ? "" : "border-t border-hairline"}
              >
                <td className="whitespace-nowrap py-3 pr-4 align-top font-mono text-[12px] text-ink">
                  {e.file}:{e.line}
                </td>
                <td className="py-3 pr-4 align-top">
                  <code className="inline-block rounded-md border border-amber-line bg-amber-soft px-2 py-1 font-mono text-[12px] text-ink">
                    {e.snippet}
                  </code>
                </td>
                <td className="whitespace-nowrap py-3 pr-4 align-top font-mono text-[12px] text-ink-muted">
                  {e.rule}
                </td>
                <td className="py-3 align-top">
                  <ConfBadge confidence={e.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

export default EvidenceTable;
