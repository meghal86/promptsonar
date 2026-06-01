import * as fs from 'fs';
import * as path from 'path';
import {
    analyzeExecutionPath,
    analyzeRootCause,
    evaluatePrompt,
    type AgentRuntimeAdapterInput,
    type ExecutionPathAnalysisResult,
    type Finding,
    type FindingWorkflow,
} from '@promptsonar/core';

export interface BenchmarkManifest {
    benchmarkVersion: string;
    name: string;
    description?: string;
    cases: BenchmarkCase[];
}

export interface BenchmarkCase {
    id: string;
    category: string;
    promptFile: string;
    expectedFindings: string[];
    expectedExecutionPath: string[];
    expectedRootCause: string;
    expectedConfidenceRange: {
        min: number;
        max: number;
    };
    runtime?: Omit<AgentRuntimeAdapterInput, 'activePrompt'>;
}

export interface BenchmarkCaseResult {
    id: string;
    category: string;
    promptFile: string;
    passed: boolean;
    score: number;
    expected: {
        findings: string[];
        executionPath: string[];
        rootCause: string;
        confidenceRange: { min: number; max: number };
    };
    actual: {
        findings: string[];
        executionPath: string[];
        rootCause: string | null;
        confidence: number;
        runtimeDecision?: string;
        runtimeVerdict?: string;
        replayEvents: number;
        diffRiskReduction: number | null;
    };
    accuracy: {
        findings: number;
        executionPath: number;
        rootCause: number;
        confidence: number;
    };
}

