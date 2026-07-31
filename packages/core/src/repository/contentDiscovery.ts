import * as path from 'path';
import type { RepositoryFileFailureReason, RepositoryFileStatus } from './types';
import type { RepositoryFileContent, RepositoryFileMetadata } from './source';
import {
    discoverRepositoryCandidates,
    rankRepositoryCandidates,
    type BudgetCategory,
    type MetadataCandidate,
} from './discovery';

export type ArtifactProvenance =
    | 'production'
    | 'documentation'
    | 'test'
    | 'fixture'
    | 'example'
    | 'generated'
    | 'unknown';

export type ContentEnrichedCandidate = MetadataCandidate & {
    capabilitySignals: string[];
    controlSignals: string[];
    frameworkSignals: string[];
    references: string[];
    referencedBy: string[];
    provenance: ArtifactProvenance;
    priorityScore: number;
    selection: {
        primaryCategory: BudgetCategory;
        reasons: string[];
    };
};

export type AnalyzedRepositoryFile = {
    path: string;
    content: string;
    status: Extract<RepositoryFileStatus, 'analyzed'>;
    capabilitySignals: string[];
    controlSignals: string[];
    frameworkSignals: string[];
    references: string[];
};

export type RepositoryFileAnalysisFailure = {
    path: string;
    status: Extract<RepositoryFileStatus, 'failed'>;
    reason: RepositoryFileFailureReason;
};

export type ContentAnalysisResult = {
    selectedPaths: string[];
    fetchedPaths: string[];
    successful: AnalyzedRepositoryFile[];
    failures: RepositoryFileAnalysisFailure[];
};

export type ReferenceDiscoveryResult = {
    candidates: MetadataCandidate[];
    resolved: string[];
    unresolved: string[];
};

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
    [/\bopenai\b/i, 'OpenAI'],
    [/\banthropic\b/i, 'Anthropic'],
    [/\blangchain\b/i, 'LangChain'],
    [/\blanggraph\b/i, 'LangGraph'],
    [/\bcrewai\b/i, 'CrewAI'],
    [/\bautogen\b/i, 'AutoGen'],
    [/\b(?:mcp|modelcontextprotocol)\b/i, 'MCP'],
    [/\bllamaindex\b/i, 'LlamaIndex'],
    [/\bsemantic\s+kernel\b/i, 'Semantic Kernel'],
    [/\bbedrock\b/i, 'Bedrock'],
    [/\bvertex\s+ai\b/i, 'Vertex AI'],
    [/\btool_calls?\b/i, 'tool_calls'],
    [/\bfunction_call\b/i, 'function_call'],
    [/\bsystem_prompt\b/i, 'system_prompt'],
];

const CAPABILITY_PATTERNS: Array<[RegExp, string]> = [
    [/\b(?:subprocess|exec|spawn|shell|os\.system|child_process|run_command)\b/i, 'shell'],
    [/\b(?:readFile|writeFile|read_file|write_file|filesystem|fs\.|path\.write|path\.read)\b/i, 'filesystem'],
    [/\b(?:requests|fetch|axios|socket|ssh|curl)\b/i, 'network'],
    [/\b(?:docker|kubectl|terraform)\b/i, 'deployment'],
    [/\b(?:boto|aws|gcp|azure)\b/i, 'cloud'],
    [/\b(?:secret|credential|process\.env|os\.environ|api[_-]?key|token)\b/i, 'secret'],
];

const CONTROL_PATTERNS: Array<[RegExp, string]> = [
    [/\b(?:approve|approval|human_in_the_loop|confirmation)\b/i, 'approval'],
    [/\b(?:allowlist|denylist|allowed_paths|scope|permission)\b/i, 'allowlist'],
    [/\b(?:sandbox|readonly|read_only|working_directory)\b/i, 'sandbox'],
    [/\b(?:authorize|authorization|authenticate|authentication)\b/i, 'auth'],
    [/\b(?:validate|sanitize|escape)\b/i, 'validation'],
    [/\b(?:audit|rate_limit|redact)\b/i, 'audit'],
];

