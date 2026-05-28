import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
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
} from '@promptsonar/core';
import { formatToSarif } from '@promptsonar/core/dist/formatter/sarif';

export interface ScanResult {
    filePath: string;
    overall_score: number;
    status: 'pass' | 'warn' | 'fail';
    pillar_scores: Record<string, number>;
    findings_count: number;
    findings: ScanFinding[];
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
    confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    why: string;
    risk: string;
    docs_url: string;
    waived: boolean;
    workflow?: FindingWorkflow;
    suppression_reason?: string;
    suppression_source?: string;
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
    if (ruleId === 'sec_unbounded_access' || ruleId === 'sec_rag_injection') return 'LLM07';
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

function extractEvidence(content: string, startLine: number, ruleId: string, maxLength: number = 180): string {
    const lines = content.split(/\r?\n/);
    const line = lines.find(value => lineLooksRelevant(value, ruleId))
        || lines[Math.max(0, startLine - 1)]
        || lines.find(value => value.trim().length > 0)
        || '';
    const normalized = line.trim().replace(/\s+/g, ' ');
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
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
        .filter(line => line && !line.startsWith('#'))
        .map(pattern => ({
            path: pattern,
            reason: 'Matched .promptsonarignore path pattern',
            source: filePath,
        }));
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
]);

const DEFAULT_IGNORE_PATTERNS = [
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/.cache/**',
    '**/.git/**',
    '**/.vscode-test/**',
    '**/tests/**',
    '**/test/**',
    '**/__tests__/**',
    '**/docs/**',
    '**/evidence/**',
    '**/benchmarks/**',
    '**/examples/vulnerable-prompts/**',
    '**/examples/reports/**',
    '**/Agentsabha-angigravity/**',
    '**/custom-writer-skill/**',
    '**/my-writer-agent/**',
    '**/scratch/**',
    '**/results/**',
    '**/tmp/**',
    '**/*.promptsonar-fixed',
    '**/*.min.js',
    '**/*.bundle.js',
    '**/*.hot-update.js',
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/yarn.lock',
    '**/.promptsonar-waivers.yaml',
    '**/.promptsonarignore',
    '**/.promptsonar-policy.yaml',
    '**/dummy_test.*',
    '**/generate_test.*',
    '**/generate_tests.*',
    '**/generate_dummies.*',
    '**/debug_*',
    '**/test_parser.*',
    '**/test_parse.*',
];

const WORKFLOW_RELEVANT_PATTERNS = [
    'prompts/**/*',
    'agents/**/*',
    'ai/**/*',
    'rag/**/*',
    '**/*.prompt.*',
];

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
        || normalized.endsWith('/.vscode/mcp.json')
        || normalized.endsWith('/claude_desktop_config.json')
        || normalized === 'mcp.json'
        || normalized === 'claude_desktop_config.json';
}

function scoreFromFindings(findings: ScanFinding[]): number {
    return Math.max(0, 100 - findings.reduce((total, finding) => total + getPenaltyForSeverity(finding.severity), 0));
}

function statusFromFindings(findings: ScanFinding[]): ScanResult['status'] {
    if (findings.some(finding => finding.severity === 'critical' || finding.severity === 'high')) return 'fail';
    if (findings.length > 0) return 'warn';
    return 'pass';
}

function mapMcpFinding(finding: McpFinding, filePath: string): ScanFinding {
    const recommendation = finding.fix;
    const workflow = finding.workflow || inferWorkflowForFinding({
        ruleId: finding.rule_id,
        severity: finding.severity,
        text: `${finding.message}\n${finding.fix}`,
        filePath,
        message: finding.message,
    });
    return {
        rule_id: finding.rule_id,
        category: 'security',
        severity: finding.severity,
        line: 1,
        column: 1,
        message: finding.message,
        fix: recommendation,
        recommendation,
        owasp_ref: '',
        owasp: '',
        evidence: finding.server ? `server: ${finding.server}; path: ${finding.path}` : finding.path,
        confidence: getConfidenceForFinding(finding.rule_id, finding.severity),
        why: finding.message,
        risk: 'MCP configuration may expose tools, credentials, or execution capability beyond the agent workflow trust boundary.',
        docs_url: getRuleDocsUrl(finding.rule_id),
        waived: false,
        workflow,
    };
}