export interface BenchmarkSummary {
    benchmarkVersion: string;
    generatedAt: string;
    datasetPath: string;
    caseCount: number;
    passedCount: number;
    failedCount: number;
    score: number;
    passRate: number;
    findingsAccuracy: number;
    executionPathAccuracy: number;
    rootCauseAccuracy: number;
    confidenceAccuracy: number;
    cases: BenchmarkCaseResult[];
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function arraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueRuleIds(findings: Finding[]): string[] {
    return Array.from(new Set(findings.map(finding => finding.rule_id))).sort();
}

function pickWorkflow(result: ExecutionPathAnalysisResult | undefined, findings: Finding[]): FindingWorkflow | undefined {
    if (result?.workflow?.path?.nodes?.length) return result.workflow;
    return [...findings]
        .filter(finding => finding.workflow?.path?.nodes?.length)
        .sort((left, right) => {
            const leftWorkflow = left.workflow;
            const rightWorkflow = right.workflow;
            const leftScore = (leftWorkflow?.confidence_score ?? 0) + (leftWorkflow?.path.privilegedSinkReached ? 100 : 0);
            const rightScore = (rightWorkflow?.confidence_score ?? 0) + (rightWorkflow?.path.privilegedSinkReached ? 100 : 0);
            return rightScore - leftScore;
        })[0]?.workflow;
}

function confidenceAccuracy(actual: number, expected: { min: number; max: number }): number {
    return actual >= expected.min && actual <= expected.max ? 100 : 0;
}

function findingsAccuracy(actual: string[], expected: string[]): number {
    if (expected.length === 0) return actual.length === 0 ? 100 : 0;
    const actualSet = new Set(actual);
    const matched = expected.filter(ruleId => actualSet.has(ruleId)).length;
    return Math.round((matched / expected.length) * 100);
}

function loadManifest(datasetPath: string): BenchmarkManifest {
    const manifestPath = fs.statSync(datasetPath).isDirectory()
        ? path.join(datasetPath, 'cases.json')
        : datasetPath;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BenchmarkManifest;
}

function manifestDir(datasetPath: string): string {
    return fs.statSync(datasetPath).isDirectory()
        ? datasetPath
        : path.dirname(datasetPath);
}

function evaluateCase(testCase: BenchmarkCase, datasetDir: string): BenchmarkCaseResult {
    const promptPath = path.resolve(datasetDir, testCase.promptFile);
    const prompt = fs.readFileSync(promptPath, 'utf8');
    const promptResult = evaluatePrompt({
        text: prompt,
        context: { filePath: promptPath },
    });
    const runtimeResult = testCase.runtime
        ? analyzeExecutionPath({
            prompt,
            systemPrompt: testCase.runtime.systemPrompt,
            toolDefinitions: testCase.runtime.activeTools,
            mcpDefinitions: testCase.runtime.activeMcpServers,
            memoryConfiguration: testCase.runtime.memoryConfiguration,
            operation: testCase.runtime.operation,
            config: testCase.runtime.config,
            filePath: promptPath,
        })
        : undefined;

    const findings = runtimeResult?.findings ?? promptResult.findings;
    const workflow = pickWorkflow(runtimeResult, findings);
    const rootCause = runtimeResult?.rootCause ?? analyzeRootCause(findings);
    const actualFindings = uniqueRuleIds(findings);
    const actualPath = workflow?.path.nodes.map(node => node.type) ?? [];
    const actualRootCause = rootCause?.rootCause.rule_id ?? null;
    const actualConfidence = workflow?.confidence_score ?? workflow?.path.confidence_score ?? runtimeResult?.confidence.confidenceScore ?? 0;
    const findingScore = findingsAccuracy(actualFindings, testCase.expectedFindings);
    const pathScore = arraysEqual(actualPath, testCase.expectedExecutionPath) ? 100 : 0;
    const rootCauseScore = actualRootCause === testCase.expectedRootCause ? 100 : 0;
    const confidenceScore = confidenceAccuracy(actualConfidence, testCase.expectedConfidenceRange);
    const score = average([findingScore, pathScore, rootCauseScore, confidenceScore]);

    return {
        id: testCase.id,
        category: testCase.category,
        promptFile: testCase.promptFile,
        passed: score === 100,
        score,
        expected: {
            findings: testCase.expectedFindings,
            executionPath: testCase.expectedExecutionPath,
            rootCause: testCase.expectedRootCause,
            confidenceRange: testCase.expectedConfidenceRange,
        },
        actual: {
            findings: actualFindings,
            executionPath: actualPath,
            rootCause: actualRootCause,
            confidence: actualConfidence,
            runtimeDecision: runtimeResult?.decision,
            runtimeVerdict: runtimeResult?.executionVerdict,
            replayEvents: workflow?.workflow_replay?.events.length ?? 0,
            diffRiskReduction: workflow?.workflow_diff?.riskReduction ?? null,
        },
        accuracy: {
            findings: findingScore,
            executionPath: pathScore,
            rootCause: rootCauseScore,
            confidence: confidenceScore,
        },
    };
}

export function runBenchmark(datasetPath: string): BenchmarkSummary {
    const resolvedDatasetPath = path.resolve(datasetPath);
    const manifest = loadManifest(resolvedDatasetPath);
    const datasetDir = manifestDir(resolvedDatasetPath);
    const results = manifest.cases.map(testCase => evaluateCase(testCase, datasetDir));
    const passedCount = results.filter(result => result.passed).length;

    return {
        benchmarkVersion: manifest.benchmarkVersion,
        generatedAt: new Date().toISOString(),
        datasetPath: resolvedDatasetPath,
        caseCount: results.length,
        passedCount,
        failedCount: results.length - passedCount,
        score: average(results.map(result => result.score)),
        passRate: Math.round((passedCount / results.length) * 100),
        findingsAccuracy: average(results.map(result => result.accuracy.findings)),
        executionPathAccuracy: average(results.map(result => result.accuracy.executionPath)),
        rootCauseAccuracy: average(results.map(result => result.accuracy.rootCause)),
        confidenceAccuracy: average(results.map(result => result.accuracy.confidence)),
        cases: results,
    };
}

export function benchmarkToMarkdown(summary: BenchmarkSummary): string {
    return [
        '# PromptSonar Execution Path Benchmark Report',
        '',
        `Generated: ${summary.generatedAt}`,
        `Dataset: \`${summary.datasetPath}\``,
        '',
        '## Summary',
        '',
        `- Score: ${summary.score}/100`,
        `- Pass rate: ${summary.passRate}% (${summary.passedCount}/${summary.caseCount})`,
        `- Findings accuracy: ${summary.findingsAccuracy}%`,
        `- Execution path accuracy: ${summary.executionPathAccuracy}%`,
        `- Root cause accuracy: ${summary.rootCauseAccuracy}%`,
        `- Confidence accuracy: ${summary.confidenceAccuracy}%`,
        '',
        '## Cases',
        '',
        '| Case | Category | Findings | Path | Root Cause | Confidence | Status |',
        '|---|---|---:|---:|---:|---:|---|',
        ...summary.cases.map(result => [
            `\`${result.id}\``,
            result.category,
            `${result.accuracy.findings}%`,
            `${result.accuracy.executionPath}%`,
            `${result.accuracy.rootCause}%`,
            `${result.accuracy.confidence}%`,
            result.passed ? 'PASS' : 'FAIL',
        ].join(' | ')).map(row => `| ${row} |`),
        '',
        '## Scoring Algorithm',
        '',
        'Each case receives four equally weighted scores: expected finding coverage, exact execution-path match, exact root-cause match, and confidence range match. The benchmark score is the average case score.',
        '',
    ].join('\n');
}

export function benchmarkToTerminal(summary: BenchmarkSummary): string {
    const lines = [
        `PromptSonar Execution Path Benchmark v${summary.benchmarkVersion}`,
        `Score: ${summary.score}/100`,
        `Pass rate: ${summary.passRate}% (${summary.passedCount}/${summary.caseCount})`,
        `Findings accuracy: ${summary.findingsAccuracy}%`,
        `Execution path accuracy: ${summary.executionPathAccuracy}%`,
        `Confidence accuracy: ${summary.confidenceAccuracy}%`,
        '',
    ];

    for (const result of summary.cases) {
        lines.push(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} · ${result.category} · ${result.score}/100`);
        lines.push(`  findings ${result.accuracy.findings}% · path ${result.accuracy.executionPath}% · root cause ${result.accuracy.rootCause}% · confidence ${result.accuracy.confidence}%`);
        if (!result.passed) {
            lines.push(`  expected path: ${result.expected.executionPath.join(' -> ')}`);
            lines.push(`  actual path:   ${result.actual.executionPath.join(' -> ') || 'none'}`);
        }
    }

    return lines.join('\n');
}
