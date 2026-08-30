import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import ignore, { Ignore } from 'ignore';
import {
    parseFile,
    evaluatePrompt,
    RuleResult,
    loadWaivers,
    getActiveWaivers,
    getActiveSuppressions,
    getWaiverSuppressions,
    isFindingSuppressed,
    normalizeRuleId,
    Suppression,
    FindingWorkflow,
    inferWorkflowForFinding,
    auditMcpConfig,
    McpFinding,
    normalizeMcpFindingContextual,
    scanContentForSecrets,
    inferArtifactKind,
    inferExecutionIntent,
    type ArtifactKind,
    type ExecutionIntent,
    type CanonicalIssueContext,
} from '@promptsonar/core';
import { formatToSarif } from '@promptsonar/core/dist/formatter/sarif';

export interface ScanResult {
    filePath: string;
    overall_score: number;
    status: 'pass' | 'warn' | 'fail';
    pillar_scores: Record<string, number>;
    findings_count: number;
    executive_summary?: ScanExecutiveSummary;
    total_findings_count?: number;
    unique_findings_count?: number;
    repeated_findings_count?: number;
    summarized_findings_count?: number;
    findings: ScanFinding[];
    scan_summary?: ScanSummary;
}

export interface ScanExecutiveSummary {
    overall_risk: 'critical' | 'high' | 'medium' | 'low' | 'none';
    finding_counts: Record<string, number>;
    highest_priority_findings: Array<{
        rule_id: string;
        severity: string;
        artifactKind?: ArtifactKind;
        line: number;
        message: string;
    }>;
    estimated_fix_effort: 'Quick' | 'Moderate' | 'Large';
}

export interface ScanSummary {
    files_scanned: number;
    files_skipped: number;
    skipped_reasons: Record<string, number>;
    findings_total: number;
    findings_unique: number;
    findings_repeated: number;
    findings_summarized: number;
}

export interface ScanFinding {
    rule_id: string;
    category: string;
    severity: string;
    line: number;
    column: number;
    message: string;
    fix: string;
    owasp_ref: string;
    owasp: string;
    recommendation: string;
    evidence: string;
    evidenceKind?: 'direct' | 'absence';
    scopeLabel?: string;
    missingRequirement?: string;
    scopeStartLine?: number;
    scopeEndLine?: number;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    why: string;
    risk: string;
    docs_url: string;
    waived: boolean;
    instance_count?: number;
    workflow?: FindingWorkflow;
    context?: CanonicalIssueContext;
    artifactKind?: ArtifactKind;
    executionIntent?: ExecutionIntent;
    suppression_reason?: string;
    suppression_source?: string;
}

interface WorkspaceIgnoreMatcher {
    rootPath: string;
    matcher: Ignore;
}

// Maps rule IDs to their OWASP references
function getOwaspRef(ruleId: string): string {
    if (
        ruleId.startsWith('sec_owasp_llm01') ||
        ruleId.startsWith('sec_unicode') ||
        ruleId === 'sec_unbounded_persona' ||
        ruleId === 'sec_base64_encoded_payload' ||
        ruleId === 'sec_homoglyph_evasion' ||
        ruleId === 'sec_zero_width_injection'
    ) return 'LLM01';
    if (ruleId.startsWith('sec_owasp_llm02')) return 'LLM02';
    // OWASP LLM Top 10 (2025). LLM06 Excessive Agency covers untrusted input
    // reaching privileged execution, tools acting without approval, and
    // over-broad tool/data access.
    if (
        ruleId === 'sec_workflow_escalation' ||
        ruleId === 'sec_privileged_sink_access' ||
        ruleId === 'sec_mcp_tool_poisoning' ||
        ruleId === 'sec_unbounded_access'
    ) return 'LLM06';
    // LLM08 Vector and Embedding Weaknesses: untrusted input steering retrieval.
    if (ruleId === 'sec_rag_injection') return 'LLM08';
    // LLM10 Unbounded Consumption: prompt size beyond the configured budget.
    if (ruleId === 'eff_token_budget' || ruleId === 'eff_token_bloat') return 'LLM10';
    return '';
}

// Map rule_id to its category
function getCategoryForRule(ruleId: string): string {
    if (ruleId.startsWith('sec_')) return 'security';
    if (ruleId.startsWith('clarity_')) return 'clarity';
    if (ruleId.startsWith('struct_')) return 'structure';
    if (ruleId.startsWith('bp_')) return 'best_practices';
    if (ruleId.startsWith('consist_')) return 'consistency';
    if (ruleId.startsWith('eff_')) return 'efficiency';
    if (ruleId.startsWith('ethics_')) return 'ethics';
    return 'security';
}

// Map severity → approximate penalty for pillar score display
function getPenaltyForSeverity(severity: string): number {
    switch (severity) {
        case 'critical': return 30;
        case 'high': return 20;
        case 'medium': return 10;
        case 'low': return 5;
        default: return 5;
    }
}

function getConfidenceForFinding(ruleId: string, severity: string): ScanFinding['confidence'] {
    if (severity === 'critical') return 'VERY_HIGH';
    if (
        ruleId === 'sec_base64_encoded_payload' ||
        ruleId === 'sec_zero_width_injection' ||
        ruleId === 'sec_homoglyph_evasion' ||
        ruleId.startsWith('sec_owasp_llm02') ||
        ruleId.startsWith('MCP-')
    ) return 'HIGH';
    if (severity === 'high' || severity === 'medium') return 'MEDIUM';
    return 'LOW';
}

function getRuleDocsUrl(ruleId: string): string {
    return `https://github.com/meghal86/promptsonar/blob/main/docs/rules.md#${ruleId.toLowerCase()}`;
}

function getRiskExplanation(ruleId: string): string {
    if (ruleId === 'sec_owasp_llm01_injection') {
        return 'User-controlled text may override system instructions, extract hidden prompts, or bypass intended safety boundaries.';
    }
    if (ruleId === 'sec_zero_width_injection') {
        return 'Invisible Unicode can hide jailbreak text from reviewers while changing what the model or scanner sees.';
    }
    if (ruleId === 'sec_homoglyph_evasion') {
        return 'Lookalike Unicode characters can bypass ASCII-only filters and conceal malicious instructions.';
    }
    if (ruleId === 'sec_base64_encoded_payload') {
        return 'Encoded instructions can smuggle jailbreak payloads through review and validation layers.';
    }
    if (ruleId.startsWith('sec_owasp_llm02')) {
        return 'Secrets or sensitive data in prompt text can leak through logs, responses, screenshots, or repository history.';
    }
    if (ruleId === 'sec_unbounded_access') {
        return 'Over-broad tool or data access gives an agent more authority than the task requires.';
    }
    if (ruleId === 'sec_rag_injection') {
        return 'Raw retrieval queries can let untrusted content steer context selection or poison model inputs.';
    }
    if (ruleId === 'sec_unbounded_persona') {
        return 'Unbounded role-play prompts can weaken instruction hierarchy and make policy bypass easier.';
    }
    return 'This pattern weakens prompt reliability, auditability, or downstream safety controls.';
}

