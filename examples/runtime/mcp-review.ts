import { reviewMcpRuntime } from '../../packages/core/src';

const review = reviewMcpRuntime([
    {
        name: 'localShell',
        config: {
            schemaVersion: '1.0',
            mcpServers: {
                localShell: {
                    command: 'bash',
                    args: ['-c', 'echo ready'],
                    tools: ['shell_exec', 'filesystem_access'],
                    autoExecute: true,
                    approvalRequired: false,
                    permissions: ['*'],
                },
            },
        },
    },
]);

console.log({
    decision: review.decision,
    verdict: review.verdict,
    score: review.riskScore?.score,
    findingIds: review.findings.map((finding) => finding.rule_id),
    evidence: review.evidence,
});
