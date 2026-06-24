import * as path from 'path';
import type { RepositoryFileMetadata } from './source';

export type BudgetCategory = 'entry_point' | 'capability' | 'control' | 'reference' | 'supporting_context';

export type MetadataCandidate = {
    path: string;
    size?: number;
    objectId?: string;
    artifactNameSignals: string[];
    pathSignals: string[];
    initialPriority: number;
    reasons: string[];
};

export type SelectedMetadataCandidate = MetadataCandidate & {
    selection: {
        primaryCategory: BudgetCategory;
        reasons: string[];
    };
};

export type InitialAcquisitionSelectionOptions = {
    maxFiles: number;
    maxBytes?: number;
    categoryMinimums?: Partial<Record<BudgetCategory, number>>;
};

const CATEGORY_RANK: Record<BudgetCategory, number> = {
    entry_point: 5,
    control: 4,
    capability: 4,
    reference: 3,
    supporting_context: 2,
};

const DEFAULT_CATEGORY_MINIMUMS: Partial<Record<BudgetCategory, number>> = {
    entry_point: 1,
    control: 1,
    capability: 1,
};

const DEPENDENCY_OR_GENERATED_SEGMENTS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.turbo',
    '.vercel',
    '.cache',
    'venv',
    '.venv',
    'env',
    'site-packages',
    'dist-packages',
    'vendor',
    'target',
    '__pycache__',
]);

const SUPPORTING_DOC_SEGMENTS = new Set(['docs', 'doc', 'documentation', 'wiki']);
const TEST_SEGMENTS = new Set(['tests', 'test', '__tests__', '__test__', 'spec', '__mocks__']);
const EXAMPLE_SEGMENTS = new Set(['examples', 'example', 'demo', 'demos', 'fixtures', 'fixture', 'samples']);