function getDeterministicRecommendation(ruleId: string, fallback: string): string {
    if (ruleId === 'sec_owasp_llm01_injection') {
        return 'Treat user-provided text as untrusted content. Place it in a clearly delimited data block and state that it cannot modify system instructions.';
    }
    if (ruleId === 'sec_zero_width_injection') {
        return 'Normalize prompt strings before scanning and remove U+200B, U+200C, U+200D, and U+FEFF characters.';
    }
    if (ruleId === 'sec_homoglyph_evasion') {
        return 'Reject or normalize non-Latin homoglyph characters in prompt strings unless the language requirement is explicit.';
    }
    if (ruleId === 'sec_base64_encoded_payload') {
        return 'Do not embed encoded instructions in prompt strings. Decode, review, and store only plain-text approved instructions.';
    }
    if (ruleId.startsWith('sec_owasp_llm02')) {
        return 'Move secrets to environment variables or a secret manager, rotate exposed credentials, and keep only placeholders in prompt templates.';
    }
    if (ruleId === 'sec_unbounded_access') {
        return 'Scope tools to the minimum required paths, commands, tables, or APIs. Deny shell/filesystem access unless explicitly needed.';
    }
    if (ruleId === 'sec_rag_injection') {
        return 'Validate and sanitize retrieval queries before use. Pass only a validated_query object into retrieval code.';
    }
    return fallback || 'Review the prompt and apply the documented safer pattern.';
}

const ABSENCE_REQUIREMENTS: Record<string, string> = {
    bp_missing_persona: 'No bounded role or persona requirement was found within that block.',
    bp_missing_few_shot: 'No example input/output behavior was found within that block.',
    bp_missing_cot: 'No verification requirement or reviewable decision criteria were found within that block.',
    struct_missing_format_enforcer: 'No required output format or schema enforcement was found within that block.',
};

function evidenceKindForRule(ruleId: string, explicit?: 'direct' | 'absence'): 'direct' | 'absence' {
    return explicit || (ABSENCE_REQUIREMENTS[ruleId] ? 'absence' : 'direct');
}

function lineLooksRelevant(line: string, ruleId: string): boolean {
    const lower = line.toLowerCase();
    if (ruleId.includes('llm01') || ruleId.includes('injection')) {
        return /ignore|disregard|forget|dan|developer mode|system prompt|previous instructions|jailbreak|bypass/.test(lower);
    }
    if (ruleId.includes('pii')) {
        return /sk-|api[_ -]?key|secret|token|password|bearer|ssn|credit card|\d{3}-\d{2}-\d{4}/.test(lower);
    }
    if (ruleId.includes('zero_width')) {
        return /[\u200B-\u200D\uFEFF]/.test(line);
    }
    if (ruleId.includes('homoglyph') || ruleId.includes('unicode')) {
        return /[^\x00-\x7F]/.test(line);
    }
    if (ruleId.includes('unbounded_access')) {
        return /all files|any file|entire|admin|root|shell|network|database|db/.test(lower);
    }
    if (ruleId.includes('rag')) {
        return /user_input|raw user|retrieval|search|query|context/.test(lower);
    }
    return false;
}

function truncateEvidence(line: string, maxLength: number = 180): string {
    const normalized = line.trim().replace(/\s+/g, ' ');
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
}