export async function scanFiles(targetPath: string, options: {
    verbose?: boolean;
    diffOnly?: boolean;
    waiverFile?: string;
}): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

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

    if (fs.statSync(resolvedPath).isDirectory()) {
        const patterns = SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
        files = await fg(patterns, {
            cwd: resolvedPath,
            absolute: true,
            ignore: DEFAULT_IGNORE_PATTERNS,
        });

        const markdownPromptFiles = await fg(['**/*.md'], {
            cwd: resolvedPath,
            absolute: true,
            ignore: DEFAULT_IGNORE_PATTERNS,
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
            ignore: DEFAULT_IGNORE_PATTERNS,
        }));
        files = Array.from(new Set(files));
    } else {
        files = [resolvedPath];
    }

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const language = getLanguageForExt(ext);
        const inlineSuppressions = extractInlineSuppressions(content);

        try {
            if (isRecognizedMcpConfig(filePath)) {
                const mcpResult = auditMcpConfig(filePath, content);
                if (mcpResult.findings.length > 0) {
                    const scanFindings = mcpResult.findings.map(finding => mapMcpFinding(finding, filePath));
                    results.push({
                        filePath,
                        overall_score: scoreFromFindings(scanFindings),
                        status: statusFromFindings(scanFindings),
                        pillar_scores: computePillarScores(scanFindings),
                        findings_count: scanFindings.length,
                        findings: scanFindings,
                    });
                    continue;
                }
            }

            const prompts = await parseFile({ filePath, content, language });

            for (const prompt of prompts) {
                const evalResult: RuleResult = evaluatePrompt(
                    { text: prompt.text, language, context: { filePath } }
                );

                const scanFindings: ScanFinding[] = evalResult.findings.map(f => {
                    const configSuppression = isFindingSuppressed(f.rule_id, filePath, activeSuppressions);
                    const inlineSuppressed = isInlineSuppressed(f.rule_id, prompt.startLine, inlineSuppressions);
                    const owasp = getOwaspRef(f.rule_id);
                    const recommendation = getDeterministicRecommendation(f.rule_id, f.suggested_fix || '');
                    const risk = getRiskExplanation(f.rule_id);
                    const workflow = inferWorkflowForFinding({
                        ruleId: f.rule_id,
                        severity: f.severity,
                        text: prompt.text,
                        content,
                        filePath,
                        line: prompt.startLine,
                        column: 1,
                        message: f.explanation,
                    });
                    return {
                        rule_id: f.rule_id,
                        category: getCategoryForRule(f.rule_id),
                        severity: f.severity,
                        line: prompt.startLine,
                        column: 1,
                        message: f.explanation,
                        fix: recommendation,
                        recommendation,
                        owasp_ref: owasp,
                        owasp,
                        evidence: extractEvidence(content, prompt.startLine, f.rule_id),
                        confidence: getConfidenceForFinding(f.rule_id, f.severity),
                        why: f.explanation,
                        risk,
                        docs_url: getRuleDocsUrl(f.rule_id),
                        waived: Boolean(configSuppression || inlineSuppressed),
                        workflow,
                        suppression_reason: configSuppression?.reason || (inlineSuppressed ? 'Inline promptsonar-ignore comment' : undefined),
                        suppression_source: configSuppression?.source || (inlineSuppressed ? 'inline' : undefined),
                    };
                });

                results.push({
                    filePath,
                    overall_score: evalResult.score,
                    status: evalResult.status,
                    pillar_scores: computePillarScores(scanFindings),
                    findings_count: scanFindings.length,
                    findings: scanFindings,
                });
            }
        } catch (err) {
            if (options.verbose) {
                console.warn(`[PromptSonar] Skipping ${filePath}: ${err}`);
            }
        }
    }

    return results;
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
            });
        }
    }

    return formatToSarif(allFindings as any, primaryFile);
}
