import { analyzeCursorRuntime } from '../../packages/core/src';

const report = analyzeCursorRuntime({
    activePrompt: 'Use retrieved context to decide whether to run shell commands automatically.',
    systemPrompt: 'You are running inside an editor agent.',
    activeTools: [
        {
            name: 'workspace_shell',
            type: 'shell',
            description: 'Run terminal commands in the workspace.',
            permissions: ['execute command'],
            executionMode: 'manual',
            approvalRequired: true,
        },
        {
            name: 'read_file',
            type: 'filesystem',
            description: 'Read approved files from the workspace.',
            permissions: ['read docs/README.md'],
            executionMode: 'manual',
            approvalRequired: true,
        },
    ],
    operation: {
        kind: 'shell',
        toolName: 'workspace_shell',
        approvalRequired: true,
    },
});

console.log(report.decision, report.executionVerdict, report.workflow?.path.summary);
