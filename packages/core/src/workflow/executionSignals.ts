/**
 * Shared execution signals for the workflow-escalation rule and workflow
 * inference, so both layers read prompt text the same way.
 */

// A bare "bash" is not a shell sink: it names a language in every ```bash code
// fence and in prose ("bash scripts"). Running something is: bash -c, a
// bash/shell tool, bash <script>.sh, "run the ... shell commands".
export const SHELL_INVOCATION = new RegExp([
    String.raw`\b(?:ba|z)?sh\s+-[a-z]*c\b`,                                   // bash -c, sh -lc
    String.raw`\b(?:bash|shell)\s+tool\b`,                                    // a bash/shell tool
    String.raw`\b(?:with|using|via|through)\s+(?:a\s+)?(?:bash|shell)\b`,      // execute ... with bash
    String.raw`"command"\s*:\s*"(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh"`,           // MCP/JSON launcher
].join('|'), 'i');

// "Run the deployment shell commands": weak on its own (an ops prompt that
// runs diagnostics on request), a sink when the same text also makes the
// agent autonomous, routes tools, or removes approval.
export const SHELL_COMMANDS_PHRASE = /\b(?:run|execute)\s+(?:the\s+|any\s+|all\s+)?(?:[\w-]+\s+){0,2}shell\s+commands?\b/i;

// "override the default colour" and "bypass the cache" are not escalation;
// overriding or bypassing a control is.
export const ESCALATING_OVERRIDE = /\boverride\s+(?:the\s+|any\s+|all\s+|its\s+|your\s+)?(?:previous\s+|system\s+|safety\s+)?(?:instructions?|system|safety|approvals?|restrictions?|guardrails?|polic(?:y|ies)|permissions?)\b/i;
export const ESCALATING_BYPASS = /\bbypass(?:es|ing)?\s+(?:the\s+|any\s+|all\s+)?(?:\w+\s+)?(?:approvals?|restrictions?|guardrails?|safety|security|checks?|filters?|sandbox(?:ing)?|permissions?|reviews?|auth(?:entication|orization)?|routing|controls?)\b/i;

// A declared human or scope control: the instructions ask before acting, or
// limit the shell tool to named commands.
export const DECLARED_CONTROL_PATTERNS = [
    /\b(?:ask|asks|asking)\s+(?:the\s+user\s+)?(?:for\s+)?(?:explicit\s+)?(?:confirmation|approval|permission)\b/i,
    /\b(?:ask|check|confirm)\s+with\s+the\s+user\b/i,
    /\bask\s+the\s+user\s+before\b/i,
    /\b(?:require|requires|required|wait\s+for)\s+(?:explicit\s+|human\s+|user\s+)?(?:approval|confirmation)\b/i,
    /\bhuman[-\s]in[-\s]the[-\s]loop\b/i,
    /^allowed-tools:\s*["']?Bash\(/im,
];

export function hasDeclaredControl(text: string): boolean {
    return DECLARED_CONTROL_PATTERNS.some(pattern => pattern.test(text));
}

/** ```bash / ~~~sh fence lines name a language; they are not instructions. */
export function stripCodeFenceLanguage(text: string): string {
    return text.replace(/^(\s*(?:```|~~~))[\w+-]+/gm, '$1');
}
