export type ArtifactKind =
    | 'prompt'
    | 'agent'
    | 'claude'
    | 'agents'
    | 'skill'
    | 'mcp'
    | 'mcp_server'
    | 'mcp_config'
    | 'workflow'
    | 'deployment_config'
    | 'memory'
    | 'tool'
    | 'tool_router'
    | 'router'
    | 'documentation'
    | 'test'
    | 'fixture'
    | 'example'
    | 'source'
    | 'unknown';

export type ExecutionIntent = 'executable' | 'reference' | 'unknown';

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/[?#].*$/, '').toLowerCase();
}

function basename(filePath: string): string {
    const normalized = normalizePath(filePath);
    return normalized.split('/').filter(Boolean).pop() || normalized;
}

export function isGithubWorkflowPath(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    return /\.(?:ya?ml)$/.test(normalized) && (
        normalized.startsWith('.github/workflows/') ||
        normalized.includes('/.github/workflows/')
    );
}

export function inferArtifactKind(filePath: string): ArtifactKind {
    const normalized = normalizePath(filePath);
    const base = basename(filePath);

    if (isGithubWorkflowPath(filePath)) return 'workflow';
    if (/\/?(?:mcp|\.mcp)\.(?:json|ya?ml)$/.test(normalized) || normalized.endsWith('/.vscode/mcp.json') || normalized.endsWith('/.cursor/mcp.json')) return 'mcp_config';
    if (base === 'claude.md') return 'claude';
    if (base === 'agents.md' || base === 'agent.md') return 'agents';
    if (base === 'skill.md' || base === 'skills.md' || normalized.includes('/skills/')) return 'skill';
    if (isReferencePath(normalized, base)) return 'documentation';
    if (base === 'prompt.md' || /\.(?:prompt|ai|chat)(?:\.|$)/.test(normalized)) return 'prompt';
    if (normalized.includes('/prompts/') || normalized.includes('/agents/') || normalized.includes('/ai/')) return 'prompt';
    if (normalized.includes('/examples/')) return 'example';
    if (normalized.includes('/benchmarks/')) return 'example';
    if (normalized.includes('/test/') || normalized.includes('/tests/') || normalized.includes('/__tests__/')) return 'test';
    if (normalized.includes('/fixtures/') || normalized.includes('/fixture/')) return 'fixture';
    if (normalized.includes('deploy') && /\.(?:ya?ml|json|toml)$/.test(normalized)) return 'deployment_config';
    return 'source';
}

function isReferencePath(normalizedPath: string, base: string): boolean {
    const segments = normalizedPath.split('/').filter(Boolean);
    return (
        segments.some(segment => ['docs', 'doc', 'documentation', 'wiki', 'research', 'tutorial', 'tutorials'].includes(segment)) ||
        segments.some(segment => ['examples', 'example', 'benchmarks', 'benchmark'].includes(segment)) ||
        base === 'readme' ||
        base === 'readme.md' ||
        base === 'changelog.md' ||
        base === 'contributing.md' ||
        /(?:compatibility|matrix|tutorial|guide|reference|benchmark|research)/.test(base)
    );
}

export function inferExecutionIntent(filePath: string, artifactKind: ArtifactKind = inferArtifactKind(filePath)): ExecutionIntent {
    const normalized = normalizePath(filePath);
    const executableKinds: ReadonlySet<ArtifactKind> = new Set([
        'prompt',
        'agent',
        'claude',
        'agents',
        'skill',
        'mcp',
        'mcp_server',
        'mcp_config',
        'workflow',
        'deployment_config',
        'tool',
        'tool_router',
        'router',
    ]);
    if (isReferencePath(normalized, basename(filePath))) {
        return executableKinds.has(artifactKind) && !['prompt', 'source'].includes(artifactKind) ? 'executable' : 'reference';
    }
    if (artifactKind === 'documentation' || artifactKind === 'example' || artifactKind === 'test' || artifactKind === 'fixture') return 'reference';
    if (executableKinds.has(artifactKind)) return 'executable';
    return 'unknown';
}
