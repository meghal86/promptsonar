// Behaviour checks for scripts and agent instructions (credential exfiltration,
// download-and-execute, destructive commands, approval bypass, ...), shared by
// the LSP server. Pure: the caller passes the scanner result, so this is unit
// tested without VS Code or the parser grammars.

const SCRIPT_EXTENSION = /\.(?:py|js|jsx|ts|tsx|mjs|cjs|sh|bash|zsh)$/i;

/** Scripts whose behaviour is checked (as the CLI does). */
export function isScriptFile(filePath: string): boolean {
    return SCRIPT_EXTENSION.test(filePath.replace(/[?#].*$/, ''));
}

export interface ThreatLike {
    ruleId: string;
    severity: 'critical' | 'high' | 'medium';
    line: number;
    column: number;
    message: string;
    source: string;
    sink: string;
    quotedExample?: boolean;
}

export interface ThreatDiagnostic {
    /** 0-based, as LSP expects. */
    line: number;
    character: number;
    level: 'error' | 'warning';
    code: string;
    message: string;
}

/** One diagnostic per threat: CRITICAL/HIGH are errors, MEDIUM a warning. */
export function threatDiagnostics(threats: ThreatLike[], remediation: Record<string, string>): ThreatDiagnostic[] {
    return threats.map(threat => {
        let message = `[PromptSonar] ${threat.ruleId} (${threat.severity.toUpperCase()})\n${threat.message}`;
        message += `\n${threat.source} reaches ${threat.sink}.`;
        if (threat.quotedExample) message += '\nQuoted as an example of an attack, so reported as MEDIUM.';
        if (remediation[threat.ruleId]) message += `\nFix: ${remediation[threat.ruleId]}`;
        message += `\nDocs: https://github.com/meghal86/promptsonar/blob/main/docs/rules.md#${threat.ruleId}`;
        return {
            line: Math.max(0, threat.line - 1),
            character: Math.max(0, threat.column - 1),
            level: threat.severity === 'medium' ? 'warning' : 'error',
            code: threat.ruleId,
            message,
        };
    });
}
