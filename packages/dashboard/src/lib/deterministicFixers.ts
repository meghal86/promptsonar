// Deterministic, structure-preserving fixers — the browser/API path's copy of
// the engine's no-AI auto-fix tier.
//
// This MIRRORS packages/core/src/repository/fixers.ts. It lives here (pure TS,
// no tree-sitter/fs deps) so the /api/repository/fix route compiles it from
// source on every change — a stale pre-built @promptsonar/core can no longer
// break the deterministic fix. The CLI uses the core copy; keep the two in sync.
//
// Correctness contract (read before editing):
//  1. Every edit is a capture-group regex rewrite of the RAW file text, so the
//     surrounding bytes are preserved exactly — only the dangerous literal
//     changes (e.g. `true` -> `false`).
//  2. A fixer ABSTAINS unless certain: it applies only to relevant file types
//     and only to literals it can rewrite exactly.
//  3. Reproducible: same input -> same edits, every time. No AI, no network.

export interface DeterministicEdit {
  fixerId: string;
  index: number;
  match: string;
  replacement: string;
  line: number;
  description: string;
}

interface FixerRule {
  id: string;
  description: string;
  find: RegExp;
  replace: (match: RegExpExecArray) => string;
  appliesTo: (file: string) => boolean;
}

const isConfigFile = (file: string): boolean =>
  /\.(json|ya?ml|toml)$/i.test(file) || /(^|\/)\.?mcp(\.|$)|mcp\.json$/i.test(file) || /\.cursor\//i.test(file) || /\.claude\//i.test(file);

const FIXERS: FixerRule[] = [
  {
    id: 'mcp-disable-auto-approve',
    description: 'Disable automatic approval so tool calls require review.',
    find: /("?\bauto[_-]?approve"?\s*[:=]\s*)true\b/gi,
    replace: (m) => `${m[1]}false`,
    appliesTo: isConfigFile,
  },
  {
    id: 'mcp-restrict-wildcard-permissions',
    description: 'Replace wildcard permissions with least-privilege read access.',
    find: /("(?:permissions|scopes)"\s*:\s*\[)\s*"\*"\s*(\])/gi,
    replace: (m) => `${m[1]}"filesystem.read"${m[2]}`,
    appliesTo: isConfigFile,
  },
  {
    id: 'mcp-restrict-all-permissions',
    description: 'Replace "all" permissions with least-privilege read access.',
    find: /("(?:permissions|scopes)"\s*:\s*\[)\s*"all"\s*(\])/gi,
    replace: (m) => `${m[1]}"filesystem.read"${m[2]}`,
    appliesTo: isConfigFile,
  },
];

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

export function computeDeterministicEdits(file: string, content: string): DeterministicEdit[] {
  const edits: DeterministicEdit[] = [];
  for (const fixer of FIXERS) {
    if (!fixer.appliesTo(file)) continue;
    const re = new RegExp(fixer.find.source, fixer.find.flags.includes('g') ? fixer.find.flags : `${fixer.find.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const replacement = fixer.replace(match);
      if (replacement === match[0]) {
        if (match.index === re.lastIndex) re.lastIndex += 1;
        continue;
      }
      edits.push({
        fixerId: fixer.id,
        index: match.index,
        match: match[0],
        replacement,
        line: lineOf(content, match.index),
        description: fixer.description,
      });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return edits.sort((a, b) => a.index - b.index);
}

export interface DeterministicFixResult {
  fixed: string;
  applied: DeterministicEdit[];
  skipped: DeterministicEdit[];
  residualClear: boolean;
}

export function applyDeterministicFixes(file: string, content: string, edits?: DeterministicEdit[]): DeterministicFixResult {
  const all = (edits ?? computeDeterministicEdits(file, content)).slice().sort((a, b) => b.index - a.index);
  let fixed = content;
  const applied: DeterministicEdit[] = [];
  const skipped: DeterministicEdit[] = [];
  for (const edit of all) {
    if (fixed.slice(edit.index, edit.index + edit.match.length) === edit.match) {
      fixed = fixed.slice(0, edit.index) + edit.replacement + fixed.slice(edit.index + edit.match.length);
      applied.push(edit);
    } else {
      skipped.push(edit);
    }
  }
  applied.reverse();
  const residualClear = computeDeterministicEdits(file, fixed).length === 0;
  return { fixed, applied, skipped, residualClear };
}
