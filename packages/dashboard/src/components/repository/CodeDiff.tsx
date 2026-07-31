/**
 * CodeDiff — red/green before/after code block.
 * Two-column grid: before (danger) on the left, after (safe) on the right.
 */
export function CodeDiff({
  before,
  after,
  beforeLabel = "Before — high risk",
  afterLabel = "After — safe",
  className = "",
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      <DiffPane
        label={beforeLabel}
        code={before}
        tone="bg-danger-soft border-danger-line text-[#8a2018]"
      />
      <DiffPane
        label={afterLabel}
        code={after}
        tone="bg-safe-soft border-safe-line text-[#0a6b48]"
      />
    </div>
  );
}

function DiffPane({
  label,
  code,
  tone,
}: {
  label: string;
  code: string;
  tone: string;
}) {
  return (
    <div className={`rounded-xl border p-[11px] ${tone}`}>
      <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.12em] opacity-80">
        {label}
      </span>
      <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default CodeDiff;
