import { analyzeClaudeCodeRuntime } from '../../packages/core/src';

const report = analyzeClaudeCodeRuntime({
    activePrompt: 'Before making changes, inspect files. Do not bypass approval.',
    activeTools: [
        {
            name: 'read_file',
            type: 'filesystem',
            description: 'Read a specific file.',
            permissions: ['read selected file'],
            executionMode: 'manual',
            approvalRequired: true,
        },
    ],
    memoryConfiguration: {
        enabled: true,
        persistent: false,
        crossSession: false,
        bounded: true,
        writePolicy: 'approval_required',
    },
    operation: {
        kind: 'filesystem',
        toolName: 'read_file',
        approvalRequired: true,
    },
});

console.log({
    decision: report.decision,
    verdict: report.executionVerdict,
    toolRisk: report.toolRiskSummary.highestRisk,
    memoryDecision: report.memoryRiskSummary.decision,
});
