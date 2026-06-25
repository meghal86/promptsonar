import * as path from 'path';
import type { CapabilityType } from '../contextual/types';
import { auditMcpConfig } from '../mcp';
import { evaluatePrompt, scanContentForSecrets } from '../rules';
import { inferWorkflowForFinding } from '../workflow';
import { parseFile } from '../parser';
import { inferArtifactKind, inferExecutionIntent } from '../artifacts';
import {
    analyzeRepositoryArtifactsFromFiles,
    buildRepositoryExecutionMap,
    evaluateCanonicalFindings,
    type InMemoryRepositoryFile,
} from './analyzer';
import {
    analyzeFetchedFiles,
    enrichCandidates,
    extractReferences,
    findControlNeighborhood,
    rankContentEnrichedCandidates,
    type AnalyzedRepositoryFile,
    type ContentAnalysisResult,
    type ContentEnrichedCandidate,
} from './contentDiscovery';
import {
    discoverRepositoryCandidates,
    selectInitialAcquisitionSet,
    type MetadataCandidate,
} from './discovery';
import type {
    RepositoryAcquisitionUsage,
    RepositoryFileContent,
    RepositoryFileMetadata,
    RepositorySourceAdapter,
} from './source';
import type {
    CoverageStatus,
    RepositoryExecutionReport,
    RepositoryFileFailureReason,
    RepositoryFileStatus,
    RepositoryProfileEvidence,
    RepositoryScanFinding,
    RepositoryScanResult,
    ScanCompleteness,
    ScanMode,
} from './types';

export type ScanBudget = {
    maxFiles: number;
    maxBytes: number;
    maxCharacters?: number;
    maxDurationMs: number;
    maxReferenceDepth: number;
    maxApiRequests?: number;
};

export type RepositoryFileLifecycle = {
    path: string;
    status: RepositoryFileStatus;
    reason?: RepositoryFileFailureReason;
};

export type RepositoryClosureEvaluationOptions = {
    rootPath: string;
    source: RepositorySourceAdapter;
    budget: ScanBudget;
    mode?: ScanMode;
    profileEvidence?: RepositoryProfileEvidence;
    threatModel?: unknown;
    scanResults?: RepositoryScanResult[];
};

export type RepositoryClosureEvaluationResult = {
    report: RepositoryExecutionReport;
    completeness: ScanCompleteness;
    acquisition: RepositoryAcquisitionUsage;
    lifecycle: RepositoryFileLifecycle[];
    analyzedFiles: AnalyzedRepositoryFile[];
};

type MutableLifecycle = {
    status: RepositoryFileStatus;
    reason?: RepositoryFileFailureReason;
};

const PRIVILEGED_CAPABILITIES = new Set(['shell', 'filesystem', 'secret', 'deployment', 'cloud']);
const ABSENCE_REQUIREMENTS: Record<string, string> = {
    bp_missing_persona: 'No bounded role or persona requirement was found within that block.',
    bp_missing_few_shot: 'No example input/output behavior was found within that block.',
    bp_missing_cot: 'No verification requirement or reviewable decision criteria were found within that block.',
    struct_missing_format_enforcer: 'No required output format or schema enforcement was found within that block.',
};

function normalizeRepositoryPath(value: string): string {
    return value.replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

function uniqueSorted(values: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(values).map(normalizeRepositoryPath).filter(Boolean))).sort();
}

function markLifecycle(
    lifecycle: Map<string, MutableLifecycle>,
    path: string,
    status: RepositoryFileStatus,
    reason?: RepositoryFileFailureReason,
): void {
    lifecycle.set(normalizeRepositoryPath(path), reason ? { status, reason } : { status });
}

function lifecycleReasonForUnfetched(usage: RepositoryAcquisitionUsage): RepositoryFileFailureReason {
    if (usage.requestLimit !== Number.MAX_SAFE_INTEGER && usage.requestsUsed >= usage.requestLimit) {
        return 'api_request_budget_exhausted';
    }
    return 'budget_exhausted';
}

function remainingFiles(selected: Set<string>, budget: ScanBudget): number {
    return Math.max(0, budget.maxFiles - selected.size);
}

