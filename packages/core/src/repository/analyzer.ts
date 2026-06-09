import * as fs from 'fs';
import * as path from 'path';
import type {
    AnalyzeRepositoryOptions,
    ReachableExecutionPath,
    RepositoryArtifact,
    RepositoryArtifactType,
    RepositoryExecutionEdge,
    RepositoryExecutionGraphPath,
    RepositoryExecutionMap,
    RepositoryExecutionNode,
    RepositoryExecutionNodeType,
    RepositoryExecutionIssue,
    RepositoryExecutionReport,
    RepositoryIssueSummary,
    RepositoryRisk,
    RepositoryScanFinding,
    RepositoryScanResult,
    RepositorySensitiveAction,
    RepositorySummary,
    RepositoryTrustStatus,
} from './types';

const REPORT_VERSION = '1.2.0';
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;

const IGNORED_DIRECTORIES = new Set([
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
    'tmp',
    'logs',
]);

const TEXT_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.prompt',
    '.ai',
    '.chat',
    '.system',
    '.json',
    '.yaml',
    '.yml',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.cs',
]);

const SENSITIVE_ACTION_LABELS: Record<RepositorySensitiveAction, string> = {
    Shell: 'Shell Execution',
    Filesystem: 'Filesystem Access',
    Network: 'Network Access',
    Secrets: 'Secret Access',
    'External APIs': 'External API Access',
};

const SECRET_VALUE_PATTERNS = [
    /sk-(?:live|test|proj)-[A-Za-z0-9_-]{16,}/g,
    /ghp_[A-Za-z0-9]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /Bearer\s+[A-Za-z0-9._-]{16,}/g,
    /((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{12,}/gi,
];

function confidenceLabelFromScore(confidence: number): 'Confirmed' | 'Probable' | 'Potential' {
    if (confidence >= 85) return 'Confirmed';
    if (confidence >= 70) return 'Probable';
    return 'Potential';
}

function pathConfidenceLabel(level: 'confirmed' | 'probable' | 'potential'): 'Confirmed' | 'Probable' | 'Potential' {
    if (level === 'confirmed') return 'Confirmed';
    if (level === 'probable') return 'Probable';
    return 'Potential';
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

function stableId(prefix: string, value: string): string {
    return `${prefix}:${normalizePath(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)}`;
}

function redactSecrets(value: string): string {
    return SECRET_VALUE_PATTERNS.reduce((current, pattern) => {
        if (pattern.source.startsWith('((?:api')) {
            return current.replace(pattern, '$1[REDACTED]');
        }
        return current.replace(pattern, '[REDACTED]');
    }, value);
}

function sanitizeStringArray(values: string[] | undefined): string[] | undefined {
    return values?.map(value => redactSecrets(value));
}

function safeRead(filePath: string, maxFileSizeBytes: number): string | undefined {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > maxFileSizeBytes) return undefined;
        const ext = path.extname(filePath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext) && path.basename(filePath).toLowerCase() !== 'agents.md') return undefined;
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
}

function walkRepository(root: string, options: Required<AnalyzeRepositoryOptions>): string[] {
    const files: string[] = [];
    const visit = (dir: string) => {
        if (files.length >= options.maxFiles) return;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (files.length >= options.maxFiles) break;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name)) visit(fullPath);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    };

    visit(root);
    return files;
}

function lineEvidence(content: string, pattern: RegExp, fallback: string): string {
    const line = content.split(/\r?\n/).find(candidate => pattern.test(candidate));
    return (line || fallback).trim().replace(/\s+/g, ' ').slice(0, 220);
}

function extractReferences(content: string): string[] {
    const references = new Set<string>();
    const patterns = [
        /(?:use|load|invoke|call|route to|read from|write to|server|tool|skill)\s+["'`]?([A-Za-z0-9_.@/-]{3,})["'`]?/gi,
        /(?:mcpServers|tools|skills|workflows|memory)\s*[:=]/gi,
    ];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            if (match[1]) references.add(match[1]);
        }
    }
    return Array.from(references).slice(0, 25);
}

function detectSensitiveActions(text: string): RepositorySensitiveAction[] {
    const normalized = text.replace(/[_-]/g, ' ');
    const actions = new Set<RepositorySensitiveAction>();
    if (/\b(shell|bash|terminal|exec|spawn|subprocess|command|run\s+command)\b/i.test(normalized)) actions.add('Shell');
    if (/\b(filesystem|file\s*(read|write)|read\s+file|write\s+file|read\s+all\s+files|write\s+all\s+files|workspace|directory)\b/i.test(normalized)) actions.add('Filesystem');
    if (/\b(network|http|https|fetch|curl|webhook|internal api|network\s+request)\b/i.test(normalized)) actions.add('Network');
    if (/\b(secret|secrets|read\s+secret|token|api\s*key|password|credential|credentials|bearer)\b/i.test(normalized)) actions.add('Secrets');
    if (/https?:\/\/|\bexternal\s+api\b|\bapi\./i.test(text)) actions.add('External APIs');
    return Array.from(actions);
}

function parseMcpServers(content: string): Array<{ name: string; body: string }> {
    try {
        const parsed = JSON.parse(content);
        const rawServers = parsed?.mcpServers || parsed?.servers || {};
        if (Array.isArray(rawServers)) {
            return rawServers.map((server, index) => ({
                name: String(server?.name || server?.id || `server-${index + 1}`),
                body: JSON.stringify(server),
            }));
        }
        if (rawServers && typeof rawServers === 'object') {
            return Object.entries(rawServers).map(([name, server]) => ({
                name,
                body: JSON.stringify(server),
            }));
        }
    } catch {
        // YAML and malformed JSON still get a config-level artifact below.
    }
    return [];
}

function mcpParseWarning(relativePath: string, content: string): string | undefined {
    if (!relativePath.toLowerCase().endsWith('.json')) return undefined;
    try {
        JSON.parse(content);
        return undefined;
    } catch {
        return 'MCP config could not be parsed as JSON; review required.';
    }
}