const SECRET_EVIDENCE_PATTERNS: RegExp[] = [
    /sk-(?:live|test|proj|ant)-[A-Za-z0-9_-]{8,}/g,
    /ghp_[A-Za-z0-9]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /Bearer\s+[A-Za-z0-9._-]{16,}/g,
    /((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{12,}/gi,
];

function redactSecretEvidenceLine(line: string, matchedText?: string): string {
    let redacted = line;
    if (matchedText) {
        redacted = redacted.split(matchedText).join('[REDACTED]');
    }
    redacted = SECRET_EVIDENCE_PATTERNS.reduce((current, pattern) => {
        pattern.lastIndex = 0;
        if (pattern.source.startsWith('((?:api')) {
            return current.replace(pattern, '$1[REDACTED]');
        }
        return current.replace(pattern, '[REDACTED]');
    }, redacted);
    return truncateEvidence(redacted);
}

function revealInvisibleUnicode(line: string): string {
    return line
        .replace(/\u200B/g, '[U+200B ZERO WIDTH SPACE]')
        .replace(/\u200C/g, '[U+200C ZERO WIDTH NON-JOINER]')
        .replace(/\u200D/g, '[U+200D ZERO WIDTH JOINER]')
        .replace(/\uFEFF/g, '[U+FEFF ZERO WIDTH NO-BREAK SPACE]');
}

function artifactKindForPath(filePath: string): ArtifactKind {
    if (isRecognizedMcpConfig(filePath)) return 'mcp_config';
    return inferArtifactKind(filePath);
}

const WORKFLOW_SECURITY_REMEDIATION = [
    'Restrict workflow permissions to least privilege',
    'protect environments',
    'avoid exposing secrets to pull_request or other untrusted triggers',
    'scope secrets to the minimum jobs and environments',
    'pin actions to trusted versions',
    'and validate shell inputs before use.',
].join(', ');

const AGENT_SECURITY_REMEDIATION = [
    'Constrain the agent instructions to approved tools and paths',
    'require explicit approval before shell, network, filesystem, or secret access',
    'document denied actions',
    'and keep credentials out of the instruction file.',
].join(', ');

const AGENT_QUALITY_REMEDIATION = [
    'Write the agent instruction with a bounded role, allowed scope, denied actions, review criteria, and a short verification checklist.',
].join(' ');

const REFERENCE_SECURITY_REMEDIATION = [
    'Treat this as reference/test context, not production reachable unless wired into runtime',
    'use placeholders for example secrets',
    'and add a note that copying this into production instructions or automation requires scoped credentials and review.',
].join(', ');

const REFERENCE_SECURITY_OBSERVATION = [
    'Reference/test context only: keep this example isolated from runtime prompts or automation',
    'use placeholders for secrets',
    'and add production controls before wiring it into executable agent instructions.',
].join(', ');

function isAgentInstructionArtifact(artifactKind: ArtifactKind): boolean {
    return artifactKind === 'claude' || artifactKind === 'agents' || artifactKind === 'agent' || artifactKind === 'skill';
}

function isPromptQualityRule(ruleId: string): boolean {
    return /^(?:bp_|clarity_|struct_|consist_|eff_)/.test(ruleId);
}

function isReferenceOrTestIntent(executionIntent: ExecutionIntent): boolean {
    return executionIntent === 'reference' || executionIntent === 'test_fixture';
}

function isReferenceOrTestArtifact(artifactKind: ArtifactKind, executionIntent: ExecutionIntent): boolean {
    return isReferenceOrTestIntent(executionIntent) ||
        artifactKind === 'documentation' ||
        artifactKind === 'example' ||
        artifactKind === 'test' ||
        artifactKind === 'fixture';
}

function displayedSeverityForArtifact(severity: string, category: string, artifactKind: ArtifactKind, executionIntent: ExecutionIntent): string {
    if (isReferenceOrTestArtifact(artifactKind, executionIntent) && category === 'security') return 'low';
    if (isAgentInstructionArtifact(artifactKind) && category === 'efficiency') return 'low';
    return severity;
}

function getRecommendationForArtifact(ruleId: string, fallback: string, artifactKind: ArtifactKind, executionIntent: ExecutionIntent): string {
    if (isReferenceOrTestArtifact(artifactKind, executionIntent) && /^sec_|^MCP-|secret|credential|token|password|api.?key/i.test(`${ruleId} ${fallback}`)) {
        return /secret|credential|token|password|api.?key/i.test(`${ruleId} ${fallback}`)
            ? REFERENCE_SECURITY_REMEDIATION
            : REFERENCE_SECURITY_OBSERVATION;
    }
    if (artifactKind === 'workflow' && (
        ruleId.startsWith('sec_owasp_llm02') ||
        ruleId.startsWith('sec_workflow') ||
        /shell|privileged|sink|secret|credential|token|password/i.test(`${ruleId} ${fallback}`)
    )) {
        return WORKFLOW_SECURITY_REMEDIATION;
    }
    if (isAgentInstructionArtifact(artifactKind) && isPromptQualityRule(ruleId)) {
        return AGENT_QUALITY_REMEDIATION;
    }
    if (isAgentInstructionArtifact(artifactKind) && /secret|credential|token|password|api.?key|pat|pii|shell|privileged|sink|workflow|access/i.test(`${ruleId} ${fallback}`)) {
        return AGENT_SECURITY_REMEDIATION;
    }
    return getDeterministicRecommendation(ruleId, fallback);
}

function artifactDisplayName(artifactKind: ArtifactKind, executionIntent: ExecutionIntent): string {
    if (artifactKind === 'workflow') return 'workflow YAML';
    if (artifactKind === 'claude') return 'CLAUDE.md agent instruction file';
    if (artifactKind === 'agents' || artifactKind === 'agent') return 'AGENTS.md agent instruction file';
    if (artifactKind === 'skill') return 'SKILL.md skill instruction file';
    if (artifactKind === 'mcp_config' || artifactKind === 'mcp' || artifactKind === 'mcp_server') return 'MCP configuration';
    if (artifactKind === 'deployment_config') return 'deployment configuration';
    if (artifactKind === 'fixture') return 'fixture file';
    if (artifactKind === 'test' || executionIntent === 'test_fixture') return 'test/spec fixture';
    if (executionIntent === 'reference') return 'reference document';
    if (artifactKind === 'prompt') return 'executable prompt';
    return 'source file';
}

function artifactInstructionNoun(artifactKind: ArtifactKind, executionIntent: ExecutionIntent): string {
    if (artifactKind === 'workflow') return 'workflow YAML';
    if (artifactKind === 'claude') return 'CLAUDE.md agent instructions';
    if (artifactKind === 'agents' || artifactKind === 'agent') return 'AGENTS.md agent instructions';
    if (artifactKind === 'skill') return 'SKILL.md skill instructions';
    if (artifactKind === 'mcp_config' || artifactKind === 'mcp' || artifactKind === 'mcp_server') return 'MCP configuration';
    if (artifactKind === 'fixture') return 'fixture file';
    if (artifactKind === 'test' || executionIntent === 'test_fixture') return 'test/spec fixture';
    if (executionIntent === 'reference') return 'reference document';
    if (artifactKind === 'prompt') return 'prompt';
    return 'source file';
}

function displayedRuleMessage(message: string, artifactKind: ArtifactKind, executionIntent: ExecutionIntent, category: string): string {
    const artifact = artifactDisplayName(artifactKind, executionIntent);
    const noun = artifactInstructionNoun(artifactKind, executionIntent);
    let displayed = message
        .replace(/\bfound in prompt\b/gi, `found in ${artifact}`)
        .replace(/\bfound in source\b/gi, `found in ${artifact}`)
        .replace(/\bprompt instructions\b/gi, noun)
        .replace(/\bthis prompt\b/gi, `this ${noun}`)
        .replace(/\bthe prompt\b/gi, `the ${noun}`);
    if (artifactKind !== 'prompt' && ['clarity', 'structure', 'best_practices', 'consistency', 'efficiency'].includes(category)) {
        const plural = /\binstructions$/.test(noun);
        displayed = displayed
            .replace(/^Prompt asks\b/i, `${noun} ${plural ? 'ask' : 'asks'}`)
            .replace(/^Prompt lacks\b/i, `${noun} ${plural ? 'lack' : 'lacks'}`)
            .replace(/^Prompt is missing\b/i, `${noun} ${plural ? 'are' : 'is'} missing`)
            .replace(/\bprompts are\b/gi, `${noun} are`);
        if (plural) displayed = displayed.replace(/\bbut lacks\b/gi, 'but lack');
    }
    return displayed;
}

function secretFindingMessage(secretName: string, artifactKind: ArtifactKind, executionIntent: ExecutionIntent): string {
    return `Potential Sensitive Information Disclosure (OWASP LLM02): Hardcoded ${secretName} found in ${artifactDisplayName(artifactKind, executionIntent)}.`;
}

function secretFindingWhy(secretName: string, artifactKind: ArtifactKind, executionIntent: ExecutionIntent): string {
    if (artifactKind === 'workflow') {
        return `A hardcoded ${secretName} in workflow YAML can leak through job logs, pull request triggers, or deployment steps.`;
    }
    if (isAgentInstructionArtifact(artifactKind)) {
        return `A hardcoded ${secretName} in agent instructions can be reused by coding agents, logs, shell commands, or tool calls.`;
    }
    if (isReferenceOrTestArtifact(artifactKind, executionIntent)) {
        return `A ${secretName} in reference/test context is not production reachable unless this file is wired into runtime instructions or automation.`;
    }
    return `A hardcoded ${secretName} in source can leak through logs, prompts, responses, or repository history.`;
}

function locateEvidence(
    content: string,
    startLine: number,
    ruleId: string,
    matchedText?: string,
): { evidence: string; line: number; column: number } {
    const lines = content.split(/\r?\n/);

    // 1. Exact location of the text the rule matched.
    const needle = (matchedText || '').split(/\r?\n/).map(value => value.trim()).find(value => value.length > 0);
    if (needle) {
        const index = lines.findIndex(value => value.includes(needle));
        if (index >= 0) {
            const line = ruleId.includes('zero_width')
                ? revealInvisibleUnicode(lines[index])
                : lines[index];
            return {
                evidence: truncateEvidence(line),
                line: index + 1,
                column: Math.max(1, lines[index].indexOf(needle) + 1),
            };
        }
    }

    // 2. First line that looks relevant for this rule.
    const relevantIndex = lines.findIndex(value => lineLooksRelevant(value, ruleId));
    if (relevantIndex >= 0) {
        const line = ruleId.includes('zero_width')
            ? revealInvisibleUnicode(lines[relevantIndex])
            : lines[relevantIndex];
        return { evidence: truncateEvidence(line), line: relevantIndex + 1, column: 1 };
    }

    // 3. Fall back to where the prompt block starts.
    const fallback = lines[Math.max(0, startLine - 1)]
        || lines.find(value => value.trim().length > 0)
        || '';
    return { evidence: truncateEvidence(fallback), line: Math.max(1, startLine), column: 1 };
}

export function loadRepositoryIgnorePatterns(scanRoot: string): string[] {
    const promptsonarIgnorePath = path.join(scanRoot, '.promptsonarignore');
    if (!fs.existsSync(promptsonarIgnorePath)) return [];
    return fs.readFileSync(promptsonarIgnorePath, 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
}

function extractInlineSuppressions(content: string): Map<number, Set<string>> {
    const suppressions = new Map<number, Set<string>>();
    const lines = content.split(/\r?\n/);
    const add = (lineNumber: number, ruleId: string) => {
        const normalizedRule = normalizeRuleId(ruleId) || ruleId;
        const existing = suppressions.get(lineNumber) || new Set<string>();
        existing.add(normalizedRule);
        suppressions.set(lineNumber, existing);
    };

    lines.forEach((line, index) => {
        const currentLine = index + 1;
        const nextLineMatch = line.match(/promptsonar-ignore-next-line\s+([A-Za-z0-9_-]+)/);
        if (nextLineMatch) {
            add(currentLine + 1, nextLineMatch[1]);
        }

        const sameLineMatch = line.match(/promptsonar-ignore\s+([A-Za-z0-9_-]+)/);
        if (sameLineMatch && !line.includes('promptsonar-ignore-next-line')) {
            add(currentLine, sameLineMatch[1]);
        }
    });

    return suppressions;
}

function isInlineSuppressed(ruleId: string, promptStartLine: number, inlineSuppressions: Map<number, Set<string>>): boolean {
    const normalizedRule = normalizeRuleId(ruleId) || ruleId;
    return Boolean(inlineSuppressions.get(promptStartLine)?.has(normalizedRule));
}

function findSuppressionFiles(targetPath: string, explicitWaiverFile?: string): string[] {
    const files: string[] = [];
    if (explicitWaiverFile) {
        files.push(path.resolve(explicitWaiverFile));
        return files;
    }

    const resolvedTarget = path.resolve(targetPath);
    const root = fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()
        ? resolvedTarget
        : path.dirname(resolvedTarget);

    for (const fileName of ['.promptsonar-waivers.yaml', '.promptsonarignore']) {
        const candidate = path.join(root, fileName);
        if (fs.existsSync(candidate)) files.push(candidate);
    }

    return files;
}

function loadPromptSonarIgnore(filePath: string): Suppression[] {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
        .map(pattern => ({
            path: pattern,
            reason: 'Matched .promptsonarignore path pattern',
            source: filePath,
        }));
}

function loadWorkspaceIgnoreMatchers(rootPath: string): WorkspaceIgnoreMatcher[] {
    const matchers: WorkspaceIgnoreMatcher[] = [];

    for (const fileName of ['.gitignore', '.promptsonarignore']) {
        const ignorePath = path.join(rootPath, fileName);
        if (!fs.existsSync(ignorePath)) continue;
        matchers.push({
            rootPath,
            matcher: ignore().add(fs.readFileSync(ignorePath, 'utf-8')),
        });
    }

    return matchers;
}

function isIgnoredByWorkspaceIgnore(filePath: string, matchers: WorkspaceIgnoreMatcher[]): boolean {
    return matchers.some(({ rootPath, matcher }) => {
        const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
        if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return false;
        }

        return matcher.ignores(relativePath);
    });
}

// Compute per-pillar scores from scan findings
function computePillarScores(findings: ScanFinding[]): Record<string, number> {
    const pillars: Record<string, number> = {
        security: 100,
        clarity: 100,
        structure: 100,
        best_practices: 100,
        consistency: 100,
        efficiency: 100,
        ethics: 100,
    };

    for (const f of findings) {
        const cat = getCategoryForRule(f.rule_id);
        if (cat in pillars) {
            pillars[cat] = Math.max(0, pillars[cat] - getPenaltyForSeverity(f.severity));
        }
    }

    return pillars;
}

const SUPPORTED_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx',
    '.py',
    '.rs',
    '.java',
    '.go',
    '.cs',
    '.prompt', '.ai', '.chat',
    '.json', '.yml', '.yaml',
    '.md', '.txt',
];

const SUPPORTED_MARKDOWN_PROMPT_FILES = new Set([
    'skill.md',
    'skills.md',
    'agent.md',
    'agents.md',
    'claude.md',
    'prompt.md',
]);

// Default ignores cover dependency, build, cache, and binary artifacts only.
// User content directories (docs/, tests/, examples/) are scanned by default;
// repo-specific exclusions belong in that repository's .promptsonarignore.
const DEFAULT_IGNORE_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/.vercel/**',
    '**/.cache/**',
    '**/.pytest_cache/**',
    '**/.mypy_cache/**',
    '**/.tox/**',
    '**/.git/**',
    '**/.hg/**',
    '**/.svn/**',
    '**/.idea/**',
    '**/.vscode-test/**',
    '**/venv/**',
    '**/.venv/**',
    '**/env/**',
    '**/site-packages/**',
    '**/dist-packages/**',
    '**/__pycache__/**',
    '**/vendor/**',
    '**/target/**',
    '**/tmp/**',
    '**/logs/**',
    '**/*.log',
    '**/*.promptsonar-fixed',
    '**/*.min.js',
    '**/*.min.css',
    '**/*.bundle.js',
    '**/*.bundle.css',
    '**/*.chunk.js',
    '**/*.compiled.js',
    '**/*.hot-update.js',
    '**/*.map',
    '**/*.d.ts.map',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.webp',
    '**/*.svg',
    '**/*.ico',
    '**/*.ttf',
    '**/*.otf',
    '**/*.woff',
    '**/*.woff2',
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/yarn.lock',
    '**/bun.lockb',
    '**/.promptsonar-waivers.yaml',
    '**/.promptsonarignore',
    '**/.promptsonar-policy.yaml',
];

