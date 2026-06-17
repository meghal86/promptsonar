import type { ExecutionPath } from "@/types/repository";
import { Disclosure } from "./Disclosure";
import { SevBadge } from "./SevBadge";
import { ConfBadge } from "./ConfBadge";

/** Render a path as a `a → b → sink` chain, sinks colored red. */
function PathChain({ path }: { path: ExecutionPath }) {
  const segments: Array<{ name: string; sink: boolean }> = path.nodes.length
    ? path.nodes.map((n) => ({ name: n.name, sink: n.isSink }))
    : path.filesInvolved.map((f) => ({ name: f, sink: false }));

  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[12.5px]">
      {segments.map((seg, i) => (
        <span key={`${seg.name}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">→</span>}
          <span className={seg.sink ? "font-medium text-crit" : "text-ink"}>
            {seg.name}
          </span>
        </span>
      ))}
    </span>
  );
}

function PathRow({ path, first }: { path: ExecutionPath; first: boolean }) {
  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1.5 py-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center ${
        first ? "" : "border-t border-hairline"
      }`}
    >
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <PathChain path={path} />
      </div>
      <span className="justify-self-start sm:justify-self-center">
        <SevBadge severity={path.severity} size="sm" />
      </span>
      <span className="justify-self-start sm:justify-self-center">
        <ConfBadge confidence={path.confidence} />
      </span>
      <span className="justify-self-end whitespace-nowrap font-mono text-[11.5px] text-faint">
        {path.fileCount} {path.fileCount === 1 ? "file" : "files"}
      </span>
    </div>
  );
}

/**
 * PathBrowser — ranked list of execution paths, inside a collapsed
 * Disclosure. `totalPaths` defaults to the number provided; when more paths
 * exist than are shown, a "N more paths" note appears.
 */
export function PathBrowser({
  paths,
  totalPaths,
}: {
  paths: ExecutionPath[];
  totalPaths?: number;
}) {
  const total = totalPaths ?? paths.length;
  const remaining = total - paths.length;

  return (
    <Disclosure
      title={`All ${total} paths`}
      subtitle="Ranked by risk · browse or open the architecture view"
    >
      <div className="mt-1">
        {paths.map((path, i) => (
          <PathRow key={path.id} path={path} first={i === 0} />
        ))}
      </div>

      {remaining > 0 && (
        <p className="mt-3 font-mono text-[11.5px] text-faint">
          {remaining} more {remaining === 1 ? "path" : "paths"} — open the
          architecture view to explore them all.
        </p>
      )}
    </Disclosure>
  );
}

export default PathBrowser;