function classifyFile(root: string, filePath: string, content: string): RepositoryArtifact[] {
    const relativePath = normalizePath(path.relative(root, filePath));
    const lower = relativePath.toLowerCase();
    const basename = path.basename(lower);
    const ext = path.extname(lower);
    const isPromptPath = lower.startsWith('prompts/') || lower.includes('/prompts/') || ['.prompt', '.ai', '.chat', '.system'].includes(ext);
    const artifacts: RepositoryArtifact[] = [];
    const add = (type: RepositoryArtifactType, name: string, description: string, signals: string[], evidence: string[], metadata?: RepositoryArtifact['metadata']) => {
        artifacts.push({
            id: stableId('artifact', `${type}:${relativePath}:${name}`),
            type,
            name,
            filePath,
            relativePath,
            description,
            evidence: sanitizeStringArray(evidence) || [],
            signals,
            metadata: metadata ? {
                ...metadata,
                capabilities: sanitizeStringArray(metadata.capabilities),
                constraints: sanitizeStringArray(metadata.constraints),
                permissions: sanitizeStringArray(metadata.permissions),
                references: sanitizeStringArray(metadata.references),
            } : undefined,
        });
    };

    if (lower.endsWith('/mcp.json') || lower.endsWith('/mcp.yaml') || lower.endsWith('/mcp.yml') || lower === 'mcp.json' || lower === 'mcp.yaml' || lower === 'mcp.yml' || lower.endsWith('/.cursor/mcp.json') || lower.endsWith('/.vscode/mcp.json') || basename === 'claude_desktop_config.json') {
        const servers = parseMcpServers(content);
        const serverArtifacts = servers.length > 0 ? servers : [{ name: path.basename(filePath), body: content }];
        const parseWarning = mcpParseWarning(relativePath, content);
        for (const server of serverArtifacts) {
            const sensitiveActions = detectSensitiveActions(server.body);
            add('MCP_SERVER', server.name, 'MCP server configuration discovered in repository config.', ['mcp-config'], [lineEvidence(content, /mcpServers|servers|command|args|tools|permissions/i, relativePath)], {
                servers: [server.name],
                permissions: Array.from(server.body.matchAll(/"?(permissions|scopes|allow|allowAll|autoApprove|autoExecute)"?\s*[:=]\s*([^,\n}]+)/gi)).map(match => `${match[1]}=${String(match[2]).trim()}`).slice(0, 12),
                autoApprove: /\b(autoApprove|auto_approve|autoExecute|auto_execute|skip confirmation|without approval)\b/i.test(server.body),
                parseWarning,
                sensitiveActions,
                references: extractReferences(server.body),
            });
        }
        return artifacts;
    }

    if (basename === 'skill.md' || lower.includes('/skills/') || lower.includes('/.codex/skills/') || lower.includes('/.agents/skills/')) {
        add('SKILL', path.basename(path.dirname(filePath)) || path.basename(filePath), 'Agent skill instructions discovered.', ['skill-instructions'], [lineEvidence(content, /skill|tool|capabilit|constraint|use when/i, relativePath)], {
            capabilities: Array.from(content.matchAll(/\b(?:capabilit(?:y|ies)|use when|supports?)[:\s-]+(.+)/gi)).map(match => match[1].trim()).slice(0, 10),
            constraints: Array.from(content.matchAll(/\b(?:do not|never|only|must|important)[:\s-]+(.+)/gi)).map(match => match[0].trim()).slice(0, 10),
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
        return artifacts;
    }

    if (lower === 'agents.md' || lower.endsWith('/agents.md')) {
        add('AGENT_CONFIG', path.basename(filePath), 'Repository agent instruction file discovered.', ['agent-instructions'], [lineEvidence(content, /agent|codex|cursor|claude|instructions/i, relativePath)], {
            constraints: Array.from(content.matchAll(/\b(?:do not|never|only|must|important)[:\s-]+(.+)/gi)).map(match => match[0].trim()).slice(0, 10),
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
        return artifacts;
    }

    if (lower.startsWith('.cursor/') || lower.includes('/.cursor/') || lower.startsWith('.claude/') || lower.includes('/.claude/') || lower.startsWith('.agents/') || lower.includes('/.agents/') || lower.startsWith('.github/copilot/') || lower.includes('/.github/copilot/')) {
        add('AGENT_CONFIG', path.basename(filePath), 'Agent configuration discovered.', ['agent-config'], [lineEvidence(content, /agent|prompt|tool|mcp|instruction|model/i, relativePath)], {
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
        return artifacts;
    }

    if (basename.includes('memory') || lower.includes('/memory/')) {
        add('MEMORY', path.basename(filePath), 'Agent memory artifact discovered.', ['memory-store'], [lineEvidence(content, /memory|remember|persist|session|history/i, relativePath)], {
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
        return artifacts;
    }

    if (lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/') || basename.includes('workflow') || basename.includes('pipeline') || basename === 'action.yml' || basename === 'action.yaml') {
        add(basename.startsWith('action.') ? 'ACTION' : 'WORKFLOW', path.basename(filePath), 'Workflow or action orchestration file discovered.', ['workflow-config'], [lineEvidence(content, /workflow|jobs|steps|uses|run|tool|prompt|mcp/i, relativePath)], {
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
        return artifacts;
    }

    if (!isPromptPath && (basename.includes('tool') || basename.includes('router') || basename.includes('registry') || /\b(tool router|tool_registry|function call|tools\s*[:=]|toolDefinitions)\b/i.test(content))) {
        add('TOOL', path.basename(filePath), 'Tool registry or tool-routing artifact discovered.', ['tool-definition'], [lineEvidence(content, /tool|router|function call|execute|invoke/i, relativePath)], {
            tools: Array.from(content.matchAll(/\b(?:tool|name|function)\s*[:=]\s*["'`]?([A-Za-z0-9_.-]{3,})/gi)).map(match => match[1]).slice(0, 20),
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
        return artifacts;
    }

    if (isPromptPath || /\b(system|assistant|developer)\s+prompt\b/i.test(content) || /\{\{[^}]+}}/.test(content) || (ext === '.md' && /\b(prompt template|system instructions|assistant instructions)\b/i.test(content))) {
        add('PROMPT', path.basename(filePath), 'Prompt or prompt template discovered.', ['prompt-template'], [lineEvidence(content, /prompt template|system prompt|assistant prompt|developer prompt|instructions|tool|shell|filesystem|mcp|{{/i, relativePath)], {
            sensitiveActions: detectSensitiveActions(content),
            references: extractReferences(content),
        });
    }

    return artifacts;
}

export function analyzeRepository(rootPath: string, options: AnalyzeRepositoryOptions = {}): RepositoryArtifact[] {
    const root = path.resolve(rootPath);
    const resolvedOptions = {
        maxFiles: options.maxFiles || DEFAULT_MAX_FILES,
        maxFileSizeBytes: options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES,
    };
    const files = fs.statSync(root).isDirectory() ? walkRepository(root, resolvedOptions) : [root];
    const artifacts: RepositoryArtifact[] = [];
    for (const filePath of files) {
        const content = safeRead(filePath, resolvedOptions.maxFileSizeBytes);
        if (content === undefined) continue;
        artifacts.push(...classifyFile(fs.statSync(root).isDirectory() ? root : path.dirname(root), filePath, content));
    }
    return artifacts.sort((a, b) => `${a.relativePath}:${a.type}:${a.name}`.localeCompare(`${b.relativePath}:${b.type}:${b.name}`));
}

function nodeTypeForArtifact(type: RepositoryArtifactType): RepositoryExecutionNodeType {
    if (type === 'AGENT_CONFIG') return 'PROMPT';
    return type;
}

function edgeId(from: string, to: string, type: string): string {
    return stableId('edge', `${from}:${type}:${to}`);
}

function addEdge(edges: Map<string, RepositoryExecutionEdge>, from: string, to: string, type: RepositoryExecutionEdge['type'], reason: string, evidence: string | undefined, confidence: number): void {
    if (from === to) return;
    const id = edgeId(from, to, type);
    if (edges.has(id)) return;
    const isInferred = /inferred|can route|can invoke|can read|can reference|can route|can reach/i.test(reason);
    const label = isInferred ? (confidence >= 70 ? 'Probable' : 'Potential') : confidenceLabelFromScore(confidence);
    edges.set(id, {
        id,
        from,
        to,
        type,
        relationship: type,
        reason,
        evidence: evidence ? redactSecrets(evidence) : undefined,
        evidenceRefs: evidence ? [stableId('evidence', `${from}:${to}:${type}:${evidence}`)] : [],
        confidence,
        confidenceLabel: label,
    });
}

function artifactText(artifact: RepositoryArtifact): string {
    return [
        artifact.name,
        artifact.relativePath,
        artifact.description,
        ...(artifact.evidence || []),
        ...(artifact.signals || []),
        ...(artifact.metadata?.references || []),
        ...(artifact.metadata?.tools || []),
        ...(artifact.metadata?.servers || []),
    ].join(' ').toLowerCase();
}

function addSensitiveActionNodes(nodes: Map<string, RepositoryExecutionNode>, edges: Map<string, RepositoryExecutionEdge>, sourceNodeId: string, actions: RepositorySensitiveAction[], evidence?: string): void {
    for (const action of actions) {
        const actionNodeId = stableId('node', `ACTION:${action}`);
        if (!nodes.has(actionNodeId)) {
            nodes.set(actionNodeId, {
                id: actionNodeId,
                type: 'ACTION',
                label: SENSITIVE_ACTION_LABELS[action],
                description: `Reachable sensitive action: ${action}.`,
                metadata: { action },
            });
        }
        addEdge(edges, sourceNodeId, actionNodeId, 'CAN_REACH', evidence ? `${action} capability derived from direct artifact evidence.` : `${action} capability inferred from artifact metadata.`, evidence ? redactSecrets(evidence) : undefined, evidence ? 85 : 65);
    }
}

function riskForActions(actions: RepositorySensitiveAction[], findings: RepositoryScanFinding[] = []): RepositoryRisk {
    if (findings.some(f => !f.waived && f.severity === 'critical')) return 'critical';
    if (actions.includes('Shell') || findings.some(f => !f.waived && f.severity === 'high')) return 'high';
    if (actions.includes('Secrets') || actions.includes('Filesystem') || actions.includes('Network')) return 'medium';
    return 'low';
}

export function buildRepositoryExecutionMap(artifacts: RepositoryArtifact[], scanResults: RepositoryScanResult[] = []): RepositoryExecutionMap {
    const nodes = new Map<string, RepositoryExecutionNode>();
    const edges = new Map<string, RepositoryExecutionEdge>();
    const nodeIdByArtifact = new Map<string, string>();

    for (const artifact of artifacts) {
        const nodeId = stableId('node', artifact.id);
        nodeIdByArtifact.set(artifact.id, nodeId);
        nodes.set(nodeId, {
            id: nodeId,
            type: nodeTypeForArtifact(artifact.type),
            label: artifact.name,
            filePath: artifact.filePath,
            relativePath: artifact.relativePath,
            artifactId: artifact.id,
            description: artifact.description,
            metadata: {
                artifactType: artifact.type,
                signals: artifact.signals,
                ...artifact.metadata,
            },
        });
        const directActionTypes = new Set<RepositoryArtifactType>(['MCP_SERVER', 'TOOL', 'MEMORY']);
        if (directActionTypes.has(artifact.type)) {
            addSensitiveActionNodes(nodes, edges, nodeId, artifact.metadata?.sensitiveActions || [], artifact.evidence[0]);
        }
    }

    const byType = (type: RepositoryArtifactType) => artifacts.filter(artifact => artifact.type === type);
    const prompts = artifacts.filter(artifact => artifact.type === 'PROMPT' || artifact.type === 'AGENT_CONFIG');
    const skills = byType('SKILL');
    const tools = byType('TOOL');
    const mcps = byType('MCP_SERVER');
    const memories = byType('MEMORY');
    const workflows = byType('WORKFLOW').concat(byType('ACTION'));

    for (const source of artifacts) {
        const sourceNode = nodeIdByArtifact.get(source.id);
        if (!sourceNode) continue;
        const sourceText = artifactText(source);
        for (const target of artifacts) {
            if (source.id === target.id) continue;
            const targetNode = nodeIdByArtifact.get(target.id);
            if (!targetNode) continue;
            const targetName = target.name.toLowerCase();
            const targetBase = path.basename(target.relativePath).toLowerCase();
            if (sourceText.includes(targetName) || sourceText.includes(target.relativePath.toLowerCase()) || (targetBase.length > 4 && sourceText.includes(targetBase))) {
                addEdge(edges, sourceNode, targetNode, 'REFERENCES', `${source.name} references ${target.name}.`, source.evidence[0], 75);
            }
        }
    }

    for (const prompt of prompts) {
        const sourceNode = nodeIdByArtifact.get(prompt.id);
        if (!sourceNode) continue;
        for (const memory of memories) addEdge(edges, sourceNode, nodeIdByArtifact.get(memory.id)!, 'READS', 'Prompt or agent config can read repository memory context.', prompt.evidence[0], 55);
        for (const skill of skills) addEdge(edges, sourceNode, nodeIdByArtifact.get(skill.id)!, 'INVOKES', 'Prompt or agent config can invoke discovered agent skills.', prompt.evidence[0], 60);
        for (const tool of tools) addEdge(edges, sourceNode, nodeIdByArtifact.get(tool.id)!, 'ROUTES_TO', 'Prompt or agent config can route work to tool definitions.', prompt.evidence[0], 60);
        for (const mcp of mcps) {
            const promptActions = prompt.metadata?.sensitiveActions || [];
            const mcpActions = mcp.metadata?.sensitiveActions || [];
            if (promptActions.some(action => mcpActions.includes(action))) {
                addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'INVOKES', 'Direct prompt evidence references a sensitive action exposed by a configured MCP server.', prompt.evidence[0], 85);
            }
        }
    }

    for (const skill of skills) {
        const sourceNode = nodeIdByArtifact.get(skill.id);
        if (!sourceNode) continue;
        for (const tool of tools) addEdge(edges, sourceNode, nodeIdByArtifact.get(tool.id)!, 'ROUTES_TO', 'Skill can route instructions to a tool surface.', skill.evidence[0], 65);
        for (const mcp of mcps) addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'INVOKES', 'Skill can invoke MCP server capabilities.', skill.evidence[0], 60);
    }

    for (const tool of tools) {
        const sourceNode = nodeIdByArtifact.get(tool.id);
        if (!sourceNode) continue;
        for (const mcp of mcps) addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'ROUTES_TO', 'Tool surface can route to MCP server capability.', tool.evidence[0], 70);
    }

    for (const workflow of workflows) {
        const sourceNode = nodeIdByArtifact.get(workflow.id);
        if (!sourceNode) continue;
        for (const prompt of prompts) addEdge(edges, sourceNode, nodeIdByArtifact.get(prompt.id)!, 'REFERENCES', 'Workflow can reference prompt or agent instructions.', workflow.evidence[0], 55);
        for (const tool of tools) addEdge(edges, sourceNode, nodeIdByArtifact.get(tool.id)!, 'INVOKES', 'Workflow can invoke tool definitions.', workflow.evidence[0], 65);
        for (const mcp of mcps) addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'INVOKES', 'Workflow can invoke MCP server configuration.', workflow.evidence[0], 65);
    }

    for (const result of scanResults) {
        const related = artifacts.find(artifact => path.resolve(artifact.filePath) === path.resolve(result.filePath));
        const sourceNode = related ? nodeIdByArtifact.get(related.id) : undefined;
        if (!sourceNode) continue;
        if (related && ['PROMPT', 'SKILL', 'AGENT_CONFIG'].includes(related.type)) continue;
        const actions = new Set<RepositorySensitiveAction>();
        for (const finding of result.findings || []) {
            if (finding.waived) continue;
            const workflowNodes = finding.workflow?.path?.nodes || [];
            for (const workflowNode of workflowNodes) {
                if (workflowNode.type === 'shell_execution') actions.add('Shell');
                if (workflowNode.type === 'filesystem_access') actions.add('Filesystem');
                if (workflowNode.type === 'network_access') actions.add('Network');
                if (workflowNode.type === 'credential_store' || workflowNode.type === 'secret') actions.add('Secrets');
                if (workflowNode.type === 'external_api') actions.add('External APIs');
            }
            detectSensitiveActions(`${finding.message || ''}\n${finding.evidence || ''}\n${finding.fix || ''}`).forEach(action => actions.add(action));
        }
        addSensitiveActionNodes(nodes, edges, sourceNode, Array.from(actions), result.findings?.[0]?.evidence);
    }

    const graph = {
        nodes: Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id)),
        edges: Array.from(edges.values()).sort((a, b) => a.id.localeCompare(b.id)),
        paths: [] as RepositoryExecutionGraphPath[],
    };
    graph.paths = inferGraphPaths(graph, scanResults);
    return graph;
}

function inferGraphPaths(graph: RepositoryExecutionMap, scanResults: RepositoryScanResult[]): RepositoryExecutionGraphPath[] {
    const adjacency = new Map<string, RepositoryExecutionEdge[]>();
    for (const edge of graph.edges) {
        const existing = adjacency.get(edge.from) || [];
        existing.push(edge);
        adjacency.set(edge.from, existing);
    }
    const actionNodes = new Set(graph.nodes.filter(node => node.type === 'ACTION' && node.metadata?.action).map(node => node.id));
    const startNodes = graph.nodes.filter(node => ['PROMPT', 'SKILL', 'MEMORY', 'WORKFLOW'].includes(node.type)).map(node => node.id);
    const paths: RepositoryExecutionGraphPath[] = [];
    const findingsByFile = new Map(scanResults.map(result => [path.resolve(result.filePath), result.findings || []]));
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));

    for (const start of startNodes) {
        const queue: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [{ nodeId: start, nodeIds: [start], edgeIds: [] }];
        while (queue.length > 0 && paths.length < 100) {
            const current = queue.shift()!;
            if (current.nodeIds.length > 6) continue;
            if (actionNodes.has(current.nodeId) && current.edgeIds.length > 0) {
                const nodes = current.nodeIds.map(id => nodeById.get(id)).filter(Boolean) as RepositoryExecutionNode[];
                const actions = nodes.map(node => node.metadata?.action).filter(Boolean) as RepositorySensitiveAction[];
                const findings = nodes.flatMap(node => node.filePath ? (findingsByFile.get(path.resolve(node.filePath)) || []) : []);
                paths.push({
                    id: stableId('path', current.nodeIds.join('>')),
                    nodeIds: current.nodeIds,
                    edgeIds: current.edgeIds,
                    risk: riskForActions(actions, findings),
                    explanation: nodes.map(node => node.label).join(' -> '),
                });
                continue;
            }
            for (const edge of adjacency.get(current.nodeId) || []) {
                if (current.nodeIds.includes(edge.to)) continue;
                queue.push({ nodeId: edge.to, nodeIds: [...current.nodeIds, edge.to], edgeIds: [...current.edgeIds, edge.id] });
            }
        }
    }

    const seen = new Set<string>();
    return paths.filter(pathItem => {
        const key = pathItem.nodeIds.join('>');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function actionFromWorkflowNode(type: string): RepositorySensitiveAction | undefined {
    if (type === 'shell_execution') return 'Shell';
    if (type === 'filesystem_access') return 'Filesystem';
    if (type === 'network_access') return 'Network';
    if (type === 'credential_store' || type === 'secret') return 'Secrets';
    if (type === 'external_api') return 'External APIs';
    return undefined;
}

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzeReachablePaths(executionMap: RepositoryExecutionMap, artifacts: RepositoryArtifact[], scanResults: RepositoryScanResult[] = []): ReachableExecutionPath[] {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    const edgesById = new Map(executionMap.edges.map(edge => [edge.id, edge]));
    const paths: ReachableExecutionPath[] = [];
    const graphPathsByStartFile = new Map<string, RepositoryExecutionGraphPath[]>();
    for (const graphPath of executionMap.paths) {
        const first = nodesById.get(graphPath.nodeIds[0]);
        if (first?.filePath) {
            const key = path.resolve(first.filePath);
            const existing = graphPathsByStartFile.get(key) || [];
            existing.push(graphPath);
            graphPathsByStartFile.set(key, existing);
        }
    }

    for (const result of scanResults) {
        for (const finding of result.findings || []) {
            if (finding.waived || !finding.workflow?.path?.nodes) continue;
            const workflowNodes = finding.workflow.path.nodes as Array<{ type: string; label?: string }>;
            const sensitiveActions = Array.from(new Set(workflowNodes.map(node => actionFromWorkflowNode(node.type)).filter(Boolean))) as RepositorySensitiveAction[];
            if (sensitiveActions.length === 0 && !finding.workflow.path.privilegedSinkReached) continue;

            const matchingGraphPath = (graphPathsByStartFile.get(path.resolve(result.filePath)) || []).find(candidate => {
                const candidateActions = candidate.nodeIds
                    .map(nodeId => nodesById.get(nodeId)?.metadata?.action)
                    .filter(Boolean) as RepositorySensitiveAction[];
                return sensitiveActions.some(action => candidateActions.includes(action));
            });
            const nodeIds = matchingGraphPath?.nodeIds || [];
            const edgeIds = matchingGraphPath?.edgeIds || [];
            const confidence = typeof finding.workflow.confidence_score === 'number'
                ? finding.workflow.confidence_score
                : sensitiveActions.length > 0 ? 85 : 70;
            const risk = (finding.workflow.risk || finding.severity || matchingGraphPath?.risk || 'medium') as RepositoryRisk;
            const files = Array.from(new Set([
                result.filePath,
                ...nodeIds.map(nodeId => nodesById.get(nodeId)?.filePath).filter(Boolean) as string[],
            ]));
            const confidenceScore = clampConfidence(confidence);
            const edgeConfidenceLabels = edgeIds.map(edgeId => edgesById.get(edgeId)?.confidenceLabel || confidenceLabelFromScore(edgesById.get(edgeId)?.confidence || 0));
            const confidenceLevel = pathConfidenceLevel({
                confidence: confidenceScore,
                nodeIds,
                edgeIds,
                findings: [{ filePath: result.filePath, ruleId: finding.rule_id, severity: finding.severity, line: finding.line }],
                edgeConfidenceLabels,
            } as any);
            const evidenceId = stableId('evidence', `${result.filePath}:${finding.rule_id}:${finding.line || 1}`);
            paths.push({
                id: stableId('reachable', `${result.filePath}:${finding.rule_id}:${finding.line || 1}:${workflowNodes.map(node => node.type).join('>')}`),
                risk,
                nodeIds,
                edgeIds,
                sensitiveActions,
                sourceNodeId: sourceNodeIdForPath({ nodeIds }, executionMap),
                sinkNodeId: sinkNodeIdForPath({ nodeIds }, executionMap),
                sensitiveAction: sensitiveActions[0],
                severity: risk,
                evidenceRefs: [evidenceId],
                evidence: [{
                    id: evidenceId,
                    type: 'finding',
                    filePath: result.filePath,
                    ruleId: finding.rule_id,
                    severity: finding.severity,
                    message: finding.message || finding.workflow.path.summary || 'Reachable execution path inferred from scanner workflow evidence.',
                    line: finding.line,
                    snippet: finding.evidence,
                }],
                files,
                confidence: confidenceScore,
                confidenceLevel,
                confidenceLabel: pathConfidenceLabel(confidenceLevel),
                explanation: finding.workflow.path.riskStory || finding.workflow.path.summary || workflowNodes.map(node => node.type).join(' -> '),
                findings: [{
                    filePath: result.filePath,
                    ruleId: finding.rule_id,
                    severity: finding.severity,
                    line: finding.line,
                }],
            });
        }
    }

    for (const graphPath of executionMap.paths) {
        const nodes = graphPath.nodeIds.map(nodeId => nodesById.get(nodeId)).filter(Boolean) as RepositoryExecutionNode[];
        const sensitiveActions = Array.from(new Set(nodes.map(node => node.metadata?.action).filter(Boolean))) as RepositorySensitiveAction[];
        if (sensitiveActions.length === 0) continue;
        const files = Array.from(new Set(nodes.map(node => node.filePath).filter(Boolean))) as string[];
        const key = `${graphPath.nodeIds.join('>')}:${sensitiveActions.join(',')}`;
        if (paths.some(existing => existing.nodeIds.join('>') === graphPath.nodeIds.join('>'))) continue;
        const edgeConfidenceLabels = graphPath.edgeIds.map(edgeId => edgesById.get(edgeId)?.confidenceLabel || confidenceLabelFromScore(edgesById.get(edgeId)?.confidence || 0));
        const confidenceLevel = pathConfidenceLevel({ confidence: 70, nodeIds: graphPath.nodeIds, edgeIds: graphPath.edgeIds, findings: [], edgeConfidenceLabels } as any);
        const evidenceId = stableId('evidence', `graph:${graphPath.id}`);
        paths.push({
            id: stableId('reachable', key),
            risk: graphPath.risk,
            nodeIds: graphPath.nodeIds,
            edgeIds: graphPath.edgeIds,
            sensitiveActions,
            sourceNodeId: sourceNodeIdForPath({ nodeIds: graphPath.nodeIds }, executionMap),
            sinkNodeId: sinkNodeIdForPath({ nodeIds: graphPath.nodeIds }, executionMap),
            sensitiveAction: sensitiveActions[0],
            severity: graphPath.risk,
            evidenceRefs: [evidenceId],
            evidence: [{
                id: evidenceId,
                type: 'graph',
                filePath: files[0] || '',
                message: graphPath.explanation,
            }],
            files,
            confidence: 70,
            confidenceLevel,
            confidenceLabel: pathConfidenceLabel(confidenceLevel),
            explanation: `Repository graph can reach ${sensitiveActions.join(', ')} through ${graphPath.explanation}.`,
            findings: [],
        });
    }

    const seen = new Set<string>();
    return paths.filter(pathItem => {
        const key = `${pathItem.risk}:${pathItem.files.join(',')}:${pathItem.sensitiveActions.join(',')}:${pathItem.explanation}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || b.confidence - a.confidence);
}

function riskRank(risk: RepositoryRisk): number {
    return { low: 1, medium: 2, high: 3, critical: 4 }[risk];
}

function pathConfidenceLevel(pathItem: Pick<ReachableExecutionPath, 'confidence' | 'nodeIds' | 'edgeIds' | 'findings'>): 'confirmed' | 'probable' | 'potential' {
    if ((pathItem as any).edgeConfidenceLabels?.length > 0 && (pathItem as any).edgeConfidenceLabels.every((label: string) => label === 'Confirmed') && pathItem.findings.length > 0) return 'confirmed';
    if (pathItem.confidence >= 70 && (pathItem.findings.length > 0 || pathItem.nodeIds.length > 0)) return 'probable';
    return 'potential';
}

function sourceNodeIdForPath(pathItem: Pick<ReachableExecutionPath, 'nodeIds'>, executionMap: RepositoryExecutionMap): string | undefined {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    return pathItem.nodeIds.find(nodeId => {
        const type = nodesById.get(nodeId)?.type;
        return type === 'PROMPT' || type === 'SKILL' || type === 'WORKFLOW';
    }) || pathItem.nodeIds[0];
}

function sinkNodeIdForPath(pathItem: Pick<ReachableExecutionPath, 'nodeIds'>, executionMap: RepositoryExecutionMap): string | undefined {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    return [...pathItem.nodeIds].reverse().find(nodeId => nodesById.get(nodeId)?.type === 'ACTION') || pathItem.nodeIds[pathItem.nodeIds.length - 1];
}

export function generateRepositorySummary(artifacts: RepositoryArtifact[], executionMap: RepositoryExecutionMap, reachablePaths: ReachableExecutionPath[]): RepositorySummary {
    const sensitiveCounts: Record<RepositorySensitiveAction, number> = {
        Shell: 0,
        Filesystem: 0,
        Network: 0,
        Secrets: 0,
        'External APIs': 0,
    };
    for (const reachablePath of reachablePaths) {
        for (const action of reachablePath.sensitiveActions) {
            sensitiveCounts[action] += 1;
        }
    }

    const riskSummary = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const reachablePath of reachablePaths) {
        riskSummary[reachablePath.risk] += 1;
    }
    const confidenceSummary = { confirmed: 0, probable: 0, potential: 0 };
    for (const reachablePath of reachablePaths) {
        confidenceSummary[reachablePath.confidenceLevel || pathConfidenceLevel(reachablePath)] += 1;
    }

    const hasParseWarnings = artifacts.some(artifact => artifact.metadata?.parseWarning);
    const trustStatus: RepositoryTrustStatus = riskSummary.critical > 0 || riskSummary.high > 0
        ? 'High Risk'
        : riskSummary.medium > 0 || riskSummary.low > 0 || hasParseWarnings
            ? 'Review Required'
            : 'Trusted';

    const aiSurfacesFound = {
        prompts: executionMap.nodes.filter(node => node.type === 'PROMPT').length,
        skills: executionMap.nodes.filter(node => node.type === 'SKILL').length,
        mcpServers: executionMap.nodes.filter(node => node.type === 'MCP_SERVER').length,
        tools: executionMap.nodes.filter(node => node.type === 'TOOL').length,
        workflows: executionMap.nodes.filter(node => node.type === 'WORKFLOW').length,
        memorySystems: executionMap.nodes.filter(node => node.type === 'MEMORY').length,
        agentConfigs: artifacts.filter(artifact => artifact.type === 'AGENT_CONFIG').length,
    };
    const aiSurfaces = aiSurfacesFound.prompts + aiSurfacesFound.skills + aiSurfacesFound.mcpServers + aiSurfacesFound.tools + aiSurfacesFound.workflows + aiSurfacesFound.memorySystems;
    const criticalFindings = reachablePaths.reduce((count, pathItem) => count + pathItem.findings.filter(finding => finding.severity === 'critical').length, 0);
    const overallRisk: RepositoryRisk | 'none' = riskSummary.critical > 0 ? 'critical' : riskSummary.high > 0 ? 'high' : riskSummary.medium > 0 ? 'medium' : riskSummary.low > 0 ? 'low' : 'none';
    return {
        filesScanned: new Set(artifacts.map(artifact => normalizePath(artifact.relativePath))).size,
        aiSurfaces,
        instructionSources: aiSurfacesFound.prompts,
        skills: aiSurfacesFound.skills,
        mcpServers: aiSurfacesFound.mcpServers,
        toolRouters: aiSurfacesFound.tools,
        workflows: aiSurfacesFound.workflows,
        memorySystems: aiSurfacesFound.memorySystems,
        sensitiveActions: Object.values(sensitiveCounts).filter(count => count > 0).length,
        reachablePaths: reachablePaths.length,
        confirmedPaths: confidenceSummary.confirmed,
        probablePaths: confidenceSummary.probable,
        potentialPaths: confidenceSummary.potential,
        criticalFindings,
        overallRisk,
        aiSurfacesFound: {
            ...aiSurfacesFound,
        },
        executionGraph: {
            nodes: executionMap.nodes.length,
            edges: executionMap.edges.length,
        },
        reachableSensitiveActions: sensitiveCounts,
        riskSummary,
        confidenceSummary,
        trustStatus,
    };
}

function sanitizeArtifacts(artifacts: RepositoryArtifact[]): RepositoryArtifact[] {
    return artifacts.map(artifact => ({
        ...artifact,
        evidence: sanitizeStringArray(artifact.evidence) || [],
        metadata: artifact.metadata ? {
            ...artifact.metadata,
            capabilities: sanitizeStringArray(artifact.metadata.capabilities),
            constraints: sanitizeStringArray(artifact.metadata.constraints),
            permissions: sanitizeStringArray(artifact.metadata.permissions),
            references: sanitizeStringArray(artifact.metadata.references),
        } : undefined,
    }));
}

function sanitizeScanResults(scanResults: RepositoryScanResult[]): RepositoryScanResult[] {
    return scanResults.map(result => ({
        ...result,
        findings: (result.findings || []).map(finding => ({
            ...finding,
            message: finding.message ? redactSecrets(finding.message) : finding.message,
            fix: finding.fix ? redactSecrets(finding.fix) : finding.fix,
            recommendation: finding.recommendation ? redactSecrets(finding.recommendation) : finding.recommendation,
            evidence: finding.evidence ? redactSecrets(finding.evidence) : finding.evidence,
            workflow: undefined,
        })),
    }));
}

function issueImpact(severity: string): string {
    if (severity === 'critical') return 'Could allow unauthorized commands, expose sensitive data, or change how the application behaves.';
    if (severity === 'high') return 'Could give the AI system more access than intended or weaken an important security control.';
    if (severity === 'medium') return 'Could become exploitable when combined with untrusted input or broader permissions.';
    return 'Could make the AI system less reliable or make its safety expectations unclear.';
}

function issueFixFallback(severity: string): string {
    if (severity === 'critical' || severity === 'high') {
        return 'Constrain untrusted input, require explicit approval before privileged actions, and reduce tool or MCP permissions.';
    }
    return 'Add explicit boundaries, validation, and least-privilege constraints for the affected instruction or configuration.';
}

const INTERNAL_TERMINOLOGY = /\b(?:heuristic|source-to-sink|privileged sink|trust boundary|execution graph|internal engine|scanner|rule[_ -]?id|workflow node|execution edge|sink node|source node|node|edge)\b/i;

function plainFixCandidate(finding: RepositoryScanFinding, fallback: string): string {
    const candidate = [finding.fix, finding.recommendation].find(value => value && !INTERNAL_TERMINOLOGY.test(value));
    if (!candidate || INTERNAL_TERMINOLOGY.test(candidate)) return fallback;
    return redactSecrets(candidate).trim();
}

function plainLanguageIssue(finding: RepositoryScanFinding): Pick<RepositoryExecutionIssue, 'issue' | 'impact' | 'whyThisMatters' | 'howToFix'> {
    const signal = `${finding.rule_id} ${finding.category || ''} ${finding.message || ''}`.toLowerCase();

    if (/injection|jailbreak|override|evasion|rag/.test(signal)) {
        const fallback = 'Separate untrusted content from trusted instructions, reject attempts to replace system rules, and validate the resulting action before it runs.';
        return {
            issue: 'Untrusted content can change how the AI system follows instructions.',
            impact: 'An attacker could bypass the intended behavior, trigger actions the developer did not approve, or expose protected information.',
            whyThisMatters: 'Applications often combine developer instructions with user or retrieved content. Without a clear separation, outside content can take control of the workflow.',
            howToFix: plainFixCandidate(finding, fallback),
        };
    }

    if (/secret|credential|api.?key|password|token|pii|sensitive.?data/.test(signal)) {
        const fallback = 'Remove secrets from prompts and configuration, use a managed secret store, limit access to approved operations, and redact sensitive values from outputs and logs.';
        return {
            issue: 'Sensitive information may be exposed or used more broadly than intended.',
            impact: 'Credentials, personal data, or private repository information could be disclosed, logged, or sent to an unintended destination.',
            whyThisMatters: 'A single exposed secret can grant access beyond this workflow and may require credential rotation or incident response.',
            howToFix: plainFixCandidate(finding, fallback),
        };
    }

    if (/memory|persist|remember|session/.test(signal)) {
        const fallback = 'Restrict what can be stored, validate content before saving it, separate users and sessions, and require review before stored instructions affect future runs.';
        return {
            issue: 'Untrusted instructions or sensitive information may be saved for later use.',
            impact: 'Unsafe behavior or private data could persist across sessions and influence future requests.',
            whyThisMatters: 'Stored agent memory can turn a one-time input into a repeated security or privacy problem.',
            howToFix: plainFixCandidate(finding, fallback),
        };
    }

    if (/mcp|permission|wildcard|auto.?approve|auto.?execute|tool.?poison/.test(signal)) {
        const fallback = 'Grant only the permissions this tool needs, disable automatic approval for sensitive operations, and require a developer or user confirmation before high-impact actions.';
        return {
            issue: 'A connected tool has broader access or automation than the workflow needs.',
            impact: 'The AI system could read files, run commands, access network services, or use credentials without sufficient review.',
            whyThisMatters: 'Connected tools act with the permissions of the local environment. Broad or automatic access makes an unsafe instruction much more damaging.',
            howToFix: plainFixCandidate(finding, fallback),
        };
    }

    if (/shell|privileged|sink|escalation|workflow|autonomous|tool.?routing/.test(signal)) {
        const fallback = 'Require approval before sensitive actions, limit tool access to the minimum required operations, and validate inputs before they are passed to commands or external services.';
        return {
            issue: 'AI-controlled instructions can reach a sensitive action.',
            impact: 'The workflow could run commands, change files, contact external services, or access protected data in ways the developer did not intend.',
            whyThisMatters: 'The risk is not limited to generated text. The affected workflow can turn model output into a real action with security or operational consequences.',
            howToFix: plainFixCandidate(finding, fallback),
        };
    }

    if (/output|format|structure|clarity|consistency|best.?practice|efficiency|token/.test(signal)) {
        const fallback = 'Make the expected input, output, validation, and failure behavior explicit, then add a test that verifies the required behavior.';
        return {
            issue: 'The instruction does not clearly define an important behavior or safety constraint.',
            impact: 'The AI system may produce inconsistent output, ignore an expected restriction, or fail in ways that are difficult to detect.',
            whyThisMatters: 'Clear and testable instructions reduce unexpected behavior and make changes safer to review.',
            howToFix: plainFixCandidate(finding, fallback),
        };
    }

    const fallback = issueFixFallback(finding.severity);
    return {
        issue: 'The affected AI instruction or configuration needs a security review.',
        impact: issueImpact(finding.severity),
        whyThisMatters: 'The current configuration leaves behavior open to misuse or unexpected results, especially when it handles untrusted input or connected tools.',
        howToFix: plainFixCandidate(finding, fallback),
    };
}

function executionStepLabel(node: RepositoryExecutionNode): string {
    if (node.type === 'PROMPT') return node.relativePath ? `Instructions in ${node.relativePath}` : 'AI instructions';
    if (node.type === 'SKILL') return `Agent skill ${node.label}`;
    if (node.type === 'MEMORY') return `Stored agent memory ${node.label}`;
    if (node.type === 'TOOL') return `Connected tool ${node.label}`;
    if (node.type === 'MCP_SERVER') return `MCP server ${node.label}`;
    if (node.type === 'WORKFLOW') return `Automation workflow ${node.label}`;
    if (node.type === 'ACTION') {
        const action = node.metadata?.action as RepositorySensitiveAction | undefined;
        return action ? SENSITIVE_ACTION_LABELS[action] : node.label.replace(/[_-]+/g, ' ');
    }
    return node.label.replace(/[_-]+/g, ' ');
}

function technicalExecutionPath(
    finding: RepositoryScanFinding,
    pathIds: string[],
    reachablePaths: ReachableExecutionPath[],
    executionMap: RepositoryExecutionMap,
): string {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    const pathItem = pathIds.map(pathId => reachablePaths.find(item => item.id === pathId)).find(Boolean);
    if (pathItem) {
        const labels = pathItem.nodeIds
            .map(nodeId => nodesById.get(nodeId))
            .filter(Boolean)
            .map(node => executionStepLabel(node!));
        if (labels.length > 0) return labels.join(' → ');
    }

    const workflowLabels = (finding.workflow?.path?.nodes || [])
        .map((node: { type?: string; label?: string }) => {
            if (node.type === 'user_input') return 'User-provided instructions';
            if (node.type === 'prompt' || node.type === 'prompt_template') return 'AI instructions';
            if (node.type === 'tool_router' || node.type === 'mcp_tool') return 'Connected tool';
            if (node.type === 'mcp_server') return 'MCP server';
            if (node.type === 'agent_memory') return 'Stored agent memory';
            if (node.type === 'shell_execution') return 'Shell execution';
            if (node.type === 'filesystem_access') return 'Filesystem access';
            if (node.type === 'network_access') return 'Network access';
            if (node.type === 'credential_store' || node.type === 'secret') return 'Credential access';
            if (node.type === 'external_api') return 'External API call';
            return node.label && !INTERNAL_TERMINOLOGY.test(node.label) ? node.label.replace(/[_-]+/g, ' ') : 'Workflow step';
        })
        .filter(Boolean);
    if (workflowLabels.length > 0) return workflowLabels.join(' → ');
    return 'No connected sensitive action was confirmed for this finding.';
}

function issueConfidence(finding: RepositoryScanFinding): RepositoryExecutionIssue['confidence'] {
    const workflowScore = finding.workflow?.confidence_score ?? finding.workflow?.path?.confidence_score;
    const fallbackScores: Record<string, number> = {
        VERY_HIGH: 95,
        HIGH: 85,
        MEDIUM: 70,
        LOW: 50,
    };
    const score = clampConfidence(typeof workflowScore === 'number'
        ? workflowScore
        : fallbackScores[String(finding.confidence || '').toUpperCase()] ?? 70);
    const level: RepositoryExecutionIssue['confidence']['level'] = score >= 85 ? 'confirmed' : score >= 70 ? 'probable' : 'potential';
    return {
        score,
        level,
        label: pathConfidenceLabel(level),
    };
}

function canonicalIssues(rootPath: string, scanResults: RepositoryScanResult[], reachablePaths: ReachableExecutionPath[], executionMap: RepositoryExecutionMap): RepositoryExecutionIssue[] {
    const root = path.resolve(rootPath);
    const issues = new Map<string, RepositoryExecutionIssue>();

    for (const result of scanResults) {
        const absoluteFile = path.isAbsolute(result.filePath) ? path.resolve(result.filePath) : path.resolve(root, result.filePath);
        const relativeFile = normalizePath(path.relative(root, absoluteFile));
        const displayFile = relativeFile && !relativeFile.startsWith('../') ? relativeFile : normalizePath(result.filePath);

        for (const finding of result.findings || []) {
            if (finding.waived) continue;

            const id = stableId('issue', `${displayFile}:${finding.rule_id}:${finding.line || 1}:${finding.column || 1}`);
            const evidenceSnippet = redactSecrets(finding.evidence || finding.message || finding.rule_id);
            const detectedFixSuggestions = Array.from(new Set([
                finding.fix ? redactSecrets(finding.fix) : '',
                finding.recommendation ? redactSecrets(finding.recommendation) : '',
            ].filter(candidate => candidate && !INTERNAL_TERMINOLOGY.test(candidate))));

            const pathIds = reachablePaths
                .filter(pathItem => pathItem.findings.some(pathFinding =>
                    pathFinding.ruleId === finding.rule_id &&
                    (path.isAbsolute(pathFinding.filePath) ? path.resolve(pathFinding.filePath) : path.resolve(root, pathFinding.filePath)) === absoluteFile
                ))
                .map(pathItem => pathItem.id)
                .sort();
            const workflowReason = finding.workflow?.path?.riskStory || finding.workflow?.path?.summary;
            const copy = plainLanguageIssue(finding);
            const fixSuggestions = Array.from(new Set([copy.howToFix, ...detectedFixSuggestions]));
            const evidence = [{
                id: stableId('evidence', `${displayFile}:${finding.rule_id}:${finding.line || 1}:${finding.column || 1}`),
                file: displayFile,
                line: finding.line,
                column: finding.column,
                snippet: evidenceSnippet,
                source: workflowReason ? 'workflow' as const : 'scanner' as const,
            }];
            const confidence = issueConfidence(finding);

            issues.set(id, {
                id,
                ruleId: finding.rule_id,
                severity: finding.severity,
                category: finding.category || 'security',
                ...copy,
                evidence,
                confidence,
                technicalDetails: {
                    executionPath: technicalExecutionPath(finding, pathIds, reachablePaths, executionMap),
                    evidence,
                    confidence,
                },
                impactedFiles: [displayFile],
                fixSuggestions,
                pathIds,
            });
        }
    }

    return Array.from(issues.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function summarizeIssues(issues: RepositoryExecutionIssue[]): RepositoryIssueSummary {
    const summary: RepositoryIssueSummary = { total: issues.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of issues) {
        if (issue.severity === 'critical') summary.critical += 1;
        else if (issue.severity === 'high') summary.high += 1;
        else if (issue.severity === 'medium') summary.medium += 1;
        else summary.low += 1;
    }
    return summary;
}

function sanitizeReachablePaths(paths: ReachableExecutionPath[]): ReachableExecutionPath[] {
    return paths.map(pathItem => ({
        ...pathItem,
        confidenceLevel: pathItem.confidenceLevel || pathConfidenceLevel(pathItem),
        confidenceLabel: pathItem.confidenceLabel || pathConfidenceLabel(pathItem.confidenceLevel || pathConfidenceLevel(pathItem)),
        explanation: redactSecrets(pathItem.explanation),
        evidence: pathItem.evidence.map(evidence => ({
            ...evidence,
            message: redactSecrets(evidence.message),
            snippet: evidence.snippet ? redactSecrets(evidence.snippet) : evidence.snippet,
        })),
    }));
}

function canonicalEvidence(artifacts: RepositoryArtifact[], executionMap: RepositoryExecutionMap, reachablePaths: ReachableExecutionPath[], scanResults: RepositoryScanResult[]): RepositoryExecutionReport['evidence'] {
    const evidence = new Map<string, NonNullable<RepositoryExecutionReport['evidence']>[number]>();
    for (const artifact of artifacts) {
        for (const [index, snippet] of (artifact.evidence || []).entries()) {
            const id = stableId('evidence', `${artifact.id}:${index}:${snippet}`);
            evidence.set(id, {
                id,
                type: 'artifact',
                file: normalizePath(artifact.relativePath),
                snippet: redactSecrets(snippet),
                source: artifact.type,
                confidence: 85,
                confidenceLabel: 'Confirmed',
            });
        }
    }
    for (const edge of executionMap.edges) {
        for (const ref of edge.evidenceRefs || []) {
            if (!evidence.has(ref)) {
                evidence.set(ref, {
                    id: ref,
                    type: 'edge',
                    file: '',
                    snippet: edge.evidence ? redactSecrets(edge.evidence) : edge.reason,
                    source: edge.type,
                    confidence: edge.confidence,
                    confidenceLabel: edge.confidenceLabel || confidenceLabelFromScore(edge.confidence),
                });
            }
        }
    }
    for (const pathItem of reachablePaths) {
        for (const item of pathItem.evidence || []) {
            const id = item.id || stableId('evidence', `${item.filePath}:${item.ruleId || 'path'}:${item.line || 1}:${item.message}`);
            evidence.set(id, {
                id,
                type: item.type || 'path',
                file: normalizePath(item.filePath),
                lineStart: item.line,
                snippet: item.snippet ? redactSecrets(item.snippet) : redactSecrets(item.message),
                ruleId: item.ruleId,
                source: item.ruleId ? 'scanner' : 'repository-graph',
                confidence: pathItem.confidence,
                confidenceLabel: pathItem.confidenceLabel || pathConfidenceLabel(pathItem.confidenceLevel),
            });
        }
    }
    for (const result of scanResults) {
        for (const finding of result.findings || []) {
            const id = stableId('evidence', `${result.filePath}:${finding.rule_id}:${finding.line || 1}`);
            if (!evidence.has(id)) {
                evidence.set(id, {
                    id,
                    type: 'finding',
                    file: normalizePath(result.filePath),
                    lineStart: finding.line,
                    snippet: finding.evidence ? redactSecrets(finding.evidence) : finding.message ? redactSecrets(finding.message) : undefined,
                    ruleId: finding.rule_id,
                    source: 'scanner',
                    confidence: 70,
                    confidenceLabel: 'Probable',
                });
            }
        }
    }
    return Array.from(evidence.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function generateRepositoryExecutionReport(rootPath: string, artifacts: RepositoryArtifact[], executionMap: RepositoryExecutionMap, reachablePaths: ReachableExecutionPath[], scanResults: RepositoryScanResult[] = []): RepositoryExecutionReport {
    const root = path.resolve(rootPath);
    const generatedAt = new Date().toISOString();
    const sanitizedArtifacts = sanitizeArtifacts(artifacts);
    const sanitizedPaths = sanitizeReachablePaths(reachablePaths);
    const issues = canonicalIssues(root, scanResults, sanitizedPaths, executionMap);
    const summary = generateRepositorySummary(artifacts, executionMap, reachablePaths);
    return {
        id: stableId('repo-report', `${root}:${generatedAt}`),
        version: REPORT_VERSION,
        generated_at: generatedAt,
        scannedAt: generatedAt,
        repository: {
            root,
            name: path.basename(root),
        },
        scanMode: 'local',
        artifacts: sanitizedArtifacts,
        files: sanitizedArtifacts,
        skills: sanitizedArtifacts.filter(artifact => artifact.type === 'SKILL'),
        mcpServers: sanitizedArtifacts.filter(artifact => artifact.type === 'MCP_SERVER'),
        workflows: sanitizedArtifacts.filter(artifact => artifact.type === 'WORKFLOW' || artifact.type === 'ACTION'),
        executionMap,
        reachablePaths: sanitizedPaths,
        summary,
        issues,
        issueSummary: summarizeIssues(issues),
        findings: sanitizeScanResults(scanResults),
        evidence: canonicalEvidence(sanitizedArtifacts, executionMap, sanitizedPaths, scanResults),
        fixPlan: sanitizedPaths.slice(0, 10).map((pathItem, index) => ({
            id: stableId('fix', pathItem.id),
            title: `Review ${pathItem.sensitiveAction || pathItem.sensitiveActions[0] || 'reachable action'} path`,
            description: 'Remove unnecessary routes from AI-controlled instructions to sensitive actions, require approval for sensitive tools, and limit MCP/tool permissions.',
            pathId: pathItem.id,
            artifactId: pathItem.sourceNodeId,
        })),
        exports: { json: true, sarif: true, html: true, mapJson: true },
    };
}

export function analyzeRepositoryExecution(rootPath: string, scanResults: RepositoryScanResult[] = [], options: AnalyzeRepositoryOptions = {}): RepositoryExecutionReport {
    const artifacts = analyzeRepository(rootPath, options);
    const executionMap = buildRepositoryExecutionMap(artifacts, scanResults);
    const reachablePaths = analyzeReachablePaths(executionMap, artifacts, scanResults);
    return generateRepositoryExecutionReport(rootPath, artifacts, executionMap, reachablePaths, scanResults);
}