function selectedBytes(paths: Iterable<string>, metadataByPath: Map<string, RepositoryFileMetadata>): number {
    let total = 0;
    for (const filePath of paths) total += metadataByPath.get(filePath)?.size || 0;
    return total;
}

function remainingBytes(selected: Set<string>, metadataByPath: Map<string, RepositoryFileMetadata>, budget: ScanBudget): number {
    return Math.max(0, budget.maxBytes - selectedBytes(selected, metadataByPath));
}

function candidateByPath(candidates: MetadataCandidate[]): Map<string, MetadataCandidate> {
    return new Map(candidates.map(candidate => [candidate.path, candidate]));
}

function capabilityType(signal: string): CapabilityType {
    if (signal === 'shell') return 'shell';
    if (signal === 'filesystem') return 'filesystem.write';
    if (signal === 'network') return 'network';
    if (signal === 'secret') return 'secret.read';
    if (signal === 'deployment' || signal === 'cloud') return 'deployment';
    return 'unknown';
}

function privilegedFiles(files: AnalyzedRepositoryFile[]): AnalyzedRepositoryFile[] {
    return files.filter(file => file.capabilitySignals.some(signal => PRIVILEGED_CAPABILITIES.has(signal)));
}

function hasResolvedControlContext(file: AnalyzedRepositoryFile, analyzedByPath: Map<string, AnalyzedRepositoryFile>): boolean {
    if (hasEffectiveControlEvidence(file)) return true;
    return Array.from(analyzedByPath.values()).some(candidate =>
        candidate.path !== file.path && hasEffectiveControlEvidence(candidate)
    );
}

function stripDecorativeControlText(content: string): string {
    return content
        .split(/\r?\n/)
        .filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            if (/^(?:\/\/|#|\/\*|\*|<!--)/.test(trimmed)) return false;
            return !/\b(?:todo|example|documentation|docs?|comment|decorative|placeholder|sample)\b/i.test(trimmed);
        })
        .join('\n');
}