const WORKFLOW_RELEVANT_PATTERNS = [
    'prompts/**/*',
    'agents/**/*',
    'ai/**/*',
    'rag/**/*',
    '**/*.prompt.*',
];

const MAX_FILE_SIZE_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILES = 2000;
const MAX_FINDINGS_PER_FILE = 50;
const MAX_RENDERED_CRITICAL_HIGH_PER_FILE = 100;
const MAX_LOW_PER_CATEGORY_PER_FILE = 20;
const MAX_BEST_PRACTICE_PER_FILE = 10;

function getLanguageForExt(ext: string): string {
    switch (ext) {
        case '.py': return 'python';
        case '.ts': case '.tsx': case '.js': case '.jsx': return 'typescript';
        case '.go': return 'go';
        case '.java': return 'java';
        case '.rs': return 'rust';
        case '.cs': return 'c_sharp';
        default: return '';
    }
}

function isRecognizedMcpConfig(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith('/mcp.json')
        || normalized.endsWith('/.mcp.json')
        || normalized.endsWith('/.vscode/mcp.json')
        || normalized.endsWith('/.cursor/mcp.json')
        || normalized.endsWith('/claude_desktop_config.json')
        || normalized === 'mcp.json'
        || normalized === '.mcp.json'
        || normalized === 'claude_desktop_config.json';
}

