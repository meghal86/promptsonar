// Deterministic, structure-preserving fixers — PromptSonar's no-AI auto-fix tier.
//
// Design contract (this is the moat — read before editing):
//  1. Every edit operates on the RAW file text via a capture-group regex, so the
//     surrounding bytes are preserved exactly. We never substitute an illustrative
//     "safe pattern" for a matched line — that can corrupt a file.
//  2. An edit only ever changes the precise dangerous literal it matched
//     (e.g. `true` -> `false`); capture groups carry everything else through
//     unchanged. This makes the result provably non-corrupting.
//  3. A fixer ABSTAINS unless it is certain: it applies only to relevant file
//     types and only to literals it can rewrite exactly. Anything needing human
//     judgement (absence findings, prose) produces no edit.
//  4. Fixes are reproducible: same input -> same edits, every time. No randomness,
//     no AI, no network.
//
// The companion verification (re-scanning the fixed file to confirm the finding
// is gone) lives with the scanner so the engine can prove its own fix worked.

export interface DeterministicEdit {
    /** The fixer that produced this edit. */
    fixerId: string;
    /** 0-based character offset of the matched text in the original content. */
    index: number;
    /** The exact original substring that will be replaced (verbatim). */
    match: string;
    /** The exact replacement substring. */
    replacement: string;
    /** 1-based line number of the match start, for display. */
    line: number;
    /** Human-readable reason for the change. */
    description: string;
}

interface FixerRule {
    id: string;
    description: string;
    /** Global regex with capture groups; group output is reused verbatim. */
    find: RegExp;
    /** Build the replacement from the match; must reuse captured groups so only
     *  the dangerous literal changes. */
    replace: (match: RegExpExecArray) => string;
    /** Only run on files where the fix is meaningful and safe. */
    appliesTo: (file: string) => boolean;
}

const isConfigFile = (file: string): boolean =>
    /\.(json|ya?ml|toml)$/i.test(file) || /(^|\/)\.?mcp(\.|$)|mcp\.json$/i.test(file) || /\.cursor\//i.test(file) || /\.claude\//i.test(file);

// The registry. Each entry is a precise, structure-preserving transform for a
// concrete dangerous literal. Add a fixer here only when the edit is exact.
const FIXERS: FixerRule[] = [
    {
        id: 'mcp-disable-auto-approve',
        description: 'Disable automatic approval so tool calls require review.',
        // Matches "autoApprove": true / auto_approve: true (JSON or YAML), keeping
        // the key, quotes, colon, and spacing exactly; only true -> false.
        find: /("?\bauto[_-]?approve"?\s*[:=]\s*)true\b/gi,
        replace: (m) => `${m[1]}false`,
        appliesTo: isConfigFile,
    },
    {
        id: 'mcp-restrict-wildcard-permissions',
        description: 'Replace wildcard permissions with least-privilege read access.',
        // Matches "permissions": ["*"] / "scopes": ["*"], preserving the key and
        // brackets; only the "*" element is narrowed.
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

/**
 * Compute every deterministic edit available for a file. Pure and reproducible:
 * the same (file, content) always yields the same edits in the same order.
 */
export function computeDeterministicEdits(file: string, content: string): DeterministicEdit[] {
    const edits: DeterministicEdit[] = [];
    for (const fixer of FIXERS) {
        if (!fixer.appliesTo(file)) continue;
        // Fresh regex per file to reset lastIndex deterministically.
        const re = new RegExp(fixer.find.source, fixer.find.flags.includes('g') ? fixer.find.flags : `${fixer.find.flags}g`);
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
            const replacement = fixer.replace(match);
            // Abstain on a no-op (defensive: never record an edit that changes nothing).
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
            if (match.index === re.lastIndex) re.lastIndex += 1; // guard against zero-width
        }
    }
    return edits.sort((a, b) => a.index - b.index);
}

export interface DeterministicFixResult {
    fixed: string;
    /** Edits that were verified and applied. */
    applied: DeterministicEdit[];
    /** Edits skipped because the source had drifted (anchor no longer matched). */
    skipped: DeterministicEdit[];
    /** True when re-computing edits on the fixed content yields none (self-check). */
    residualClear: boolean;
}

/**
 * Apply edits by exact, verified splicing. Each edit is re-checked against the
 * current text at its offset before being applied; if the anchor no longer
 * matches (overlap or drift), the edit is skipped rather than risk corruption.
 * Applied back-to-front so earlier offsets stay valid.
 */
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
    applied.reverse(); // back to source order for display
    // Self-check: a correct structural fix leaves no residual dangerous literal.
    const residualClear = computeDeterministicEdits(file, fixed).length === 0;
    return { fixed, applied, skipped, residualClear };
}