function hasDisabledControlEvidence(content: string): boolean {
    return /\b(?:approval|required|sandbox|auth(?:entication|orization)?|human[_-]?in[_-]?the[_-]?loop|allowlist|denylist|redact(?:ion)?)\b[\w\s."'`-]*(?:=|:)\s*(?:false|0|null|undefined|off|disabled)\b/i.test(content)
        || /\b(?:approval|sandbox|auth(?:entication|orization)?|human[_-]?in[_-]?the[_-]?loop|allowlist|denylist|redact(?:ion)?)\b[\w\s-]{0,40}\b(?:disabled|bypassed|skipped|not\s+required|without\s+approval)\b/i.test(content);
}

function hasEffectiveControlEvidence(file: AnalyzedRepositoryFile): boolean {
    if (file.controlSignals.length === 0) return false;
    const content = stripDecorativeControlText(file.content);
    if (!content.trim() || hasDisabledControlEvidence(content)) return false;
    return [
        /\bhuman[_-]?in[_-]?the[_-]?loop\b/i,
        /\brequire(?:s|d)?[_-]?(?:human[_-]?)?approval\b/i,
        /\bapprovalRequired\b\s*[:=]\s*true\b/i,
        /\brequireApproval\b\s*[:=]\s*true\b/i,
        /\bautoApprove\b\s*[:=]\s*false\b/i,
        /\bautoExecute\b\s*[:=]\s*false\b/i,
        /\b(?:allowed_paths|allowlist|denylist)\b\s*[:=]\s*(?:\[[^\]]+\]|\{[^}]+\}|["'`][^"'`]+["'`])/i,
        /\b(?:sandbox|read_only|readonly|working_directory)\b\s*[:=]\s*(?:true|["'`][^"'`]+["'`])/i,
        /\b(?:authentication|authorization|authRequired|requireAuth)\b\s*[:=]\s*true\b/i,
        /\b(?:validate|sanitize|escape)\s*\(/i,
        /\b(?:redact|rate_limit|audit)\s*\(/i,
    ].some(pattern => pattern.test(content));
}

function selectedResolvedReferences(referencePaths: string[], fetchedPaths: Set<string>, analyzedPaths: Set<string>) {
    return {
        fetched: referencePaths.filter(filePath => fetchedPaths.has(filePath)).length,
        parsed: referencePaths.filter(filePath => analyzedPaths.has(filePath)).length,
    };
}

function getLanguageForPath(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
        case '.py': return 'python';
        case '.ts':
        case '.tsx':
        case '.js':
        case '.jsx': return 'typescript';
        case '.go': return 'go';
        case '.java': return 'java';
        case '.rs': return 'rust';
        case '.cs': return 'c_sharp';
        default: return '';
    }
}

function isRecognizedMcpConfig(filePath: string): boolean {
    const normalized = normalizeRepositoryPath(filePath).toLowerCase();
    return normalized.endsWith('/mcp.json')
        || normalized.endsWith('/.mcp.json')
        || normalized.endsWith('/.vscode/mcp.json')
        || normalized.endsWith('/.cursor/mcp.json')
        || normalized.endsWith('/claude_desktop_config.json')
        || normalized === 'mcp.json'
        || normalized === '.mcp.json'
        || normalized === 'claude_desktop_config.json';
}

function confidenceForFinding(severity: string): string {
    if (severity === 'critical') return 'VERY_HIGH';
    if (severity === 'high') return 'HIGH';
    if (severity === 'medium') return 'MEDIUM';
    return 'LOW';
}

function evidenceKindForRule(ruleId: string, explicit?: 'direct' | 'absence'): 'direct' | 'absence' {
    return explicit || (ABSENCE_REQUIREMENTS[ruleId] ? 'absence' : 'direct');
}

function truncateEvidence(line: string): string {
    const normalized = line.trim().replace(/\s+/g, ' ');
    return normalized.length <= 180 ? normalized : `${normalized.slice(0, 179)}…`;
}

function locateEvidence(content: string, startLine: number, matchedText?: string): { evidence: string; line: number; column: number } {
    const lines = content.split(/\r?\n/);
    const needle = (matchedText || '').split(/\r?\n/).map(value => value.trim()).find(Boolean);
    if (needle) {
        const index = lines.findIndex(line => line.includes(needle));
        if (index >= 0) {
            return {
                evidence: truncateEvidence(lines[index]),
                line: index + 1,
                column: Math.max(1, lines[index].indexOf(needle) + 1),
            };
        }
    }
    const fallback = lines[Math.max(0, startLine - 1)] || lines.find(line => line.trim()) || '';
    return { evidence: truncateEvidence(fallback), line: Math.max(1, startLine), column: 1 };
}

function ruleRecommendation(fallback?: string): string {
    return fallback || 'Review the prompt or configuration and apply the documented safer pattern.';
}

function mergeScanResults(results: RepositoryScanResult[]): RepositoryScanResult[] {
    const byFile = new Map<string, RepositoryScanResult>();
    for (const result of results) {
        const key = path.resolve(result.filePath);
        const existing = byFile.get(key) || { filePath: result.filePath, findings: [] };
        existing.findings.push(...(result.findings || []));
        byFile.set(key, existing);
    }
    for (const result of byFile.values()) {
        const seen = new Set<string>();
        result.findings = result.findings.filter(finding => {
            const key = [
                finding.rule_id,
                finding.severity,
                finding.line || 1,
                finding.column || 1,
                finding.evidence || finding.message || '',
            ].join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).sort((a, b) =>
            String(a.rule_id).localeCompare(String(b.rule_id)) ||
            (a.line || 1) - (b.line || 1) ||
            (a.column || 1) - (b.column || 1)
        );
    }
    return Array.from(byFile.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function scanAnalyzedFilesForRepository(rootPath: string, analyzedFiles: AnalyzedRepositoryFile[]): Promise<RepositoryScanResult[]> {
    const root = path.resolve(rootPath);
    const results: RepositoryScanResult[] = [];

    for (const file of analyzedFiles) {
        const absolutePath = path.join(root, file.path);
        const content = file.content;
        const findings: RepositoryScanFinding[] = [];
        const language = getLanguageForPath(file.path);

        if (isRecognizedMcpConfig(file.path)) {
            const mcp = auditMcpConfig(absolutePath, content);
            findings.push(...mcp.findings.map(finding => ({
                rule_id: finding.rule_id,
                category: 'security',
                severity: finding.severity,
                line: finding.line || 1,
                column: finding.column || 1,
                message: finding.message,
                fix: finding.fix,
                recommendation: finding.fix,
                evidence: finding.evidence
                    ? `${finding.server ? `server: ${finding.server}; ` : ''}${finding.evidence}`
                    : (finding.server ? `server: ${finding.server}; path: ${finding.path}` : finding.path),
                confidence: confidenceForFinding(finding.severity),
                why: finding.message,
                risk: 'MCP configuration may expose tools, credentials, or execution capability beyond the agent workflow trust boundary.',
                waived: false,
                workflow: finding.workflow || inferWorkflowForFinding({
                    ruleId: finding.rule_id,
                    severity: finding.severity,
                    text: `${finding.message}\n${finding.fix}`,
                    content,
                    filePath: absolutePath,
                    line: finding.line || 1,
                    column: finding.column || 1,
                    message: finding.message,
                }),
            })));
        }

        const artifactKind = inferArtifactKind(absolutePath);
        const executionIntent = inferExecutionIntent(absolutePath, artifactKind);
        const prompts = await parseFile({ filePath: absolutePath, content, language });
        for (const prompt of prompts) {
            const evaluated = evaluatePrompt({
                text: prompt.text,
                language,
                context: {
                    filePath: absolutePath,
                    artifactKind,
                    executionIntent,
                    sourceType: prompt.sourceType,
                    hasExplicitPromptBlock: prompt.sourceType === 'config_file',
                },
            });
            for (const finding of evaluated.findings) {
                const evidenceKind = evidenceKindForRule(finding.rule_id, finding.evidenceKind);
                const located = locateEvidence(content, prompt.startLine, finding.matchedText);
                const line = evidenceKind === 'absence' ? prompt.startLine : located.line;
                const column = evidenceKind === 'absence' ? 1 : located.column;
                findings.push({
                    rule_id: finding.rule_id,
                    category: finding.category,
                    severity: finding.severity,
                    line,
                    column,
                    message: finding.explanation,
                    fix: ruleRecommendation(finding.suggested_fix),
                    recommendation: ruleRecommendation(finding.suggested_fix),
                    evidence: evidenceKind === 'absence'
                        ? (finding.missingRequirement || ABSENCE_REQUIREMENTS[finding.rule_id] || finding.explanation)
                        : located.evidence,
                    evidenceKind,
                    scopeLabel: evidenceKind === 'absence' ? (finding.scopeLabel || 'Instruction block') : undefined,
                    missingRequirement: evidenceKind === 'absence'
                        ? (finding.missingRequirement || ABSENCE_REQUIREMENTS[finding.rule_id] || finding.explanation)
                        : undefined,
                    scopeStartLine: evidenceKind === 'absence' ? prompt.startLine : undefined,
                    scopeEndLine: evidenceKind === 'absence' ? prompt.endLine : undefined,
                    confidence: confidenceForFinding(finding.severity),
                    why: finding.explanation,
                    risk: finding.explanation,
                    waived: false,
                    artifactKind,
                    executionIntent,
                    workflow: finding.workflow || inferWorkflowForFinding({
                        ruleId: finding.rule_id,
                        severity: finding.severity,
                        text: prompt.text,
                        content,
                        filePath: absolutePath,
                        line,
                        column,
                        message: finding.explanation,
                    }),
                });
            }
        }

        for (const secret of scanContentForSecrets(content)) {
            const secretFix = artifactKind === 'workflow'
                ? 'Restrict workflow permissions to least privilege, protect environments, avoid exposing secrets to pull_request or other untrusted triggers, scope secrets to the minimum jobs and environments, pin actions to trusted versions, and validate shell inputs before use.'
                : 'Move secrets to environment variables or a secret manager, rotate exposed credentials, and keep secrets out of executable instructions and checked-in configuration.';
            findings.push({
                rule_id: 'sec_owasp_llm02_pii',
                category: 'security',
                severity: 'high',
                line: secret.line,
                column: secret.column,
                message: `Potential Sensitive Information Disclosure (OWASP LLM02): Hardcoded ${secret.name} found in source.`,
                fix: secretFix,
                recommendation: secretFix,
                evidence: truncateEvidence((content.split(/\r?\n/)[secret.line - 1] || secret.matchedText)),
                confidence: 'HIGH',
                why: `A hardcoded ${secret.name} in source can leak through logs, prompts, responses, or repository history.`,
                risk: 'Secrets or sensitive data in prompt text can leak through logs, responses, screenshots, or repository history.',
                waived: false,
                artifactKind,
                executionIntent,
            });
        }

        results.push({ filePath: absolutePath, findings });
    }

    return mergeScanResults(results);
}

function mergeAnalyses(results: ContentAnalysisResult[]): ContentAnalysisResult {
    return {
        selectedPaths: uniqueSorted(results.flatMap(result => result.selectedPaths)),
        fetchedPaths: uniqueSorted(results.flatMap(result => result.fetchedPaths)),
        successful: results.flatMap(result => result.successful).sort((a, b) => a.path.localeCompare(b.path)),
        failures: results.flatMap(result => result.failures).sort((a, b) => a.path.localeCompare(b.path)),
    };
}

function selectNextCandidates(
    candidates: MetadataCandidate[],
    enriched: ContentEnrichedCandidate[],
    selected: Set<string>,
    metadataByPath: Map<string, RepositoryFileMetadata>,
    budget: ScanBudget,
): MetadataCandidate[] {
    const byPath = candidateByPath(candidates);
    const eligible = rankContentEnrichedCandidates(enriched)
        .filter(candidate => byPath.has(candidate.path) && !selected.has(candidate.path));
    const remaining = remainingFiles(selected, budget);
    if (remaining <= 0) return [];
    const selectedNext = selectInitialAcquisitionSet(eligible, {
        maxFiles: remaining,
        maxBytes: remainingBytes(selected, metadataByPath, budget),
        categoryMinimums: { control: 0, capability: 0, entry_point: 0 },
    });
    return selectedNext.map(candidate => byPath.get(candidate.path)!).filter(Boolean);
}

async function fetchSelectedFiles(
    source: RepositorySourceAdapter,
    paths: string[],
    budget: ScanBudget,
    fetched: Map<string, RepositoryFileContent>,
): Promise<RepositoryFileContent[]> {
    const remainingPaths = uniqueSorted(paths).filter(filePath => !fetched.has(filePath));
    if (remainingPaths.length === 0) return [];
    const requestCost = source.getCapabilities().localSearch ? 0 : 1;
    const remainingApiRequests = requestCost > 0 && budget.maxApiRequests !== undefined
        ? Math.max(0, budget.maxApiRequests - source.getBudgetUsage().requestsUsed)
        : remainingPaths.length;
    const files = await source.fetchFiles(remainingPaths, {
        maxFiles: Math.min(remainingPaths.length, remainingApiRequests),
        maxBytes: Math.max(0, budget.maxBytes - source.getBudgetUsage().bytesFetched),
        requestCost,
    });
    for (const file of files) fetched.set(normalizeRepositoryPath(file.path), file);
    return files;
}

function buildCompleteness(input: {
    mode: ScanMode;
    inventory: RepositoryFileMetadata[];
    selected: Set<string>;
    fetched: Map<string, RepositoryFileContent>;
    analyses: ContentAnalysisResult[];
    lifecycle: Map<string, MutableLifecycle>;
    report: RepositoryExecutionReport;
    unresolvedReferences: Set<string>;
    resolvedReferences: Set<string>;
    controlNeighborhoodSearched: Set<string>;
    budgetExhausted: boolean;
    requestBudgetExhausted: boolean;
    relevantFailures: Array<{ path: string; reason: RepositoryFileFailureReason }>;
    scannerAnalyzedPaths: Set<string>;
}): ScanCompleteness {
    const analysis = mergeAnalyses(input.analyses);
    const analyzedByPath = new Map(analysis.successful.map(file => [file.path, file]));
    const analyzedPaths = new Set(analyzedByPath.keys());
    const fetchedPaths = new Set(input.fetched.keys());
    const referencePaths = uniqueSorted(input.resolvedReferences);
    const resolvedReferenceCounts = selectedResolvedReferences(referencePaths, fetchedPaths, analyzedPaths);
    const privileged = privilegedFiles(analysis.successful);
    const unresolvedContext = privileged
        .filter(file => !hasResolvedControlContext(file, analyzedByPath))
        .map(file => ({
            capability: capabilityType(file.capabilitySignals.find(signal => PRIVILEGED_CAPABILITIES.has(signal)) || 'unknown'),
            artifactId: input.report.artifacts.find(artifact => artifact.relativePath === file.path)?.id || file.path,
            missingFilesOrControls: uniqueSorted([
                ...input.unresolvedReferences,
                ...referencePaths.filter(reference => !analyzedPaths.has(reference)),
                'approval/sandbox/control context',
            ]),
        }));
    const graphConnectedFiles = new Set(input.report.artifacts.map(artifact => normalizeRepositoryPath(artifact.relativePath)));
    const graphConnectedCount = Array.from(graphConnectedFiles).filter(filePath => analyzedPaths.has(filePath)).length;
    const selectedCount = input.selected.size;
    const scannerCoveredSelectedFiles = analysis.successful.every(file => input.scannerAnalyzedPaths.has(file.path));
    const repositoryComplete = selectedCount === input.inventory.length
        && input.fetched.size === selectedCount
        && analysis.failures.length === 0
        && scannerCoveredSelectedFiles
        && input.unresolvedReferences.size === 0
        && unresolvedContext.length === 0
        && !input.budgetExhausted
        && !input.requestBudgetExhausted
        && input.relevantFailures.length === 0;
    const coverageStatus: CoverageStatus = repositoryComplete
        ? 'repository_complete'
        : (
            unresolvedContext.length === 0
            && input.unresolvedReferences.size === 0
            && input.relevantFailures.length === 0
            && !input.budgetExhausted
            && !input.requestBudgetExhausted
            && selectedCount > 0
                ? 'path_complete'
                : 'partial'
        );
    const verdictScope = repositoryComplete
        ? 'repository_complete'
        : (coverageStatus === 'path_complete' ? 'path_complete' : 'partial_context');
    const reasonParts: string[] = [];
    if (repositoryComplete) reasonParts.push('Every inventoried file was selected, fetched, parsed, and analyzed within budget.');
    if (input.budgetExhausted) reasonParts.push('File or byte acquisition budget was exhausted.');
    if (input.requestBudgetExhausted) reasonParts.push('API request budget was exhausted.');
    if (!scannerCoveredSelectedFiles) reasonParts.push('Scanner analysis did not complete for every parsed file.');
    if (input.unresolvedReferences.size > 0) reasonParts.push(`${input.unresolvedReferences.size} references were unresolved.`);
    if (unresolvedContext.length > 0) reasonParts.push(`${unresolvedContext.length} privileged capabilities are missing resolved control context.`);
    if (input.relevantFailures.length > 0) reasonParts.push(`${input.relevantFailures.length} relevant files failed fetch or parse.`);
    if (reasonParts.length === 0) reasonParts.push('All selected path context was fetched, parsed, and analyzed; repository-wide coverage remains bounded.');

    return {
        mode: input.mode,
        coverageStatus,
        files: {
            inventoried: input.inventory.length,
            selected: selectedCount,
            fetched: input.fetched.size,
            parsed: analysis.successful.length,
            analyzed: analysis.successful.length,
            graphConnected: graphConnectedCount,
        },
        capabilities: {
            discovered: privileged.length,
            withControlNeighborhoodSearched: privileged.filter(file => input.controlNeighborhoodSearched.has(file.path)).length,
            withControlContextResolved: privileged.filter(file => hasResolvedControlContext(file, analyzedByPath)).length,
            unresolved: unresolvedContext.length,
        },
        references: {
            discovered: referencePaths.length + input.unresolvedReferences.size,
            fetched: resolvedReferenceCounts.fetched,
            parsed: resolvedReferenceCounts.parsed,
            resolved: referencePaths.filter(filePath => analyzedPaths.has(filePath)).length,
            unresolved: input.unresolvedReferences.size + referencePaths.filter(filePath => !analyzedPaths.has(filePath)).length,
        },
        unresolvedContext,
        verdictScope,
        coverageReason: reasonParts.join(' '),
    };
}

export async function evaluateRepositoryWithClosure(
    options: RepositoryClosureEvaluationOptions,
): Promise<RepositoryClosureEvaluationResult> {
    const mode = options.mode || 'bounded';
    const started = Date.now();
    const inventory = (await options.source.inventory()).map(file => ({
        ...file,
        path: normalizeRepositoryPath(file.path),
    })).sort((a, b) => a.path.localeCompare(b.path));
    const metadataByPath = new Map(inventory.map(file => [file.path, file]));
    const lifecycle = new Map<string, MutableLifecycle>();
    for (const file of inventory) markLifecycle(lifecycle, file.path, 'inventoried');

    const metadataCandidates = discoverRepositoryCandidates(inventory);
    const inventoryBytes = inventory.reduce((total, file) => total + (file.size || 0), 0);
    const repositoryFitsBudget = inventory.length <= options.budget.maxFiles && inventoryBytes <= options.budget.maxBytes;
    const initialMaxFiles = repositoryFitsBudget
        ? options.budget.maxFiles
        : Math.max(1, Math.ceil(options.budget.maxFiles * 0.6));
    const initial = selectInitialAcquisitionSet(metadataCandidates, {
        maxFiles: initialMaxFiles,
        maxBytes: options.budget.maxBytes,
    });
    const selected = new Set<string>();
    const fetched = new Map<string, RepositoryFileContent>();
    const analyses: ContentAnalysisResult[] = [];
    const unresolvedReferences = new Set<string>();
    const resolvedReferences = new Set<string>();
    const controlNeighborhoodSearched = new Set<string>();
    const relevantFailures: Array<{ path: string; reason: RepositoryFileFailureReason }> = [];
    let budgetExhausted = initial.length < metadataCandidates.length && initial.length >= options.budget.maxFiles;
    let requestBudgetExhausted = false;

    let frontierSelections = initial.map(candidate => candidate.path);
    let depth = 0;
    while (frontierSelections.length > 0 && depth <= options.budget.maxReferenceDepth) {
        for (const filePath of frontierSelections) {
            selected.add(filePath);
            markLifecycle(lifecycle, filePath, 'selected');
        }
        const beforeUsage = options.source.getBudgetUsage();
        const fetchedFiles = await fetchSelectedFiles(options.source, frontierSelections, options.budget, fetched);
        const afterUsage = options.source.getBudgetUsage();
        requestBudgetExhausted = requestBudgetExhausted
            || (afterUsage.requestLimit !== Number.MAX_SAFE_INTEGER && afterUsage.requestsUsed >= afterUsage.requestLimit)
            || (options.budget.maxApiRequests !== undefined && afterUsage.requestsUsed >= options.budget.maxApiRequests);
        const fetchedNow = new Set(fetchedFiles.map(file => normalizeRepositoryPath(file.path)));
        for (const file of fetchedFiles) markLifecycle(lifecycle, file.path, 'fetched');
        for (const filePath of frontierSelections) {
            if (!fetchedNow.has(filePath) && !fetched.has(filePath)) {
                const reason = (
                    (afterUsage.requestLimit !== Number.MAX_SAFE_INTEGER && afterUsage.requestsUsed >= afterUsage.requestLimit)
                    || (options.budget.maxApiRequests !== undefined && afterUsage.requestsUsed >= options.budget.maxApiRequests)
                )
                    ? 'api_request_budget_exhausted'
                    : afterUsage.requestsUsed > beforeUsage.requestsUsed
                    ? lifecycleReasonForUnfetched(afterUsage)
                    : 'fetch_failed';
                markLifecycle(lifecycle, filePath, 'failed', reason);
                relevantFailures.push({ path: filePath, reason });
            }
        }

        const analysis = analyzeFetchedFiles(fetchedFiles, { selectedPaths: frontierSelections });
        analyses.push(analysis);
        for (const file of analysis.successful) {
            markLifecycle(lifecycle, file.path, 'parsed');
            markLifecycle(lifecycle, file.path, 'analyzed');
        }
        for (const failure of analysis.failures) {
            markLifecycle(lifecycle, failure.path, 'failed', failure.reason);
            relevantFailures.push({ path: failure.path, reason: failure.reason });
        }

        const allAnalysis = mergeAnalyses(analyses);
        const references = extractReferences(analysis.successful, inventory);
        for (const reference of references.resolved) resolvedReferences.add(reference);
        for (const reference of references.unresolved) unresolvedReferences.add(reference);
        for (const file of privilegedFiles(analysis.successful)) controlNeighborhoodSearched.add(file.path);
        const controls = findControlNeighborhood(analysis.successful, references, inventory);
        const nextCandidates = [...references.candidates, ...controls]
            .filter(candidate => metadataByPath.has(candidate.path) && !selected.has(candidate.path));
        const enriched = enrichCandidates(metadataCandidates, allAnalysis);
        frontierSelections = selectNextCandidates(
            nextCandidates,
            enriched,
            selected,
            metadataByPath,
            options.budget,
        ).map(candidate => candidate.path);

        budgetExhausted = budgetExhausted || (frontierSelections.length < nextCandidates.length && remainingFiles(selected, options.budget) <= 0);
        if (Date.now() - started >= options.budget.maxDurationMs) {
            budgetExhausted = true;
            break;
        }
        if (requestBudgetExhausted && frontierSelections.length > 0) break;
        depth += 1;
    }

    const analyzedFiles = mergeAnalyses(analyses).successful;
    const inMemoryFiles: InMemoryRepositoryFile[] = analyzedFiles.map(file => ({
        path: file.path,
        content: file.content,
    }));
    const generatedScanResults = await scanAnalyzedFilesForRepository(options.rootPath, analyzedFiles);
    const scanResults = mergeScanResults([...(options.scanResults || []), ...generatedScanResults]);
    const scannerAnalyzedPaths = new Set(generatedScanResults.map(result =>
        normalizeRepositoryPath(path.relative(path.resolve(options.rootPath), path.resolve(result.filePath))),
    ));
    const { artifacts, scanStats } = analyzeRepositoryArtifactsFromFiles(options.rootPath, inMemoryFiles, {
        maxFiles: inMemoryFiles.length || 1,
    });
    const executionGraph = buildRepositoryExecutionMap(artifacts, scanResults, options.rootPath);
    const provisionalReport = evaluateCanonicalFindings({
        rootPath: options.rootPath,
        analyzedArtifacts: artifacts,
        executionGraph,
        profileEvidence: options.profileEvidence || { signals: [] },
        scanCompleteness: {
            mode,
            coverageStatus: 'unknown',
            files: { inventoried: 0, selected: 0, fetched: 0, parsed: 0, analyzed: 0, graphConnected: 0 },
            capabilities: { discovered: 0, withControlNeighborhoodSearched: 0, withControlContextResolved: 0, unresolved: 0 },
            references: { discovered: 0, fetched: 0, parsed: 0, resolved: 0, unresolved: 0 },
            unresolvedContext: [],
            verdictScope: 'partial_context',
            coverageReason: 'Completeness is calculated after closure orchestration.',
        },
        threatModel: options.threatModel,
        scanResults,
        scanStats,
    });
    const completeness = buildCompleteness({
        mode,
        inventory,
        selected,
        fetched,
        analyses,
        lifecycle,
        report: provisionalReport,
        unresolvedReferences,
        resolvedReferences,
        controlNeighborhoodSearched,
        budgetExhausted,
        requestBudgetExhausted,
        relevantFailures,
        scannerAnalyzedPaths,
    });
    const report = evaluateCanonicalFindings({
        rootPath: options.rootPath,
        analyzedArtifacts: artifacts,
        executionGraph,
        profileEvidence: options.profileEvidence || { signals: [] },
        scanCompleteness: completeness,
        threatModel: options.threatModel,
        scanResults,
        scanStats,
    });
    const graphConnectedPaths = new Set(report.artifacts.map(artifact => normalizeRepositoryPath(artifact.relativePath)));
    for (const filePath of graphConnectedPaths) {
        if (lifecycle.get(filePath)?.status === 'analyzed') markLifecycle(lifecycle, filePath, 'graph_connected');
    }

    return {
        report,
        completeness,
        acquisition: options.source.getBudgetUsage(),
        lifecycle: Array.from(lifecycle.entries())
            .map(([filePath, value]) => ({ path: filePath, status: value.status, reason: value.reason }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        analyzedFiles,
    };
}