async function collectCandidateFiles(resolvedPath: string, ignore: string[]): Promise<string[]> {
    const patterns = SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
    // dot: true so AI configs in dot directories (.cursor/mcp.json,
    // .vscode/mcp.json, .claude/**, .github/workflows) are discovered; the
    // ignore list keeps .git, caches, and dependency directories out.
    const files = await fg(patterns, {
        cwd: resolvedPath,
        absolute: true,
        dot: true,
        ignore,
    });

    const markdownPromptFiles = await fg(['**/*.md'], {
        cwd: resolvedPath,
        absolute: true,
        dot: true,
        ignore,
    });
    files.push(
        ...markdownPromptFiles.filter(filePath =>
            SUPPORTED_MARKDOWN_PROMPT_FILES.has(path.basename(filePath).toLowerCase())
        )
    );
    files.push(...await fg(WORKFLOW_RELEVANT_PATTERNS, {
        cwd: resolvedPath,
        absolute: true,
        onlyFiles: true,
        dot: true,
        ignore,
    }));

    return Array.from(new Set(files)).sort();
}

function sortFindings(findings: ScanFinding[]): ScanFinding[] {
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...findings].sort((a, b) => {
        const priorityDelta = findingPriorityBand(a) - findingPriorityBand(b);
        if (priorityDelta !== 0) return priorityDelta;
        const severityDelta = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
        if (severityDelta !== 0) return severityDelta;
        const ruleDelta = a.rule_id.localeCompare(b.rule_id);
        if (ruleDelta !== 0) return ruleDelta;
        return a.line - b.line;
    });
}

function findingPriorityBand(finding: Pick<ScanFinding, 'category' | 'severity' | 'context' | 'workflow'>): number {
    if (finding.severity === 'critical' || finding.context?.verdict === 'vulnerability') return 0;
    if (finding.context?.verdict === 'risky_configuration' || (finding.category === 'security' && finding.severity === 'high')) return 1;
    if (finding.context?.verdict === 'capability_review' || finding.category === 'security') return 2;
    if (finding.context?.verdict === 'needs_more_context') return 3;
    if (finding.context?.verdict === 'hardening_suggestion') return 4;
    if (['clarity', 'structure', 'best_practices', 'consistency', 'efficiency'].includes(finding.category)) return 5;
    return 4;
}

