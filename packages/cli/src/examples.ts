import * as fs from 'fs';
import * as path from 'path';

export interface ExampleFinding {
    ruleId: string;
    severity: string;
    description: string;
}

export interface ExampleCaseManifest {
    schemaVersion: string;
    id: string;
    category: string;
    overview: string;
    source: {
        derivedFrom: string;
        enginesReused: string[];
        scannerChanges: boolean;
    };
    vulnerableArtifact: string;
    vulnerablePrompt?: string;
    expectedFindings: ExampleFinding[];
    executionPath: {
        nodes: string[];
        display: string;
        privilegedSinkReached: boolean;
        trustBoundariesCrossed: number;
    };
    provenanceEvidence: Array<{
        node: string;
        evidence: string;
        source: string;
        ruleIds: string[];
    }>;
    confidence: {
        score: number;
        level: string;
        expectedRange: { min: number; max: number };
        source: string;
    };
    rootCause: {
        ruleId: string;
        label: string;
        supportingFindings: string[];
        source: string;
    };
    workflowReplay: {
        replayVersion: string;
        generatedFrom: string;
        eventCount: number;
        timeline: string[];
        summary: string;
    };
    workflowDiff: {
        workflowDiffVersion: string;
        executionPathRemoved: boolean;
        riskReduction: number;
        beforePath: string[];
        afterPath: string[];
        removedNodes: string[];
        diffReason: string;
    };
    remediatedArtifact: string;
    expectedRiskReduction: {
        percent: number;
        rationale: string;
    };
}

export interface ExampleCase {
    id: string;
    directory: string;
    manifest: ExampleCaseManifest;
    vulnerable: string;
    remediated: string;
}

function findUp(start: string, relativePath: string): string | null {
    let current = path.resolve(start);
    while (true) {
        const candidate = path.join(current, relativePath);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

export function resolveExamplesRoot(examplesRoot?: string): string {
    if (examplesRoot) {
        return path.resolve(examplesRoot);
    }

    const fromCwd = findUp(process.cwd(), path.join('examples', 'cases'));
    if (fromCwd) return fromCwd;

    const fromPackage = findUp(__dirname, path.join('examples', 'cases'));
    if (fromPackage) return fromPackage;

    return path.resolve(process.cwd(), 'examples', 'cases');
}

function readTextIfPresent(filePath: string): string {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

export function listExamples(examplesRoot?: string): ExampleCaseManifest[] {
    const root = resolveExamplesRoot(examplesRoot);
    if (!fs.existsSync(root)) {
        throw new Error(`Example library not found at ${root}`);
    }

    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(root, entry.name, 'expected.json'))
        .filter(filePath => fs.existsSync(filePath))
        .map(filePath => JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExampleCaseManifest)
        .sort((left, right) => left.id.localeCompare(right.id));
}

export function loadExample(id: string, examplesRoot?: string): ExampleCase {
    const root = resolveExamplesRoot(examplesRoot);
    const directory = path.join(root, id);
    const manifestPath = path.join(directory, 'expected.json');
    if (!fs.existsSync(manifestPath)) {
        const available = fs.existsSync(root)
            ? listExamples(root).map(item => item.id).join(', ')
            : 'none';
        throw new Error(`Example case "${id}" not found. Available cases: ${available}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExampleCaseManifest;
    return {
        id,
        directory,
        manifest,
        vulnerable: readTextIfPresent(path.join(directory, manifest.vulnerableArtifact)),
        remediated: readTextIfPresent(path.join(directory, manifest.remediatedArtifact)),
    };
}

export function examplesListToTerminal(examples: ExampleCaseManifest[]): string {
    return [
        'PromptSonar Example Library',
        `${examples.length} real-world execution-path cases`,
        '',
        ...examples.map(example => [
            `${example.id} - ${example.category}`,
            `  path: ${example.executionPath.display}`,
            `  root cause: ${example.rootCause.label} - confidence: ${example.confidence.score}% - risk reduction: ${example.expectedRiskReduction.percent}%`,
        ].join('\n')),
    ].join('\n');
}

export function exampleToMarkdown(example: ExampleCase): string {
    const { manifest } = example;
    return [
        `# ${manifest.category}`,
        '',
        manifest.overview,
        '',
        '## Expected Findings',
        '',
        ...manifest.expectedFindings.map(finding => `- \`${finding.ruleId}\` (${finding.severity}): ${finding.description}`),
        '',
        '## Execution Path',
        '',
        manifest.executionPath.display,
        '',
        `Trust boundaries crossed: ${manifest.executionPath.trustBoundariesCrossed}`,
        `Privileged sink reached: ${manifest.executionPath.privilegedSinkReached ? 'yes' : 'no'}`,
        '',
        '## Confidence',
        '',
        `Score: ${manifest.confidence.score}% (${manifest.confidence.level})`,
        `Expected range: ${manifest.confidence.expectedRange.min}-${manifest.confidence.expectedRange.max}%`,
        '',
        '## Root Cause',
        '',
        `\`${manifest.rootCause.ruleId}\` - ${manifest.rootCause.label}`,
        '',
        ...manifest.rootCause.supportingFindings.map(item => `- ${item}`),
        '',
        '## Workflow Replay',
        '',
        `${manifest.workflowReplay.eventCount} events: ${manifest.workflowReplay.timeline.join(' -> ')}`,
        '',
        '## Workflow Diff',
        '',
        `Execution path removed: ${manifest.workflowDiff.executionPathRemoved ? 'yes' : 'no'}`,
        `Risk reduction: ${manifest.workflowDiff.riskReduction}%`,
        `Removed nodes: ${manifest.workflowDiff.removedNodes.join(', ') || 'none'}`,
        '',
        '## Vulnerable Artifact',
        '',
        '```text',
        example.vulnerable.trim(),
        '```',
        '',
        '## Remediated Artifact',
        '',
        '```text',
        example.remediated.trim(),
        '```',
        '',
    ].join('\n');
}

export function exampleToTerminal(example: ExampleCase): string {
    const { manifest } = example;
    return [
        `${manifest.category} (${manifest.id})`,
        manifest.overview,
        '',
        `Execution path: ${manifest.executionPath.display}`,
        `Root cause: ${manifest.rootCause.label} (${manifest.rootCause.ruleId})`,
        `Confidence: ${manifest.confidence.score}% (${manifest.confidence.expectedRange.min}-${manifest.confidence.expectedRange.max}%)`,
        `Replay: ${manifest.workflowReplay.eventCount} events - ${manifest.workflowReplay.timeline.join(' -> ')}`,
        `Workflow diff: ${manifest.workflowDiff.riskReduction}% risk reduction - path removed: ${manifest.workflowDiff.executionPathRemoved ? 'yes' : 'no'}`,
        '',
        'Expected findings:',
        ...manifest.expectedFindings.map(finding => `  - ${finding.ruleId} (${finding.severity})`),
        '',
        'Vulnerable artifact:',
        example.vulnerable.trim(),
        '',
        'Remediated artifact:',
        example.remediated.trim(),
    ].join('\n');
}