function normalizeRepositoryPath(value: string): string {
    return value.replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

function pathSegments(filePath: string): string[] {
    return normalizeRepositoryPath(filePath).toLowerCase().split('/').filter(Boolean);
}

function basename(filePath: string): string {
    return path.posix.basename(normalizeRepositoryPath(filePath)).toLowerCase();
}

function addSignal(signals: string[], reasons: string[], signal: string, reason: string): void {
    signals.push(signal);
    reasons.push(reason);
}

function hasSegment(filePath: string, segments: ReadonlySet<string>): boolean {
    return pathSegments(filePath).some(segment => segments.has(segment));
}

function isGeneratedOrDependency(filePath: string): boolean {
    const name = basename(filePath);
    return hasSegment(filePath, DEPENDENCY_OR_GENERATED_SEGMENTS)
        || /\.(?:min|bundle|chunk|compiled)\.[a-z0-9]+$/.test(name)
        || name.endsWith('.map');
}

function isProductionRelevant(filePath: string): boolean {
    return !hasSegment(filePath, SUPPORTING_DOC_SEGMENTS)
        && !hasSegment(filePath, TEST_SEGMENTS)
        && !hasSegment(filePath, EXAMPLE_SEGMENTS)
        && !isGeneratedOrDependency(filePath);
}

function metadataCategory(candidate: MetadataCandidate): BudgetCategory {
    const signals = [...candidate.artifactNameSignals, ...candidate.pathSignals].join(' ');
    if (/\b(?:skill|agent-instructions|prompt|prompty|mcp-config)\b/.test(signals)) return 'entry_point';
    if (/\b(?:control|approval|authentication|authorization|sandbox|policy|allowlist|workflow)\b/.test(signals)) return 'control';
    if (/\b(?:tool-definition|docker|compose|capability)\b/.test(signals)) return 'capability';
    if (/\b(?:manifest|config|package|requirements|pyproject|tsconfig)\b/.test(signals)) return 'reference';
    return 'supporting_context';
}

function pathDepth(filePath: string): number {
    return pathSegments(filePath).length;
}

function compareCandidates(a: MetadataCandidate, b: MetadataCandidate): number {
    const priority = b.initialPriority - a.initialPriority;
    if (priority !== 0) return priority;

    // Metadata-only deterministic tie-break for Gate 1:
    // category priority -> production relevance -> shallower path -> smaller file -> lexical path.
    const category = CATEGORY_RANK[metadataCategory(b)] - CATEGORY_RANK[metadataCategory(a)];
    if (category !== 0) return category;

    const production = Number(isProductionRelevant(b.path)) - Number(isProductionRelevant(a.path));
    if (production !== 0) return production;

    const depth = pathDepth(a.path) - pathDepth(b.path);
    if (depth !== 0) return depth;

    const size = (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER);
    if (size !== 0) return size;

    return a.path.localeCompare(b.path);
}

export function discoverRepositoryCandidates(inventory: RepositoryFileMetadata[]): MetadataCandidate[] {
    return inventory.map(file => {
        const normalizedPath = normalizeRepositoryPath(file.path);
        const lower = normalizedPath.toLowerCase();
        const name = basename(normalizedPath);
        const ext = path.posix.extname(name);
        const artifactNameSignals: string[] = [];
        const pathSignals: string[] = [];
        const reasons: string[] = [];
        let initialPriority = 0;

        if (name === 'skill.md' || name === 'skills.md') {
            addSignal(artifactNameSignals, reasons, 'skill', 'known skill artifact filename');
            initialPriority += 100;
        }
        if (name === 'agents.md' || name === 'agent.md' || name === 'claude.md') {
            addSignal(artifactNameSignals, reasons, 'agent-instructions', 'known agent instruction filename');
            initialPriority += 100;
        }
        if (ext === '.prompt' || ext === '.prompty' || name.endsWith('.instructions.md')) {
            addSignal(artifactNameSignals, reasons, 'prompt', 'prompt or instruction artifact filename');
            initialPriority += 95;
        }
        if (/^(?:\.?mcp|mcp)\.(?:json|ya?ml)$/.test(name) || lower.endsWith('/.cursor/mcp.json') || lower.endsWith('/.vscode/mcp.json')) {
            addSignal(artifactNameSignals, reasons, 'mcp-config', 'MCP configuration filename');
            initialPriority += 95;
        }
        if (/^tool.*\.(?:json|ya?ml|ts|tsx|js|jsx|py)$/.test(name) || lower.includes('/tools/') || lower.includes('/tool-router')) {
            addSignal(artifactNameSignals, reasons, 'tool-definition', 'tool definition or routing path');
            initialPriority += 75;
        }
        if (lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/') || /^workflow.*\.ya?ml$/.test(name)) {
            addSignal(pathSignals, reasons, 'workflow', 'workflow configuration path');
            initialPriority += 55;
        }
        if (/^dockerfile/.test(name) || /^docker-compose.*\.ya?ml$/.test(name)) {
            addSignal(artifactNameSignals, reasons, 'docker', 'container execution configuration filename');
            initialPriority += 55;
        }
        if (/(approval|approve|allowlist|denylist|sandbox|permission|auth|authorize|authenticate|policy|readonly|read_only|allowed_paths|human_in_the_loop|confirmation|audit|rate_limit|redact)/.test(lower)) {
            addSignal(pathSignals, reasons, 'control', 'control, approval, auth, sandbox, or policy path signal');
            initialPriority += 85;
        }
        if (/^(package|requirements|pyproject|cargo|go\.mod|tsconfig|next\.config|vite\.config|action)\b/.test(name) || /\.(?:toml|lock)$/.test(name)) {
            addSignal(artifactNameSignals, reasons, 'manifest', 'manifest or build configuration filename');
            initialPriority += 45;
        }
        if (hasSegment(lower, SUPPORTING_DOC_SEGMENTS) || name === 'readme.md') {
            addSignal(pathSignals, reasons, 'documentation', 'documentation path');
            initialPriority += 20;
        }
        if (hasSegment(lower, TEST_SEGMENTS) || /\.(?:test|spec)\.[a-z0-9]+$/.test(name)) {
            addSignal(pathSignals, reasons, 'test', 'test path');
            initialPriority += 20;
        }
        if (isGeneratedOrDependency(lower)) {
            addSignal(pathSignals, reasons, 'generated-or-dependency', 'generated, dependency, or build output path');
            initialPriority -= 50;
        }

        if (file.size !== undefined && file.size > 1024 * 1024) {
            addSignal(pathSignals, reasons, 'large-file', 'large metadata size lowers initial acquisition priority');
            initialPriority -= 20;
        }

        return {
            path: normalizedPath,
            size: file.size,
            objectId: file.objectId,
            artifactNameSignals,
            pathSignals,
            initialPriority,
            reasons,
        };
    });
}

export function rankRepositoryCandidates(candidates: MetadataCandidate[]): MetadataCandidate[] {
    return [...candidates].sort(compareCandidates);
}

function selectedCandidate(candidate: MetadataCandidate): SelectedMetadataCandidate {
    const category = metadataCategory(candidate);
    return {
        ...candidate,
        selection: {
            primaryCategory: category,
            reasons: [...candidate.reasons, `selected as ${category}`],
        },
    };
}

function canFit(candidate: MetadataCandidate, selected: SelectedMetadataCandidate[], options: InitialAcquisitionSelectionOptions): boolean {
    if (selected.some(item => item.path === candidate.path)) return false;
    if (selected.length >= options.maxFiles) return false;
    const currentBytes = selected.reduce((total, item) => total + (item.size || 0), 0);
    return options.maxBytes === undefined || currentBytes + (candidate.size || 0) <= options.maxBytes;
}

export function selectInitialAcquisitionSet(
    candidates: MetadataCandidate[],
    options: InitialAcquisitionSelectionOptions,
): SelectedMetadataCandidate[] {
    if (options.maxFiles <= 0) return [];
    const ranked = rankRepositoryCandidates(candidates)
        .filter(candidate => !isGeneratedOrDependency(candidate.path));
    const selected: SelectedMetadataCandidate[] = [];
    const minimums = { ...DEFAULT_CATEGORY_MINIMUMS, ...options.categoryMinimums };

    for (const category of Object.keys(CATEGORY_RANK) as BudgetCategory[]) {
        const minimum = Math.max(0, minimums[category] || 0);
        if (minimum === 0) continue;
        for (const candidate of ranked) {
            if (selected.filter(item => item.selection.primaryCategory === category).length >= minimum) break;
            if (metadataCategory(candidate) !== category || !canFit(candidate, selected, options)) continue;
            selected.push(selectedCandidate(candidate));
        }
    }

    for (const candidate of ranked) {
        if (!canFit(candidate, selected, options)) continue;
        selected.push(selectedCandidate(candidate));
    }

    return [...selected].sort(compareCandidates);
}