function executiveSummaryForFindings(findings: ScanFinding[]): ScanExecutiveSummary {
    const activeFindings = findings.filter(finding => !finding.waived);
    const severityOrder = ['critical', 'high', 'medium', 'low'];
    const findingCounts = activeFindings.reduce((acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const overallRisk = (severityOrder.find(severity => findingCounts[severity] > 0) || 'none') as ScanExecutiveSummary['overall_risk'];
    const highestPriorityFindings = sortFindings(activeFindings).slice(0, 3).map(finding => ({
        rule_id: finding.rule_id,
        severity: finding.severity,
        artifactKind: finding.artifactKind,
        line: finding.line,
        message: finding.message,
    }));
    const estimatedFixEffort: ScanExecutiveSummary['estimated_fix_effort'] = activeFindings.some(finding => finding.severity === 'critical')
        ? 'Large'
        : activeFindings.some(finding => finding.severity === 'high' || finding.workflow?.path?.privilegedSinkReached)
            ? 'Moderate'
            : activeFindings.length > 0
                ? 'Quick'
                : 'Quick';

    return {
        overall_risk: overallRisk,
        finding_counts: findingCounts,
        highest_priority_findings: highestPriorityFindings,
        estimated_fix_effort: estimatedFixEffort,
    };
}

function normalizedEvidence(finding: ScanFinding): string {
    return (finding.evidence || finding.message || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
}

function dedupeFindings(filePath: string, findings: ScanFinding[]): { findings: ScanFinding[]; repeatedCount: number } {
    const byKey = new Map<string, ScanFinding>();
    let repeatedCount = 0;

    for (const finding of findings) {
        const key = [
            filePath.replace(/\\/g, '/'),
            finding.rule_id,
            finding.category,
            finding.line || 0,
            normalizedEvidence(finding),
        ].join('|');
        const existing = byKey.get(key);
        if (existing) {
            repeatedCount++;
            existing.instance_count = (existing.instance_count || 1) + 1;
            existing.waived = existing.waived && finding.waived;
            if (!existing.suppression_reason) existing.suppression_reason = finding.suppression_reason;
            if (!existing.suppression_source) existing.suppression_source = finding.suppression_source;
            continue;
        }
        byKey.set(key, { ...finding, instance_count: finding.instance_count || 1 });
    }

    return { findings: sortFindings(Array.from(byKey.values())), repeatedCount };
}

export function dedupeScanFindings(filePath: string, findings: ScanFinding[]): { findings: ScanFinding[]; repeatedCount: number } {
    return dedupeFindings(filePath, findings);
}

function capFindingsForDisplay(findings: ScanFinding[]): { findings: ScanFinding[]; summarizedCount: number } {
    const sorted = sortFindings(findings);
    const criticalHigh = sorted.filter(finding => finding.severity === 'critical' || finding.severity === 'high');
    const displayed: ScanFinding[] = criticalHigh.slice(0, MAX_RENDERED_CRITICAL_HIGH_PER_FILE);
    const effectiveLimit = Math.max(MAX_FINDINGS_PER_FILE, Math.min(criticalHigh.length, MAX_RENDERED_CRITICAL_HIGH_PER_FILE));
    const lowCategoryCounts = new Map<string, number>();

    for (const finding of sorted) {
        if (displayed.includes(finding)) continue;
        if ((finding.severity === 'critical' || finding.severity === 'high') && criticalHigh.length > MAX_RENDERED_CRITICAL_HIGH_PER_FILE) continue;
        if (displayed.length >= effectiveLimit) break;

        if (finding.severity === 'low') {
            const current = lowCategoryCounts.get(finding.category) || 0;
            const categoryLimit = finding.category === 'best_practices'
                ? MAX_BEST_PRACTICE_PER_FILE
                : MAX_LOW_PER_CATEGORY_PER_FILE;
            if (current >= categoryLimit) continue;
            lowCategoryCounts.set(finding.category, current + 1);
        }

        if (displayed.length < effectiveLimit) {
            displayed.push(finding);
        }
    }

    return {
        findings: sortFindings(displayed),
        summarizedCount: Math.max(0, findings.length - displayed.length),
    };
}

export function scoreFromFindings(findings: Array<Pick<ScanFinding, 'severity' | 'category' | 'waived' | 'workflow'>>): number {
    const activeFindings = findings.filter(finding => !finding.waived);
    const severityTotals: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const severityCaps: Record<string, number> = { critical: 80, high: 60, medium: 40, low: 20 };
    const categoryTotals: Record<string, number> = {};
    const categoryCaps: Record<string, number> = {
        security: 85,
        ethics: 40,
        clarity: 25,
        structure: 20,
        best_practices: 15,
        consistency: 15,
        efficiency: 15,
    };

    for (const finding of activeFindings) {
        const penalty = finding.category === 'best_practices'
            ? 0.25
            : finding.severity === 'critical'
                ? 25
                : finding.severity === 'high'
                    ? 12
                    : finding.severity === 'medium'
                        ? 5
                        : 1;
        severityTotals[finding.severity] = (severityTotals[finding.severity] || 0) + penalty;
        categoryTotals[finding.category] = (categoryTotals[finding.category] || 0) + penalty;

        if (finding.workflow?.path?.privilegedSinkReached) {
            categoryTotals.security = (categoryTotals.security || 0) + (finding.workflow.risk === 'critical' ? 20 : 12);
        } else if (finding.workflow?.path?.trustBoundaryCrossed) {
            categoryTotals.security = (categoryTotals.security || 0) + 6;
        }
    }

    const severityPenalty = Object.entries(severityTotals)
        .reduce((total, [severity, value]) => total + Math.min(value, severityCaps[severity] ?? value), 0);
    const categoryPenalty = Object.entries(categoryTotals)
        .reduce((total, [category, value]) => total + Math.min(value, categoryCaps[category] ?? 20), 0);
    let score = Math.max(0, Math.round(100 - Math.min(severityPenalty, categoryPenalty)));

    const criticalCount = activeFindings.filter(finding => finding.severity === 'critical').length;
    const highCount = activeFindings.filter(finding => finding.severity === 'high').length;
    if (criticalCount >= 2) score = Math.min(score, 40);
    else if (criticalCount === 1) score = Math.min(score, 60);
    if (highCount >= 5) score = Math.min(score, 65);
    else if (highCount >= 3) score = Math.min(score, 75);

    if (activeFindings.length >= 1000) score = Math.min(score, 55);
    else if (activeFindings.length >= 500) score = Math.min(score, 65);
    else if (activeFindings.length >= 100) score = Math.min(score, 80);
    else if (activeFindings.length >= 25) score = Math.min(score, 85);
    else if (activeFindings.length >= 10) score = Math.min(score, 90);

    return score;
}

function statusFromFindings(findings: ScanFinding[]): ScanResult['status'] {
    if (findings.some(finding => finding.severity === 'critical' || finding.severity === 'high')) return 'fail';
    if (findings.length > 0) return 'warn';
    return 'pass';
}

function statusFromScoreAndFindings(score: number, findings: ScanFinding[]): ScanResult['status'] {
    if (findings.some(finding => !finding.waived && (finding.severity === 'critical' || finding.severity === 'high'))) return 'fail';
    if (score < 70) return 'fail';
    if (score < 85 || findings.some(finding => !finding.waived)) return 'warn';
    return 'pass';
}

function mapMcpFinding(finding: McpFinding, filePath: string): ScanFinding {
    const contextualFinding = normalizeMcpFindingContextual(finding);
    const recommendation = contextualFinding.fix;
    const workflow = contextualFinding.workflow || inferWorkflowForFinding({
        ruleId: contextualFinding.rule_id,
        severity: contextualFinding.severity,
        text: `${contextualFinding.message}\n${contextualFinding.fix}`,
        filePath,
        message: contextualFinding.message,
    });
    return {
        rule_id: contextualFinding.rule_id,
        category: 'security',
        severity: contextualFinding.severity,
        line: contextualFinding.line || 1,
        column: contextualFinding.column || 1,
        message: contextualFinding.message,
        fix: recommendation,
        recommendation,
        owasp_ref: '',
        owasp: '',
        evidence: contextualFinding.evidence
            ? `${contextualFinding.server ? `server: ${contextualFinding.server}; ` : ''}${contextualFinding.evidence}`
            : (contextualFinding.server ? `server: ${contextualFinding.server}; path: ${contextualFinding.path}` : contextualFinding.path),
        confidence: getConfidenceForFinding(contextualFinding.rule_id, contextualFinding.severity),
        why: contextualFinding.message,
        risk: 'MCP configuration may expose tools, credentials, or execution capability beyond the agent workflow trust boundary.',
        docs_url: getRuleDocsUrl(contextualFinding.rule_id),
        waived: false,
        workflow,
        context: contextualFinding.context,
        artifactKind: 'mcp_config',
        executionIntent: 'executable',
    };
}

export async function scanFiles(targetPath: string, options: {
    verbose?: boolean;
    diffOnly?: boolean;
    waiverFile?: string;
    maxFiles?: number;
    maxFileSizeBytes?: number;
}): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const scanSummary: ScanSummary = {
        files_scanned: 0,
        files_skipped: 0,
        skipped_reasons: {},
        findings_total: 0,
        findings_unique: 0,
        findings_repeated: 0,
        findings_summarized: 0,
    };
    const noteSkipped = (reason: string, count = 1) => {
        scanSummary.files_skipped += count;
        scanSummary.skipped_reasons[reason] = (scanSummary.skipped_reasons[reason] || 0) + count;
    };

    let activeSuppressions: Suppression[] = [];
    for (const suppressionFile of findSuppressionFiles(targetPath, options.waiverFile)) {
        if (path.basename(suppressionFile) === '.promptsonarignore') {
            activeSuppressions.push(...loadPromptSonarIgnore(suppressionFile));
            continue;
        }

        const waiverResult = loadWaivers(suppressionFile);
        if (waiverResult.errors.length > 0 && options.verbose) {
            for (const err of waiverResult.errors) {
                console.warn(`[PromptSonar] Waiver warning: ${err}`);
            }
        }
        activeSuppressions.push(...getWaiverSuppressions(getActiveWaivers(waiverResult.waivers)));
        activeSuppressions.push(...getActiveSuppressions(waiverResult.suppressions));
    }

    // Resolve target
    const resolvedPath = path.resolve(targetPath);
    let files: string[] = [];
    const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
    const maxFileSizeBytes = options.maxFileSizeBytes || MAX_FILE_SIZE_BYTES;
    const scanRoot = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()
        ? resolvedPath
        : path.dirname(resolvedPath);
    const promptsonarIgnorePatterns = loadRepositoryIgnorePatterns(scanRoot);
    const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...promptsonarIgnorePatterns];
    const workspaceIgnoreMatchers = loadWorkspaceIgnoreMatchers(scanRoot);

    if (fs.statSync(resolvedPath).isDirectory()) {
        files = await collectCandidateFiles(resolvedPath, ignorePatterns);
        files = files.filter(file => !isIgnoredByWorkspaceIgnore(file, workspaceIgnoreMatchers));
        if (files.length > maxFiles) {
            noteSkipped('max_files_exceeded', files.length - maxFiles);
            files = files.slice(0, maxFiles);
        }
    } else {
        files = [resolvedPath];
    }

    for (const filePath of files) {
        const stats = fs.statSync(filePath);
        if (stats.size > maxFileSizeBytes) {
            noteSkipped('file_too_large');
            if (options.verbose) {
                console.warn(`[PromptSonar] Skipping ${filePath}: file is larger than ${maxFileSizeBytes} bytes`);
            }
            continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const language = getLanguageForExt(ext);
        const inlineSuppressions = extractInlineSuppressions(content);
        const artifactKind = artifactKindForPath(filePath);
        const executionIntent = inferExecutionIntent(filePath, artifactKind);
        scanSummary.files_scanned++;

        try {
            if (isRecognizedMcpConfig(filePath)) {
                const mcpResult = auditMcpConfig(filePath, content);
                if (mcpResult.findings.length > 0) {
                    const scanFindings = mcpResult.findings.map(finding => mapMcpFinding(finding, filePath));
                    results.push(buildScanResult(filePath, scanFindings, scanSummary));
                    continue;
                }
            }

            const prompts = await parseFile({ filePath, content, language });
            const fileFindings: ScanFinding[] = [];

            for (const prompt of prompts) {
                const promptArtifactKind: ArtifactKind = artifactKind === 'source' && prompt.sourceType === 'config_file'
                    ? 'prompt'
                    : artifactKind;
                const promptExecutionIntent: ExecutionIntent = executionIntent === 'unknown' && promptArtifactKind === 'prompt'
                    ? 'executable'
                    : executionIntent;
                const evalResult: RuleResult = evaluatePrompt(
                    {
                        text: prompt.text,
                        language,
                        context: {
                            filePath,
                            artifactKind: promptArtifactKind,
                            executionIntent: promptExecutionIntent,
                            sourceType: prompt.sourceType,
                            hasExplicitPromptBlock: prompt.sourceType === 'config_file',
                        },
                    }
                );

                fileFindings.push(...evalResult.findings.map(f => {
                    const configSuppression = isFindingSuppressed(f.rule_id, filePath, activeSuppressions);
                    const owasp = getOwaspRef(f.rule_id);
                    const category = getCategoryForRule(f.rule_id);
                    const severity = displayedSeverityForArtifact(f.severity, category, promptArtifactKind, promptExecutionIntent);
                    const recommendation = getRecommendationForArtifact(f.rule_id, f.suggested_fix || '', promptArtifactKind, promptExecutionIntent);
                    const message = displayedRuleMessage(f.explanation, promptArtifactKind, promptExecutionIntent, category);
                    const risk = getRiskExplanation(f.rule_id);
                    const evidenceKind = evidenceKindForRule(f.rule_id, f.evidenceKind);
                    const located = locateEvidence(content, prompt.startLine, f.rule_id, f.matchedText);
                    const evidenceLine = evidenceKind === 'absence' ? prompt.startLine : located.line;
                    const evidenceColumn = evidenceKind === 'absence' ? 1 : located.column;
                    const inlineSuppressed = isInlineSuppressed(f.rule_id, prompt.startLine, inlineSuppressions)
                        || isInlineSuppressed(f.rule_id, located.line, inlineSuppressions);
                    const workflow = inferWorkflowForFinding({
                        ruleId: f.rule_id,
                        severity: f.severity,
                        text: prompt.text,
                        content,
                        filePath,
                        line: evidenceLine,
                        column: evidenceColumn,
                        message: f.explanation,
                    });
                    return {
                        rule_id: f.rule_id,
                        category,
                        severity,
                        line: evidenceLine,
                        column: evidenceColumn,
                        message,
                        fix: recommendation,
                        recommendation,
                        owasp_ref: owasp,
                        owasp,
                        evidence: evidenceKind === 'absence'
                            ? (f.missingRequirement || ABSENCE_REQUIREMENTS[f.rule_id] || f.explanation)
                            : located.evidence,
                        evidenceKind,
                        scopeLabel: evidenceKind === 'absence' ? (f.scopeLabel || 'Instruction block (absence evidence)') : undefined,
                        missingRequirement: evidenceKind === 'absence'
                            ? (f.missingRequirement || ABSENCE_REQUIREMENTS[f.rule_id] || f.explanation)
                            : undefined,
                        scopeStartLine: evidenceKind === 'absence' ? prompt.startLine : undefined,
                        scopeEndLine: evidenceKind === 'absence' ? prompt.endLine : undefined,
                        confidence: getConfidenceForFinding(f.rule_id, severity),
                        why: message,
                        risk,
                        docs_url: getRuleDocsUrl(f.rule_id),
                        waived: Boolean(configSuppression || inlineSuppressed),
                        workflow,
                        artifactKind: promptArtifactKind,
                        executionIntent: promptExecutionIntent,
                        suppression_reason: configSuppression?.reason || (inlineSuppressed ? 'Inline promptsonar-ignore comment' : undefined),
                        suppression_source: configSuppression?.source || (inlineSuppressed ? 'inline' : undefined),
                    };
                }));
            }

            // Whole-content secret scan: catches hardcoded secrets in any
            // string literal (not only prompt-shaped ones) and at the source
            // line where an interpolated secret is actually assigned.
            for (const secret of scanContentForSecrets(content, filePath)) {
                const configSuppression = isFindingSuppressed('sec_owasp_llm02_pii', filePath, activeSuppressions);
                const inlineSuppressed = isInlineSuppressed('sec_owasp_llm02_pii', secret.line, inlineSuppressions);
                const severity = displayedSeverityForArtifact('high', 'security', artifactKind, executionIntent);
                const recommendation = getRecommendationForArtifact('sec_owasp_llm02_pii', '', artifactKind, executionIntent);
                const message = secretFindingMessage(secret.name, artifactKind, executionIntent);
                fileFindings.push({
                    rule_id: 'sec_owasp_llm02_pii',
                    category: 'security',
                    severity,
                    line: secret.line,
                    column: secret.column,
                    message,
                    fix: recommendation,
                    recommendation,
                    owasp_ref: getOwaspRef('sec_owasp_llm02_pii'),
                    owasp: getOwaspRef('sec_owasp_llm02_pii'),
                    evidence: redactSecretEvidenceLine(content.split(/\r?\n/)[secret.line - 1] || secret.matchedText, secret.matchedText),
                    confidence: getConfidenceForFinding('sec_owasp_llm02_pii', severity),
                    why: secretFindingWhy(secret.name, artifactKind, executionIntent),
                    risk: getRiskExplanation('sec_owasp_llm02_pii'),
                    docs_url: getRuleDocsUrl('sec_owasp_llm02_pii'),
                    waived: Boolean(configSuppression || inlineSuppressed),
                    artifactKind,
                    executionIntent,
                    suppression_reason: configSuppression?.reason || (inlineSuppressed ? 'Inline promptsonar-ignore comment' : undefined),
                    suppression_source: configSuppression?.source || (inlineSuppressed ? 'inline' : undefined),
                });
            }

            if (fileFindings.length > 0) {
                results.push(buildScanResult(filePath, fileFindings, scanSummary));
            }
        } catch (err) {
            noteSkipped('scan_error');
            if (options.verbose) {
                console.warn(`[PromptSonar] Skipping ${filePath}: ${err}`);
            }
        }
    }

    for (const result of results) {
        result.scan_summary = { ...scanSummary, skipped_reasons: { ...scanSummary.skipped_reasons } };
    }

    return results;
}

function buildScanResult(filePath: string, scanFindings: ScanFinding[], scanSummary: ScanSummary): ScanResult {
    const { findings: uniqueFindings, repeatedCount } = dedupeFindings(filePath, scanFindings);
    const { findings: displayedFindings, summarizedCount } = capFindingsForDisplay(uniqueFindings);
    const score = scoreFromFindings(uniqueFindings);

    scanSummary.findings_total += scanFindings.length;
    scanSummary.findings_unique += uniqueFindings.length;
    scanSummary.findings_repeated += repeatedCount;
    scanSummary.findings_summarized += summarizedCount;

    return {
        filePath,
        overall_score: score,
        status: statusFromScoreAndFindings(score, uniqueFindings),
        pillar_scores: computePillarScores(uniqueFindings),
        findings_count: uniqueFindings.length,
        executive_summary: executiveSummaryForFindings(uniqueFindings),
        total_findings_count: scanFindings.length,
        unique_findings_count: uniqueFindings.length,
        repeated_findings_count: repeatedCount,
        summarized_findings_count: summarizedCount,
        findings: displayedFindings,
    };
}

export function generateSarif(results: ScanResult[]): string {
    // Collect all findings across all files and produce a unified SARIF document
    const allFindings: Array<{
        rule_id: string;
        category: any;
        severity: any;
        explanation: string;
        suggested_fix?: string;
        filePath?: string;
        line?: number;
        column?: number;
        evidence?: string;
        recommendation?: string;
        owasp?: string;
        confidence?: string;
        docs_url?: string;
        workflow?: FindingWorkflow;
        context?: CanonicalIssueContext;
        artifactKind?: ArtifactKind;
        executionIntent?: ExecutionIntent;
    }> = [];
    const primaryFile = results.length > 0 ? results[0].filePath : 'unknown';

    for (const result of results) {
        for (const f of result.findings) {
            allFindings.push({
                rule_id: f.rule_id,
                category: getCategoryForRule(f.rule_id) as any,
                severity: f.severity as any,
                explanation: f.message,
                suggested_fix: f.fix,
                filePath: result.filePath,
                line: f.line,
                column: f.column,
                evidence: f.evidence,
                recommendation: f.recommendation,
                owasp: f.owasp,
                confidence: f.confidence,
                docs_url: f.docs_url,
                workflow: f.workflow,
                context: f.context,
                artifactKind: f.artifactKind,
                executionIntent: f.executionIntent,
            });
        }
    }

    return formatToSarif(allFindings as any, primaryFile);
}