function normalizeRepositoryPath(value: string): string {
    return value.replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

function uniqueSorted(values: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function matchedSignals(content: string, patterns: Array<[RegExp, string]>): string[] {
    return uniqueSorted(patterns.filter(([pattern]) => pattern.test(content)).map(([, signal]) => signal));
}

function pathSegments(filePath: string): string[] {
    return normalizeRepositoryPath(filePath).toLowerCase().split('/').filter(Boolean);
}

function provenanceForPath(filePath: string): ArtifactProvenance {
    const segments = pathSegments(filePath);
    const basename = segments[segments.length - 1] || '';
    if (segments.some(segment => ['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor'].includes(segment)) || basename.endsWith('.map')) return 'generated';
    if (segments.some(segment => ['fixtures', 'fixture', 'samples', 'sample-repos'].includes(segment))) return 'fixture';
    if (segments.some(segment => ['tests', 'test', '__tests__', '__mocks__'].includes(segment)) || /\.(?:test|spec)\.[a-z0-9]+$/.test(basename)) return 'test';
    if (segments.some(segment => ['docs', 'doc', 'documentation', 'wiki'].includes(segment)) || basename === 'readme.md') return 'documentation';
    if (segments.some(segment => ['examples', 'example', 'demo', 'demos'].includes(segment))) return 'example';
    return 'production';
}

function resolveReference(fromPath: string, reference: string): string {
    const cleaned = reference.trim().replace(/^['"`]|['"`]$/g, '');
    if (!cleaned || /^[a-z]+:\/\//i.test(cleaned)) return '';
    if (cleaned.startsWith('/')) return normalizeRepositoryPath(cleaned.slice(1));
    if (cleaned.startsWith('.')) return normalizeRepositoryPath(path.posix.join(path.posix.dirname(normalizeRepositoryPath(fromPath)), cleaned));
    return normalizeRepositoryPath(cleaned);
}

function extractReferenceStrings(filePath: string, content: string): string[] {
    const references = new Set<string>();
    const patterns = [
        /\b(?:from|require|import|load|include|source|policy|approval|sandbox|config|tool|workflow)\s*\(?\s*["'`]([^"'`]+)["'`]/gi,
        /\[[^\]]+]\(([^)]+)\)/g,
        /\b([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|json|ya?ml|toml|md|prompt|prompty))\b/g,
    ];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const resolved = resolveReference(filePath, match[1]);
            if (resolved && !resolved.includes('..')) references.add(resolved);
        }
    }
    return uniqueSorted(references);
}

function categoryForContent(candidate: MetadataCandidate, contentSignals: {
    capabilitySignals: string[];
    controlSignals: string[];
    references: string[];
}): BudgetCategory {
    if (candidate.artifactNameSignals.some(signal => ['skill', 'agent-instructions', 'prompt', 'mcp-config'].includes(signal))) return 'entry_point';
    if (contentSignals.controlSignals.length > 0 || candidate.pathSignals.includes('control')) return 'control';
    if (contentSignals.capabilitySignals.length > 0 || candidate.artifactNameSignals.includes('tool-definition')) return 'capability';
    if (contentSignals.references.length > 0 || candidate.artifactNameSignals.includes('manifest')) return 'reference';
    return 'supporting_context';
}

function scoreContentCandidate(candidate: MetadataCandidate, analyzed?: AnalyzedRepositoryFile, referencedBy: string[] = []): number {
    let score = candidate.initialPriority;
    if (candidate.artifactNameSignals.some(signal => ['skill', 'agent-instructions'].includes(signal))) score += 100;
    if (candidate.artifactNameSignals.some(signal => ['mcp-config', 'prompt'].includes(signal))) score += 95;
    if ((analyzed?.capabilitySignals || []).length > 0) score += 90;
    if ((analyzed?.controlSignals || []).length > 0 || candidate.pathSignals.includes('control')) score += 85;
    if (referencedBy.length > 0) score += 65;
    if ((analyzed?.frameworkSignals || []).length > 0) score += 45;
    if (provenanceForPath(candidate.path) === 'generated') score -= 40;
    return score;
}

function compareContentCandidates(a: ContentEnrichedCandidate, b: ContentEnrichedCandidate): number {
    const score = b.priorityScore - a.priorityScore;
    if (score !== 0) return score;
    const controlClose = Number(b.controlSignals.length > 0 && b.referencedBy.length > 0) - Number(a.controlSignals.length > 0 && a.referencedBy.length > 0);
    if (controlClose !== 0) return controlClose;
    const referenced = Number(b.referencedBy.length > 0) - Number(a.referencedBy.length > 0);
    if (referenced !== 0) return referenced;
    const categoryRank: Record<BudgetCategory, number> = { entry_point: 5, control: 4, capability: 4, reference: 3, supporting_context: 2 };
    const category = categoryRank[b.selection.primaryCategory] - categoryRank[a.selection.primaryCategory];
    if (category !== 0) return category;
    const production = Number(b.provenance === 'production') - Number(a.provenance === 'production');
    if (production !== 0) return production;
    const size = (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER);
    if (size !== 0) return size;
    return a.path.localeCompare(b.path);
}

export function analyzeFetchedFiles(
    files: RepositoryFileContent[],
    options: { selectedPaths?: string[] } = {},
): ContentAnalysisResult {
    const selectedPaths = uniqueSorted(options.selectedPaths || files.map(file => file.path).map(normalizeRepositoryPath));
    const fetchedPaths = uniqueSorted(files.map(file => file.path).map(normalizeRepositoryPath));
    const successful: AnalyzedRepositoryFile[] = [];
    const failures: RepositoryFileAnalysisFailure[] = [];

    for (const file of files) {
        const filePath = normalizeRepositoryPath(file.path);
        const content = String(file.content || '');
        if (content.includes('\0')) {
            failures.push({ path: filePath, status: 'failed', reason: 'binary' });
            continue;
        }
        successful.push({
            path: filePath,
            content,
            status: 'analyzed',
            capabilitySignals: matchedSignals(content, CAPABILITY_PATTERNS),
            controlSignals: matchedSignals(content, CONTROL_PATTERNS),
            frameworkSignals: matchedSignals(content, FRAMEWORK_PATTERNS),
            references: extractReferenceStrings(filePath, content),
        });
    }

    return { selectedPaths, fetchedPaths, successful, failures };
}

export function enrichCandidates(
    metadataCandidates: MetadataCandidate[],
    analysis: ContentAnalysisResult,
): ContentEnrichedCandidate[] {
    const analyzedByPath = new Map(analysis.successful.map(file => [file.path, file]));
    const referencedBy = new Map<string, string[]>();
    for (const file of analysis.successful) {
        for (const reference of file.references) {
            referencedBy.set(reference, [...(referencedBy.get(reference) || []), file.path]);
        }
    }

    return metadataCandidates.map(candidate => {
        const analyzed = analyzedByPath.get(candidate.path);
        const inboundReferences = uniqueSorted(referencedBy.get(candidate.path) || []);
        const contentSignals = {
            capabilitySignals: analyzed?.capabilitySignals || [],
            controlSignals: analyzed?.controlSignals || [],
            references: analyzed?.references || [],
        };
        const category = categoryForContent(candidate, contentSignals);
        const reasons = [
            ...candidate.reasons,
            ...contentSignals.capabilitySignals.map(signal => `capability signal: ${signal}`),
            ...contentSignals.controlSignals.map(signal => `control signal: ${signal}`),
            ...inboundReferences.map(source => `referenced by ${source}`),
        ];
        return {
            ...candidate,
            capabilitySignals: contentSignals.capabilitySignals,
            controlSignals: contentSignals.controlSignals,
            frameworkSignals: analyzed?.frameworkSignals || [],
            references: contentSignals.references,
            referencedBy: inboundReferences,
            provenance: provenanceForPath(candidate.path),
            priorityScore: scoreContentCandidate(candidate, analyzed, inboundReferences),
            selection: {
                primaryCategory: category,
                reasons,
            },
        };
    });
}

export function rankContentEnrichedCandidates(candidates: ContentEnrichedCandidate[]): ContentEnrichedCandidate[] {
    return [...candidates].sort(compareContentCandidates);
}

export function extractReferences(
    analyzedFiles: AnalyzedRepositoryFile[],
    inventory: RepositoryFileMetadata[],
): ReferenceDiscoveryResult {
    const inventoryByPath = new Map(inventory.map(file => [normalizeRepositoryPath(file.path), { ...file, path: normalizeRepositoryPath(file.path) }]));
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const file of analyzedFiles) {
        for (const reference of file.references) {
            if (inventoryByPath.has(reference)) resolved.push(reference);
            else unresolved.push(reference);
        }
    }
    const candidates = discoverRepositoryCandidates(uniqueSorted(resolved).map(reference => inventoryByPath.get(reference)!));
    return {
        candidates: rankRepositoryCandidates(candidates),
        resolved: uniqueSorted(resolved),
        unresolved: uniqueSorted(unresolved),
    };
}

export function findControlNeighborhood(
    analyzedFiles: AnalyzedRepositoryFile[],
    references: ReferenceDiscoveryResult,
    inventory: RepositoryFileMetadata[],
): MetadataCandidate[] {
    const hasPrivilegedCapability = analyzedFiles.some(file =>
        file.capabilitySignals.some(signal => ['shell', 'filesystem', 'secret', 'deployment', 'cloud'].includes(signal))
    );
    if (!hasPrivilegedCapability) return [];

    const analyzedPaths = new Set(analyzedFiles.map(file => file.path));
    const referencedPaths = new Set(references.resolved);
    const candidates = discoverRepositoryCandidates(inventory).filter(candidate => {
        if (analyzedPaths.has(candidate.path)) return false;
        const lower = candidate.path.toLowerCase();
        return candidate.pathSignals.includes('control')
            || referencedPaths.has(candidate.path)
            || /(approval|allowlist|denylist|sandbox|permission|auth|policy|readonly|allowed_paths|audit|rate_limit|redact)/.test(lower);
    });

    return rankRepositoryCandidates(candidates);
}
