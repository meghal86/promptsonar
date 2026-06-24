import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import {
    assertFindingInvariants,
    classifySecretSemantics,
    evaluateContextualVerdict,
    inferCapabilityIntent,
    omitMalformedContextualSections,
    secretAssessmentToVerdictInput,
    type ArtifactKind,
    type CanonicalIssueContext,
    type CapabilityType,
    type ControlStatus,
    type ContextualConfidence,
    type SecurityControl,
    type VerdictDecision,
    type VerdictInput,
    type VulnerabilityBasis,
} from '../contextual';
import { stripNegatedClauses } from '../workflow/analyzer';
import {
    REPOSITORY_CONFIDENCE_DEFINITIONS,
    repositoryConfidenceDefinition,
} from './confidence';
import { NON_PRODUCTION_PROVENANCE } from './types';
import type {
    AnalyzeRepositoryOptions,
    EvaluateCanonicalFindingsInput,
    ReachableExecutionPath,
    RepositoryArtifact,
    RepositoryArtifactType,
    RepositoryExecutionEdge,
    RepositoryExecutionGraphPath,
    RepositoryExecutionMap,
    RepositoryExecutionNode,
    RepositoryExecutionNodeType,
    RepositoryImpactedFile,
    RepositoryImpactedFileType,
    RepositoryExecutionIssue,
    RepositoryExecutionReport,
    RepositoryIssueFix,
    RepositoryIssueSummary,
    RepositoryPathValidation,
    RepositoryPathConfidence,
    RepositoryProvenance,
    RepositoryRisk,
    RepositoryScanFinding,
    RepositoryScanResult,
    RepositoryScanStats,
    RepositorySensitiveAction,
    RepositorySummary,
    RepositoryTrustStatus,
} from './types';

// Keep in lockstep with the published package version so the report version and
// the CLI banner never disagree. The export schema version is tracked
// separately because contextual issue fields evolve independently.
// Workflow/action artifacts are config surfaces, not source code that merely
// mentions "workflow" in its name.
const WORKFLOW_CONFIG_EXTENSIONS = new Set(['.yml', '.yaml', '.json', '.toml']);

const REPORT_VERSION = '1.4.3';
const REPORT_SCHEMA_VERSION = '2026-06-23.contextual-v1';
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
    'venv',
    '.venv',
    'env',
    '.env',
    'site-packages',
    'dist-packages',
    'vendor',
    'target',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    '.idea',
    '.vscode-test',
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
    /sk-(?:live|test|proj|ant)-[A-Za-z0-9_-]{8,}/g,
    /ghp_[A-Za-z0-9]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /Bearer\s+[A-Za-z0-9._-]{16,}/g,
    /((?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{12,}/gi,
];

function pathConfidenceLabel(level: 'confirmed' | 'probable' | 'potential'): 'Confirmed' | 'Probable' | 'Potential' {
    if (level === 'confirmed') return 'Confirmed';
    if (level === 'probable') return 'Probable';
    return 'Potential';
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

function stableId(prefix: string, value: string): string {
    const slug = normalizePath(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug.length <= 120) return `${prefix}:${slug}`;
    // Long values keep a readable prefix plus a hash of the full slug so two
    // deep paths can never silently collide into one node or edge id.
    let hash = 5381;
    for (let index = 0; index < slug.length; index++) {
        hash = ((hash << 5) + hash + slug.charCodeAt(index)) >>> 0;
    }
    return `${prefix}:${slug.slice(0, 96)}-${hash.toString(36)}`;
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
        const basename = path.basename(filePath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext) && basename !== 'agents.md' && basename !== 'agent.md') return undefined;
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
}

function emptyScanStats(): RepositoryScanStats {
    return {
        filesConsidered: 0,
        filesScanned: 0,
        filesSkipped: 0,
        skipReasons: {},
        truncated: false,
    };
}

function noteSkip(stats: RepositoryScanStats, reason: string, count = 1): void {
    stats.filesSkipped += count;
    stats.skipReasons[reason] = (stats.skipReasons[reason] || 0) + count;
}

function walkRepository(
    root: string,
    options: { maxFiles: number; maxFileSizeBytes: number; ignorePatterns: string[] },
    stats: RepositoryScanStats,
): string[] {
    const files: string[] = [];
    const ignorePatterns = options.ignorePatterns;
    const isIgnored = (relativePath: string): boolean =>
        ignorePatterns.some(pattern =>
            minimatch(relativePath, pattern, { dot: true }) ||
            minimatch(relativePath, pattern.replace(/\/\*?\*?$/, ''), { dot: true })
        );

    const visit = (dir: string) => {
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = normalizePath(path.relative(root, fullPath));
            if (entry.isDirectory()) {
                if (IGNORED_DIRECTORIES.has(entry.name)) {
                    noteSkip(stats, 'ignored_directory_subtree');
                    continue;
                }
                if (ignorePatterns.length > 0 && isIgnored(relativePath)) {
                    noteSkip(stats, 'ignore_pattern_directory');
                    continue;
                }
                visit(fullPath);
            } else if (entry.isFile()) {
                stats.filesConsidered += 1;
                if (ignorePatterns.length > 0 && isIgnored(relativePath)) {
                    noteSkip(stats, 'ignore_pattern');
                    continue;
                }
                if (files.length >= options.maxFiles) {
                    stats.truncated = true;
                    noteSkip(stats, 'max_files_exceeded');
                    continue;
                }
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
    const normalized = stripNegatedClauses(text).replace(/[_-]/g, ' ');
    const actions = new Set<RepositorySensitiveAction>();
    // "command" alone is not shell evidence (it appears in every MCP config and
    // most prose); require an execution verb or an actual shell term.
    if (/\b(shell|bash|terminal|exec|spawn|subprocess|run\s+(?:any\s+|all\s+)?commands?|execute\s+(?:any\s+|all\s+)?commands?)\b/i.test(normalized)) actions.add('Shell');
    if (/\b(filesystem|file\s*(read|write)|read\s+file|write\s+file|read\s+all\s+files|write\s+all\s+files|workspace|directory)\b/i.test(normalized)) actions.add('Filesystem');
    if (/\b(network|http|https|fetch|curl|webhook|internal api|network\s+request)\b/i.test(normalized)) actions.add('Network');
    if (/\b(secret|secrets|read\s+secret|token|api\s*key|password|credential|credentials|bearer)\b/i.test(normalized)) actions.add('Secrets');
    if (/https?:\/\/|\bexternal\s+api\b|\bapi\./i.test(text)) actions.add('External APIs');
    return Array.from(actions);
}

const SHELL_BINARIES = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'powershell', 'pwsh', 'cmd', 'cmd.exe']);
const SHELL_VALUE_TOKENS = ['shell', 'bash', 'terminal', 'exec', 'spawn', 'subprocess', 'shell_exec', 'process.run'];
const FS_VALUE_TOKENS = ['filesystem', 'file_write', 'file_read', 'file.write', 'file.read', 'fs.', 'disk_access', 'workspace_access', 'files'];
const NETWORK_VALUE_TOKENS = ['network', 'http', 'https', 'fetch', 'curl', 'webhook', 'request'];
const SECRET_VALUE_TOKENS = ['secret', 'token', 'api_key', 'apikey', 'password', 'credential', 'bearer'];

function collectValueStrings(value: unknown, out: string[]): void {
    if (value == null) return;
    if (typeof value === 'string') {
        out.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectValueStrings(item, out);
        return;
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value as Record<string, unknown>)) collectValueStrings(item, out);
    }
}

function collectKeyedValues(node: unknown, keys: Set<string>, out: string[]): void {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) collectKeyedValues(item, keys, out);
        return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (keys.has(key.toLowerCase())) collectValueStrings(value, out);
        collectKeyedValues(value, keys, out);
    }
}

// Value-based sensitive-action detection for MCP server configs. JSON key
// names (notably the mandatory "command" launcher key) must never count as
// capability evidence; only the configured values can.
function detectMcpSensitiveActions(body: string): RepositorySensitiveAction[] {
    let server: any;
    try {
        server = JSON.parse(body);
    } catch {
        // Unparseable config: fall back to keyword detection with structural
        // launcher keys stripped so key names cannot masquerade as evidence.
        const withoutLauncherKeys = body.replace(/"(?:command|args|cwd|name|id)"\s*:/gi, '"":');
        return detectSensitiveActions(withoutLauncherKeys);
    }
    if (!server || typeof server !== 'object') return [];

    const actions = new Set<RepositorySensitiveAction>();
    const matchesToken = (value: string, tokens: string[]): boolean => {
        const lower = value.toLowerCase();
        return tokens.some(token => lower.includes(token));
    };

    // Launcher: only an actual shell binary or inline-eval form is shell evidence.
    const command = typeof server.command === 'string' ? server.command.trim() : '';
    const commandBinary = command.split(/[\\/\s]+/).filter(Boolean).pop()?.toLowerCase() || '';
    const args: string[] = [];
    collectValueStrings(server.args, args);
    if (SHELL_BINARIES.has(commandBinary)) actions.add('Shell');
    if (args.some(arg => arg === '-c' || arg === '/c')) actions.add('Shell');
    if ((/\b(?:python\d?|node|ruby|perl)\b/i.test(commandBinary) || /\b(?:python\d?|node|ruby|perl)\b/i.test(command)) && args.some(arg => arg === '-e' || arg === '-c')) actions.add('Shell');

    // Declared capabilities, permissions, scopes, and tools (values only).
    const grantValues: string[] = [];
    collectKeyedValues(server, new Set(['permissions', 'scopes', 'capabilities', 'tools', 'allow']), grantValues);
    for (const value of grantValues) {
        if (matchesToken(value, SHELL_VALUE_TOKENS)) actions.add('Shell');
        if (matchesToken(value, FS_VALUE_TOKENS)) actions.add('Filesystem');
        if (matchesToken(value, NETWORK_VALUE_TOKENS)) actions.add('Network');
        if (matchesToken(value, SECRET_VALUE_TOKENS)) actions.add('Secrets');
    }

    // Free-text fields (descriptions, instructions) keep keyword detection.
    const textValues: string[] = [];
    collectKeyedValues(server, new Set(['description', 'instructions', 'prompt', 'usage']), textValues);
    for (const action of detectSensitiveActions(textValues.join('\n'))) actions.add(action);

    // Environment keys that hold credentials.
    const env = server.env && typeof server.env === 'object' && !Array.isArray(server.env) ? server.env as Record<string, unknown> : undefined;
    if (env && Object.keys(env).some(key => /(?:secret|token|key|password|credential)/i.test(key))) actions.add('Secrets');

    // Endpoints.
    const allValues: string[] = [];
    collectValueStrings(server, allValues);
    if (allValues.some(value => /^https?:\/\//i.test(value))) {
        actions.add('Network');
        actions.add('External APIs');
    }

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

// Classify where an artifact lives so repository trust can be read against
// production code only. Documentation that *describes* an attack and fixtures
// that *intentionally contain* one are real and stay visible, but they are not
// live product vulnerabilities and must not drive trust status.
function classifyRepositoryProvenance(relativePath: string, content: string): RepositoryProvenance {
    const lower = normalizePath(relativePath).toLowerCase();
    const segments = lower.split('/');
    const basename = segments[segments.length - 1] || '';
    const hasSegment = (...names: string[]): boolean => segments.some(segment => names.includes(segment));

    if (hasSegment('node_modules', 'dist', 'build', 'out', '.next', 'coverage', 'vendor') ||
        /\.(?:min|bundle|chunk|compiled|generated)\.[a-z]+$/.test(basename) ||
        /\.d\.ts$/.test(basename)) {
        return 'generated';
    }
    // Fixture is checked before test: a file under `tests/.../fixtures/` is a
    // fixture (intentional sample), not a test runner file.
    if (hasSegment('fixtures', 'fixture', 'golden', 'sample-repos', 'samples', 'corpus', 'snapshots') ||
        /\.fixture\.[a-z]+$/.test(basename) ||
        // Intentional vulnerable fixtures self-declare their suppression intent.
        /\b(intentional(?:ly)? vulnerable|test fixture|do not fix|fixture only|vulnerable fixture|suppression_reason)\b/i.test(content)) {
        return 'fixture';
    }
    if (hasSegment('tests', 'test', '__tests__', '__test__', 'spec', '__mocks__') ||
        /\.(?:test|spec)\.[a-z]+$/.test(basename)) {
        return 'test';
    }
    if (hasSegment('docs', 'doc', 'documentation', 'wiki') ||
        basename === 'readme.md' || basename === 'changelog.md' || basename === 'contributing.md' ||
        /\.mdx?$/.test(basename) && hasSegment('docs', 'doc')) {
        return 'documentation';
    }
    if (hasSegment('examples', 'example', 'demo', 'demos', 'scratch', 'evidence', 'benchmarks', 'research', 'results', 'tmp', 'output')) {
        return 'example';
    }
    return 'production';
}

function classifyFile(root: string, filePath: string, content: string): RepositoryArtifact[] {
    const relativePath = normalizePath(path.relative(root, filePath));
    const lower = relativePath.toLowerCase();
    const basename = path.basename(lower);
    const ext = path.extname(lower);
    const provenance = classifyRepositoryProvenance(relativePath, content);
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
            provenance,
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
            const sensitiveActions = detectMcpSensitiveActions(server.body);
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

    if (lower === 'agents.md' || lower === 'agent.md' || lower.startsWith('agents/') || lower.endsWith('/agents.md') || lower.endsWith('/agent.md') || lower.includes('/agents/')) {
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

    // WORKFLOW/ACTION are CI/orchestration *config* surfaces. A basename match
    // (`workflow`, `pipeline`) only counts on a config extension or under
    // `.github/workflows/` — otherwise a UI component like `WorkflowGraph.tsx`
    // would be misclassified as a workflow executor and reach a Confirmed sink.
    const isGithubWorkflow = lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/');
    const isActionManifest = basename === 'action.yml' || basename === 'action.yaml';
    const isWorkflowConfigName = (basename.includes('workflow') || basename.includes('pipeline')) && WORKFLOW_CONFIG_EXTENSIONS.has(ext);
    if (isGithubWorkflow || isActionManifest || isWorkflowConfigName) {
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

export function analyzeRepositoryArtifacts(rootPath: string, options: AnalyzeRepositoryOptions = {}): { artifacts: RepositoryArtifact[]; scanStats: RepositoryScanStats } {
    const root = path.resolve(rootPath);
    const resolvedOptions = {
        maxFiles: options.maxFiles || DEFAULT_MAX_FILES,
        maxFileSizeBytes: options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES,
        ignorePatterns: options.ignorePatterns || [],
    };
    const scanStats = emptyScanStats();
    const isDirectory = fs.statSync(root).isDirectory();
    let files: string[];
    if (isDirectory) {
        files = walkRepository(root, resolvedOptions, scanStats);
    } else {
        files = [root];
        scanStats.filesConsidered = 1;
    }
    const artifacts: RepositoryArtifact[] = [];
    for (const filePath of files) {
        const content = safeRead(filePath, resolvedOptions.maxFileSizeBytes);
        if (content === undefined) {
            noteSkip(scanStats, 'unsupported_or_unreadable');
            continue;
        }
        scanStats.filesScanned += 1;
        artifacts.push(...classifyFile(isDirectory ? root : path.dirname(root), filePath, content));
    }
    return {
        artifacts: artifacts.sort((a, b) => `${a.relativePath}:${a.type}:${a.name}`.localeCompare(`${b.relativePath}:${b.type}:${b.name}`)),
        scanStats,
    };
}

export type InMemoryRepositoryFile = {
    path: string;
    content: string;
};

function normalizeInMemoryRelativePath(value: string): string {
    return normalizePath(value)
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

function isSupportedRepositoryTextPath(relativePath: string): boolean {
    const lower = normalizePath(relativePath).toLowerCase();
    const ext = path.extname(lower);
    const basename = path.basename(lower);
    return TEXT_EXTENSIONS.has(ext) || basename === 'agents.md' || basename === 'agent.md';
}

export function analyzeRepositoryArtifactsFromFiles(
    rootPath: string,
    files: InMemoryRepositoryFile[],
    options: AnalyzeRepositoryOptions = {},
): { artifacts: RepositoryArtifact[]; scanStats: RepositoryScanStats } {
    const root = path.resolve(rootPath);
    const resolvedOptions = {
        maxFiles: options.maxFiles || DEFAULT_MAX_FILES,
        maxFileSizeBytes: options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES,
        ignorePatterns: options.ignorePatterns || [],
    };
    const scanStats = emptyScanStats();
    const artifacts: RepositoryArtifact[] = [];
    const isIgnored = (relativePath: string): boolean =>
        resolvedOptions.ignorePatterns.some(pattern =>
            minimatch(relativePath, pattern, { dot: true }) ||
            minimatch(relativePath, pattern.replace(/\/\*?\*?$/, ''), { dot: true })
        );

    for (const file of files) {
        scanStats.filesConsidered += 1;
        const relativePath = normalizeInMemoryRelativePath(file.path);
        if (!relativePath) {
            noteSkip(scanStats, 'unsupported_or_unreadable');
            continue;
        }
        if (isIgnored(relativePath)) {
            noteSkip(scanStats, 'ignore_pattern');
            continue;
        }
        if (scanStats.filesScanned >= resolvedOptions.maxFiles) {
            scanStats.truncated = true;
            noteSkip(scanStats, 'max_files_exceeded');
            continue;
        }
        const content = String(file.content || '');
        if (content.length > resolvedOptions.maxFileSizeBytes) {
            noteSkip(scanStats, 'file_too_large');
            continue;
        }
        if (!isSupportedRepositoryTextPath(relativePath)) {
            noteSkip(scanStats, 'unsupported_or_unreadable');
            continue;
        }
        scanStats.filesScanned += 1;
        artifacts.push(...classifyFile(root, path.join(root, relativePath), content));
    }

    return {
        artifacts: artifacts.sort((a, b) => `${a.relativePath}:${a.type}:${a.name}`.localeCompare(`${b.relativePath}:${b.type}:${b.name}`)),
        scanStats,
    };
}

export function analyzeRepository(rootPath: string, options: AnalyzeRepositoryOptions = {}): RepositoryArtifact[] {
    return analyzeRepositoryArtifacts(rootPath, options).artifacts;
}

function nodeTypeForArtifact(type: RepositoryArtifactType): RepositoryExecutionNodeType {
    if (type === 'AGENT_CONFIG') return 'PROMPT';
    return type;
}

function edgeId(from: string, to: string, type: string): string {
    return stableId('edge', `${from}:${type}:${to}`);
}

// Edge provenance is the structured basis for confidence — set explicitly by
// each call site rather than recovered by regex from the English reason text.
//  - 'direct':     a real reference or direct config/artifact evidence -> Confirmed
//  - 'connected':  a relationship inferred from shared metadata/capability -> Probable
//  - 'structural': co-location or broad repository possibility only      -> Potential
type EdgeProvenance = 'direct' | 'connected' | 'structural';

const PROVENANCE_LEVEL: Record<EdgeProvenance, RepositoryPathConfidence> = {
    direct: 'confirmed',
    connected: 'probable',
    structural: 'potential',
};

function addEdge(edges: Map<string, RepositoryExecutionEdge>, from: string, to: string, type: RepositoryExecutionEdge['type'], reason: string, evidence: string | undefined, confidence: number, provenance: EdgeProvenance): void {
    if (from === to) return;
    const id = edgeId(from, to, type);
    if (edges.has(id)) return;
    // A claim of direct evidence is only honored when evidence actually exists.
    const level: RepositoryPathConfidence = provenance === 'direct' && !evidence?.trim() ? 'probable' : PROVENANCE_LEVEL[provenance];
    const label = pathConfidenceLabel(level);
    edges.set(id, {
        id,
        from,
        to,
        type,
        relationship: type,
        reason,
        provenance,
        evidence: evidence ? redactSecrets(evidence) : undefined,
        evidenceRefs: evidence ? [stableId('evidence', `${from}:${to}:${type}:${evidence}`)] : [],
        confidence,
        confidenceLabel: label,
        confidenceDefinition: repositoryConfidenceDefinition(level),
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

// Node types that actually *execute* a sensitive action (a configured MCP
// server, tool registry, memory store, or workflow). Only these can anchor a
// Confirmed source-to-sink edge. A PROMPT or SKILL only *declares* intent in
// prose, so its reach to a synthetic action node is Probable at best — there is
// no wired executor to confirm the sink.
const EXECUTOR_NODE_TYPES = new Set<RepositoryExecutionNodeType>(['MCP_SERVER', 'TOOL', 'MEMORY', 'WORKFLOW']);

function addSensitiveActionNodes(
    nodes: Map<string, RepositoryExecutionNode>,
    edges: Map<string, RepositoryExecutionEdge>,
    sourceNodeId: string,
    actions: RepositorySensitiveAction[],
    options: { evidence?: string; sourceIsExecutor: boolean },
): void {
    const { evidence, sourceIsExecutor } = options;
    const hasEvidence = Boolean(evidence?.trim());
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
        // Real wired executor + direct evidence -> Confirmed. A prose-only
        // declaration (PROMPT/SKILL) is capped at Probable even with evidence,
        // because no tool/MCP/workflow in the repo actually performs the action.
        let reason: string;
        let confidence: number;
        let provenance: EdgeProvenance;
        if (sourceIsExecutor && hasEvidence) {
            reason = `${action} capability derived from direct executor evidence.`;
            confidence = 85;
            provenance = 'direct';
        } else if (hasEvidence) {
            reason = `${action} capability declared in instructions; no wired executor confirms the sink.`;
            confidence = 75;
            provenance = 'connected';
        } else {
            reason = `${action} capability inferred from artifact metadata.`;
            confidence = 65;
            provenance = 'structural';
        }
        addEdge(edges, sourceNodeId, actionNodeId, 'CAN_REACH', reason, hasEvidence ? redactSecrets(evidence!) : undefined, confidence, provenance);
    }
}

function riskForActions(actions: RepositorySensitiveAction[], findings: RepositoryScanFinding[] = []): RepositoryRisk {
    if (findings.some(f => !f.waived && f.severity === 'critical')) return 'critical';
    if (actions.includes('Shell') || findings.some(f => !f.waived && f.severity === 'high')) return 'high';
    if (actions.includes('Secrets') || actions.includes('Filesystem') || actions.includes('Network')) return 'medium';
    return 'low';
}

export function buildRepositoryExecutionMap(artifacts: RepositoryArtifact[], scanResults: RepositoryScanResult[] = [], rootPath?: string): RepositoryExecutionMap {
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
            // A config that failed to parse cannot provide direct evidence, so
            // its action edges stay structural inference instead of Confirmed.
            const directEvidence = artifact.metadata?.parseWarning ? undefined : artifact.evidence[0];
            addSensitiveActionNodes(nodes, edges, nodeId, artifact.metadata?.sensitiveActions || [], { evidence: directEvidence, sourceIsExecutor: true });
        } else if (artifact.type === 'SKILL') {
            // An agent skill that declares shell/secret/file capabilities is a
            // reachable instruction source even when no separate scanner finding
            // lands on it. Wire its declared actions into the graph as a
            // non-executor (Probable) source so a dangerous SKILL.md cannot
            // silently report as Trusted with zero paths. Scoped to SKILL only:
            // generic agent-instruction prose (AGENTS.md) merely mentioning these
            // words is not a capability grant and must not synthesize paths.
            addSensitiveActionNodes(nodes, edges, nodeId, artifact.metadata?.sensitiveActions || [], { evidence: artifact.evidence[0], sourceIsExecutor: false });
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
                addEdge(edges, sourceNode, targetNode, 'REFERENCES', `${source.name} references ${target.name}.`, source.evidence[0], 75, 'direct');
            }
        }
    }

    for (const prompt of prompts) {
        const sourceNode = nodeIdByArtifact.get(prompt.id);
        if (!sourceNode) continue;
        for (const memory of memories) addEdge(edges, sourceNode, nodeIdByArtifact.get(memory.id)!, 'READS', 'Prompt or agent config can read repository memory context.', prompt.evidence[0], 55, 'structural');
        for (const skill of skills) addEdge(edges, sourceNode, nodeIdByArtifact.get(skill.id)!, 'INVOKES', 'Prompt or agent config can invoke discovered agent skills.', prompt.evidence[0], 60, 'structural');
        for (const tool of tools) addEdge(edges, sourceNode, nodeIdByArtifact.get(tool.id)!, 'ROUTES_TO', 'Prompt or agent config can route work to tool definitions.', prompt.evidence[0], 60, 'structural');
        for (const mcp of mcps) {
            const promptActions = prompt.metadata?.sensitiveActions || [];
            const mcpActions = mcp.metadata?.sensitiveActions || [];
            if (promptActions.some(action => mcpActions.includes(action))) {
                // Capability overlap (prompt names an action the MCP exposes) is
                // strong structural evidence, not a confirmed reference.
                addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'INVOKES', 'Prompt names a sensitive action exposed by a configured MCP server.', prompt.evidence[0], 80, 'connected');
            }
        }
    }

    for (const skill of skills) {
        const sourceNode = nodeIdByArtifact.get(skill.id);
        if (!sourceNode) continue;
        for (const tool of tools) addEdge(edges, sourceNode, nodeIdByArtifact.get(tool.id)!, 'ROUTES_TO', 'Skill can route instructions to a tool surface.', skill.evidence[0], 65, 'structural');
        for (const mcp of mcps) addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'INVOKES', 'Skill can invoke MCP server capabilities.', skill.evidence[0], 60, 'structural');
    }

    for (const tool of tools) {
        const sourceNode = nodeIdByArtifact.get(tool.id);
        if (!sourceNode) continue;
        for (const mcp of mcps) addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'ROUTES_TO', 'Tool surface can route to MCP server capability.', tool.evidence[0], 70, 'structural');
    }

    for (const workflow of workflows) {
        const sourceNode = nodeIdByArtifact.get(workflow.id);
        if (!sourceNode) continue;
        for (const prompt of prompts) addEdge(edges, sourceNode, nodeIdByArtifact.get(prompt.id)!, 'REFERENCES', 'Workflow can reference prompt or agent instructions.', workflow.evidence[0], 55, 'structural');
        for (const tool of tools) addEdge(edges, sourceNode, nodeIdByArtifact.get(tool.id)!, 'INVOKES', 'Workflow can invoke tool definitions.', workflow.evidence[0], 65, 'structural');
        for (const mcp of mcps) addEdge(edges, sourceNode, nodeIdByArtifact.get(mcp.id)!, 'INVOKES', 'Workflow can invoke MCP server configuration.', workflow.evidence[0], 65, 'structural');
    }

    for (const result of scanResults) {
        const related = artifacts.find(artifact => path.resolve(artifact.filePath) === path.resolve(result.filePath));
        let sourceNode = related ? nodeIdByArtifact.get(related.id) : undefined;
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
            if (related && !['PROMPT', 'SKILL', 'AGENT_CONFIG'].includes(related.type)) {
                detectSensitiveActions(`${finding.message || ''}\n${finding.evidence || ''}\n${finding.fix || ''}`).forEach(action => actions.add(action));
            }
        }
        if (!sourceNode) {
            // The scanner extracted AI instructions from a file the artifact
            // classifier did not recognize. Give the findings a real source node
            // so their execution paths stay graph-backed instead of node-less.
            if (actions.size === 0) continue;
            const syntheticNodeId = stableId('node', `SCAN:${normalizePath(result.filePath)}`);
            if (!nodes.has(syntheticNodeId)) {
                nodes.set(syntheticNodeId, {
                    id: syntheticNodeId,
                    type: 'PROMPT',
                    label: path.basename(result.filePath),
                    filePath: result.filePath,
                    relativePath: rootPath
                        ? normalizePath(path.relative(path.resolve(rootPath), path.resolve(result.filePath)))
                        : normalizePath(result.filePath),
                    description: 'AI instructions detected by the scanner in this file.',
                    metadata: { artifactType: 'PROMPT', scannerDetected: true },
                });
            }
            sourceNode = syntheticNodeId;
        }
        const sourceNodeType = nodes.get(sourceNode)?.type;
        const sourceIsExecutor = sourceNodeType ? EXECUTOR_NODE_TYPES.has(sourceNodeType) : false;
        addSensitiveActionNodes(nodes, edges, sourceNode, Array.from(actions), { evidence: result.findings?.[0]?.evidence, sourceIsExecutor });
    }

    const graph: RepositoryExecutionMap = {
        nodes: Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id)),
        edges: Array.from(edges.values()).sort((a, b) => a.id.localeCompare(b.id)),
        paths: [] as RepositoryExecutionGraphPath[],
    };
    const enumeration = inferGraphPaths(graph, scanResults);
    graph.paths = enumeration.paths;
    graph.pathsTruncated = enumeration.truncated;
    graph.pathEnumerationLimit = MAX_GRAPH_PATHS;
    return graph;
}

const MAX_GRAPH_PATHS = 100;

function inferGraphPaths(graph: RepositoryExecutionMap, scanResults: RepositoryScanResult[]): { paths: RepositoryExecutionGraphPath[]; truncated: boolean } {
    const adjacency = new Map<string, RepositoryExecutionEdge[]>();
    const reverseAdjacency = new Map<string, RepositoryExecutionEdge[]>();
    for (const edge of graph.edges) {
        const existing = adjacency.get(edge.from) || [];
        existing.push(edge);
        adjacency.set(edge.from, existing);
        const incoming = reverseAdjacency.get(edge.to) || [];
        incoming.push(edge);
        reverseAdjacency.set(edge.to, incoming);
    }
    const edgeSort = (a: RepositoryExecutionEdge, b: RepositoryExecutionEdge) =>
        b.confidence - a.confidence || a.id.localeCompare(b.id);
    for (const edges of adjacency.values()) edges.sort(edgeSort);
    for (const edges of reverseAdjacency.values()) edges.sort(edgeSort);

    const actionNodes = graph.nodes
        .filter(node => node.type === 'ACTION' && node.metadata?.action)
        .sort((a, b) => a.id.localeCompare(b.id));
    const startNodes = graph.nodes
        .filter(node => isPathSourceNode(node, graph))
        .map(node => node.id)
        .sort();
    const paths: RepositoryExecutionGraphPath[] = [];
    const findingsByFile = new Map(scanResults.map(result => [path.resolve(result.filePath), result.findings || []]));
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const nextEdgeToAction = new Map<string, Map<string, RepositoryExecutionEdge>>();

    // One reverse traversal per sensitive action records a deterministic
    // shortest suffix from every reachable node. Route enumeration can then
    // vary the first hop without expanding every combination in a dense graph.
    for (const actionNode of actionNodes) {
        const nextEdge = new Map<string, RepositoryExecutionEdge>();
        const visited = new Set<string>([actionNode.id]);
        const queue = [actionNode.id];
        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            for (const edge of reverseAdjacency.get(current) || []) {
                if (visited.has(edge.from)) continue;
                visited.add(edge.from);
                nextEdge.set(edge.from, edge);
                queue.push(edge.from);
            }
        }
        nextEdgeToAction.set(actionNode.id, nextEdge);
    }

    const seen = new Set<string>();
    let truncated = false;
    for (const start of startNodes) {
        if (truncated) break;
        for (const firstEdge of adjacency.get(start) || []) {
            if (truncated) break;
            for (const actionNode of actionNodes) {
                const nodeIds = [start];
                const edgeIds: string[] = [];
                const visited = new Set(nodeIds);
                let edge: RepositoryExecutionEdge | undefined = firstEdge;

                while (edge && nodeIds.length <= 6) {
                    if (visited.has(edge.to)) break;
                    edgeIds.push(edge.id);
                    nodeIds.push(edge.to);
                    visited.add(edge.to);
                    if (edge.to === actionNode.id) break;
                    edge = nextEdgeToAction.get(actionNode.id)?.get(edge.to);
                }

                if (nodeIds[nodeIds.length - 1] !== actionNode.id) continue;
                const key = nodeIds.join('>');
                if (seen.has(key)) continue;
                seen.add(key);
                if (paths.length >= MAX_GRAPH_PATHS) {
                    truncated = true;
                    break;
                }

                const nodes = nodeIds.map(id => nodeById.get(id)).filter(Boolean) as RepositoryExecutionNode[];
                const actions = nodes.map(node => node.metadata?.action).filter(Boolean) as RepositorySensitiveAction[];
                const findings = nodes.flatMap(node => node.filePath ? (findingsByFile.get(path.resolve(node.filePath)) || []) : []);
                paths.push({
                    id: stableId('path', key),
                    nodeIds,
                    edgeIds,
                    risk: riskForActions(actions, findings),
                    explanation: nodes.map(node => node.label).join(' -> '),
                });
            }
        }
    }

    return { paths, truncated };
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
    const artifactProvenance = new Map<string, RepositoryProvenance>(
        artifacts.filter(artifact => artifact.provenance).map(artifact => [path.resolve(artifact.filePath), artifact.provenance!]),
    );
    const findingsByFileForEvidence = new Map(scanResults.map(result => [path.resolve(result.filePath), result.findings || []]));
    const fileProvenance = (filePath: string): RepositoryProvenance =>
        artifactProvenance.get(path.resolve(filePath)) || classifyRepositoryProvenance(path.resolve(filePath), '');
    // A path is live production risk only when its whole chain is production. If
    // any node it traverses (e.g. a fixture MCP that supplies the sink) is
    // non-production, the path is non-production — a production-sourced prompt
    // that can only reach a sensitive action through a test fixture is not a
    // shippable vulnerability. Source provenance is used only as the fallback.
    const pathProvenance = (nodeIds: string[], fallbackFile?: string): RepositoryProvenance => {
        const chain = nodeIds
            .map(id => nodesById.get(id)?.filePath)
            .filter(Boolean)
            .map(file => fileProvenance(file as string));
        const nonProduction = chain.find(provenance => NON_PRODUCTION_PROVENANCE.has(provenance));
        if (nonProduction) return nonProduction;
        if (chain.length > 0) return chain[0];
        return fallbackFile ? fileProvenance(fallbackFile) : 'unknown';
    };
    const paths: ReachableExecutionPath[] = [];
    const graphPathsByStartFile = new Map<string, RepositoryExecutionGraphPath[]>();
    const graphPathsByAnyFile = new Map<string, RepositoryExecutionGraphPath[]>();
    for (const graphPath of executionMap.paths) {
        const first = nodesById.get(graphPath.nodeIds[0]);
        if (first?.filePath) {
            const key = path.resolve(first.filePath);
            const existing = graphPathsByStartFile.get(key) || [];
            existing.push(graphPath);
            graphPathsByStartFile.set(key, existing);
        }
        for (const nodeId of graphPath.nodeIds) {
            const node = nodesById.get(nodeId);
            if (!node?.filePath) continue;
            const key = path.resolve(node.filePath);
            const existing = graphPathsByAnyFile.get(key) || [];
            existing.push(graphPath);
            graphPathsByAnyFile.set(key, existing);
        }
    }

    for (const result of scanResults) {
        for (const finding of result.findings || []) {
            if (finding.waived || !finding.workflow?.path?.nodes) continue;
            const workflowNodes = finding.workflow.path.nodes as Array<{ type: string; label?: string }>;
            const sensitiveActions = Array.from(new Set(workflowNodes.map(node => actionFromWorkflowNode(node.type)).filter(Boolean))) as RepositorySensitiveAction[];
            if (sensitiveActions.length === 0 && !finding.workflow.path.privilegedSinkReached) continue;

            const actionsOverlap = (candidate: RepositoryExecutionGraphPath): boolean => {
                const candidateActions = candidate.nodeIds
                    .map(nodeId => nodesById.get(nodeId)?.metadata?.action)
                    .filter(Boolean) as RepositorySensitiveAction[];
                return sensitiveActions.some(action => candidateActions.includes(action));
            };
            // Prefer a graph path starting at the finding's file; fall back to
            // any graph path passing through it (e.g. an MCP config that a
            // prompt routes into), then to the direct file->action edge so the
            // finding stays graph-backed even when path enumeration was capped.
            const matchingGraphPath = (graphPathsByStartFile.get(path.resolve(result.filePath)) || []).find(actionsOverlap)
                || (graphPathsByAnyFile.get(path.resolve(result.filePath)) || []).find(actionsOverlap)
                || directGraphPath(result.filePath, sensitiveActions, executionMap);
            // A reachable path is a graph-backed claim. Findings whose workflow
            // never connects to a graph sensitive action stay visible as issues
            // (with their workflow story in technical details) but are not
            // presented as repository execution paths.
            if (!matchingGraphPath) continue;
            const nodeIds = matchingGraphPath.nodeIds;
            const edgeIds = matchingGraphPath.edgeIds;
            const confidence = typeof finding.workflow.confidence_score === 'number'
                ? finding.workflow.confidence_score
                : sensitiveActions.length > 0 ? 85 : 70;
            // Path risk must match the canonical issue severity (finding.severity)
            // so overallRisk never contradicts the issue summary. workflow.risk is
            // an internal escalation hint and only fills in when severity is absent.
            const risk = (finding.severity || finding.workflow.risk || matchingGraphPath?.risk || 'medium') as RepositoryRisk;
            const files = Array.from(new Set([
                result.filePath,
                ...nodeIds.map(nodeId => nodesById.get(nodeId)?.filePath).filter(Boolean) as string[],
            ]));
            // Confidence is the weakest link of the matched graph path's edges,
            // not a flat 'probable'. A path that ends at a real wired executor
            // (MCP/tool/workflow, all-direct edges) is Confirmed even when a
            // scanner finding also corroborates it; a prose-only prompt->action
            // chain stays Probable, and a node-less inference stays Potential.
            const edgeLabels = edgeIds.map(edgeId => {
                const edge = edgesById.get(edgeId);
                return edge?.confidenceLabel || (edge?.evidenceRefs?.length ? 'Probable' : 'Potential');
            });
            const confidenceLevel: RepositoryPathConfidence = nodeIds.length === 0
                ? 'potential'
                : pathConfidenceLevel({ confidence, nodeIds, edgeIds, findings: [], edgeConfidenceLabels: edgeLabels } as any);
            const confidenceScore = alignConfidenceScore(confidenceLevel, clampConfidence(confidence));
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
                provenance: pathProvenance(nodeIds, result.filePath),
                confidence: confidenceScore,
                confidenceLevel,
                confidenceLabel: pathConfidenceLabel(confidenceLevel),
                confidenceDefinition: repositoryConfidenceDefinition(confidenceLevel),
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
        const edgeConfidenceLabels = graphPath.edgeIds.map(edgeId => {
            const edge = edgesById.get(edgeId);
            return edge?.confidenceLabel || (edge?.evidenceRefs?.length ? 'Probable' : 'Potential');
        });
        const confidenceLevel = pathConfidenceLevel({ confidence: 70, nodeIds: graphPath.nodeIds, edgeIds: graphPath.edgeIds, findings: [], edgeConfidenceLabels } as any);
        const graphConfidence = alignConfidenceScore(confidenceLevel, 70);
        const evidenceId = stableId('evidence', `graph:${graphPath.id}`);
        // Anchor graph-path evidence to a real file and, when a scanner finding
        // exists on any node in the chain, its rule id and line — so evidence is
        // never rendered as `undefined@file:undefined`.
        const evidenceFile = (nodesById.get(graphPath.nodeIds[0])?.filePath) || files[0] || '';
        const linkedFinding = graphPath.nodeIds
            .map(nodeId => nodesById.get(nodeId)?.filePath)
            .filter(Boolean)
            .flatMap(file => findingsByFileForEvidence.get(path.resolve(file as string)) || [])
            .find(finding => sensitiveActions.length === 0 || !finding.waived);
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
                filePath: evidenceFile,
                ruleId: linkedFinding?.rule_id,
                severity: linkedFinding?.severity,
                line: linkedFinding?.line ?? 1,
                message: graphPath.explanation,
            }],
            files,
            provenance: pathProvenance(graphPath.nodeIds, files[0]),
            confidence: graphConfidence,
            confidenceLevel,
            confidenceLabel: pathConfidenceLabel(confidenceLevel),
            confidenceDefinition: repositoryConfidenceDefinition(confidenceLevel),
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
    }).sort((a, b) =>
        // Graph-backed paths always rank above node-less inference, and
        // evidence-backed (Confirmed/Probable) paths always rank above
        // structural-inference-only (Potential) paths regardless of risk, so a
        // Potential chain can never be selected as the highest-risk path.
        (b.nodeIds.length > 0 ? 1 : 0) - (a.nodeIds.length > 0 ? 1 : 0) ||
        (b.confidenceLevel !== 'potential' ? 1 : 0) - (a.confidenceLevel !== 'potential' ? 1 : 0) ||
        riskRank(b.risk) - riskRank(a.risk) ||
        b.confidence - a.confidence
    );
}

function directGraphPath(
    filePath: string,
    sensitiveActions: RepositorySensitiveAction[],
    executionMap: RepositoryExecutionMap,
): Pick<RepositoryExecutionGraphPath, 'nodeIds' | 'edgeIds' | 'risk'> | undefined {
    const resolved = path.resolve(filePath);
    const sourceNode = executionMap.nodes.find(node =>
        node.filePath && path.resolve(node.filePath) === resolved && isPathSourceNode(node, executionMap));
    if (!sourceNode) return undefined;
    for (const action of sensitiveActions) {
        const actionNode = executionMap.nodes.find(node => node.type === 'ACTION' && node.metadata?.action === action);
        if (!actionNode) continue;
        const edge = executionMap.edges.find(candidate => candidate.from === sourceNode.id && candidate.to === actionNode.id);
        if (edge) {
            return {
                nodeIds: [sourceNode.id, actionNode.id],
                edgeIds: [edge.id],
                risk: riskForActions([action]),
            };
        }
    }
    return undefined;
}

function alignConfidenceScore(level: RepositoryPathConfidence, score: number): number {
    // Numeric scores must not contradict labels: Confirmed >= 85, Probable 60-84, Potential <= 59.
    if (level === 'confirmed') return Math.max(85, score);
    if (level === 'probable') return Math.min(84, Math.max(60, score));
    return Math.min(59, score);
}

function riskRank(risk: RepositoryRisk): number {
    return { low: 1, medium: 2, high: 3, critical: 4 }[risk];
}

function pathConfidenceLevel(pathItem: Pick<ReachableExecutionPath, 'confidence' | 'nodeIds' | 'edgeIds' | 'findings'>): 'confirmed' | 'probable' | 'potential' {
    const labels = (pathItem as any).edgeConfidenceLabels || [];
    // A chain is only as strong as its weakest edge: one structural-inference
    // hop anywhere makes the whole path Potential, no matter how strong the
    // other edges are.
    if (labels.length > 0) {
        if (labels.every((label: string) => label === 'Confirmed')) return 'confirmed';
        if (labels.every((label: string) => label === 'Confirmed' || label === 'Probable')) return 'probable';
        return 'potential';
    }
    return pathItem.findings.length > 0 ? 'probable' : 'potential';
}

function isPathSourceNode(node: RepositoryExecutionNode, executionMap: RepositoryExecutionMap): boolean {
    if (['PROMPT', 'SKILL', 'MEMORY', 'WORKFLOW'].includes(node.type)) return true;
    // A configured MCP server or tool with no upstream source is itself the
    // earliest known source (e.g. an MCP-only repository).
    if (node.type === 'MCP_SERVER' || node.type === 'TOOL') {
        return !executionMap.edges.some(edge => edge.to === node.id);
    }
    return false;
}

function sourceNodeIdForPath(pathItem: Pick<ReachableExecutionPath, 'nodeIds'>, executionMap: RepositoryExecutionMap): string | undefined {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    const firstNodeId = pathItem.nodeIds[0];
    const firstNode = nodesById.get(firstNodeId);
    return firstNode && isPathSourceNode(firstNode, executionMap)
        ? firstNodeId
        : undefined;
}

function sinkNodeIdForPath(pathItem: Pick<ReachableExecutionPath, 'nodeIds'>, executionMap: RepositoryExecutionMap): string | undefined {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    const lastNodeId = pathItem.nodeIds[pathItem.nodeIds.length - 1];
    return nodesById.get(lastNodeId)?.type === 'ACTION' ? lastNodeId : undefined;
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

    const confidenceSummary = { confirmed: 0, probable: 0, potential: 0 };
    for (const reachablePath of reachablePaths) {
        confidenceSummary[reachablePath.confidenceLevel || pathConfidenceLevel(reachablePath)] += 1;
    }

    // Risk and trust are driven only by evidence-backed (Confirmed/Probable)
    // paths that live in production artifacts. Potential-only structural
    // inference is map context, and documentation/test/fixture paths are real
    // but non-production — neither can mark a repository High Risk on its own.
    const riskSummary = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const reachablePath of reachablePaths) {
        const level = reachablePath.confidenceLevel || pathConfidenceLevel(reachablePath);
        if (level === 'potential') continue;
        if (NON_PRODUCTION_PROVENANCE.has(reachablePath.provenance ?? 'production')) continue;
        riskSummary[reachablePath.risk] += 1;
    }

    const hasParseWarnings = artifacts.some(artifact => artifact.metadata?.parseWarning && !NON_PRODUCTION_PROVENANCE.has(artifact.provenance ?? 'production'));
    const trustStatus: RepositoryTrustStatus = riskSummary.critical > 0 || riskSummary.high > 0
        ? 'High Risk'
        : riskSummary.medium > 0 || riskSummary.low > 0 || confidenceSummary.potential > 0 || hasParseWarnings
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
    const artifactFiles = new Set(artifacts.map(artifact => normalizePath(artifact.relativePath))).size;
    return {
        filesScanned: artifactFiles,
        artifactFiles,
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
        pathsTruncated: executionMap.pathsTruncated || false,
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

const ABSENCE_REQUIREMENTS: Record<string, string> = {
    bp_missing_persona: 'No bounded role or persona requirement was found within that block.',
    bp_missing_few_shot: 'No example input/output behavior was found within that block.',
    bp_missing_cot: 'No verification requirement or reviewable decision criteria were found within that block.',
    struct_missing_format_enforcer: 'No required output format or schema enforcement was found within that block.',
};

function issueEvidenceKind(finding: RepositoryScanFinding): 'direct' | 'absence' {
    return finding.evidenceKind || (ABSENCE_REQUIREMENTS[finding.rule_id] ? 'absence' : 'direct');
}

function plainFixCandidate(finding: RepositoryScanFinding, fallback: string): string {
    const candidate = [finding.fix, finding.recommendation].find(value => value && !INTERNAL_TERMINOLOGY.test(value));
    if (!candidate || INTERNAL_TERMINOLOGY.test(candidate)) return fallback;
    return redactSecrets(candidate).trim();
}

// Rule-specific plain-language copy for quality rules, so two different
// clarity/structure findings do not render the identical sentence.
const QUALITY_ISSUE_COPY: Record<string, { issue: string; impact: string; whyThisMatters: string; fallback: string }> = {
    clarity_missing_quantifier: {
        issue: 'The instruction asks for output without saying how much.',
        impact: 'The model may return too little or an unbounded amount, making output unpredictable and costly.',
        whyThisMatters: 'Quantifiers ("exactly 3", "at most 5") are what make output length testable and stable.',
        fallback: 'State an explicit quantity or range for the requested output.',
    },
    clarity_open_ended: {
        issue: 'The instruction is open-ended and under-specified.',
        impact: 'Different runs can drift in scope, tone, or depth, which is hard to review or test.',
        whyThisMatters: 'Bounded instructions keep behavior consistent across model and prompt changes.',
        fallback: 'Constrain the task scope and state what a complete answer must include.',
    },
    clarity_vague_words: {
        issue: 'The instruction relies on vague wording.',
        impact: 'Ambiguous terms ("good", "appropriate", "some") are interpreted differently each run.',
        whyThisMatters: 'Concrete criteria are what let you verify the output is correct.',
        fallback: 'Replace vague adjectives with measurable, explicit criteria.',
    },
    struct_missing_format_enforcer: {
        issue: 'The instruction does not pin down an output format.',
        impact: 'Downstream parsing can break when the model returns prose instead of the expected structure.',
        whyThisMatters: 'A declared schema (JSON/columns/fields) is what makes the output machine-consumable.',
        fallback: 'State the required output format explicitly and reject anything that does not match it.',
    },
    consist_contradiction: {
        issue: 'The instruction contains conflicting directives.',
        impact: 'The model must guess which rule wins, producing inconsistent and unreviewable behavior.',
        whyThisMatters: 'Contradictions are silent bugs — they surface only when the wrong branch is taken.',
        fallback: 'Resolve the conflicting instructions so only one expected behavior remains.',
    },
    bp_missing_persona: {
        issue: 'The instruction never establishes a bounded role for the model.',
        impact: 'Without a defined persona the model is easier to steer off-task by untrusted input.',
        whyThisMatters: 'A constrained role is a cheap, durable guardrail against scope creep.',
        fallback: 'Add a specific, bounded system persona that states what the assistant must and must not do.',
    },
    bp_missing_few_shot: {
        issue: 'The instruction provides no examples of the expected behavior.',
        impact: 'The model has to infer format and edge-case handling, increasing variance.',
        whyThisMatters: 'A few worked examples sharply reduce ambiguity for little token cost.',
        fallback: 'Add one or two input/output examples that demonstrate the required behavior.',
    },
    bp_missing_cot: {
        issue: 'The instruction does not define reviewable decision criteria for a complex task.',
        impact: 'The model may skip required checks or produce a conclusion that is difficult to verify.',
        whyThisMatters: 'An observable checklist or concise verification summary makes multi-step behavior testable from the returned output.',
        fallback: 'Add explicit decision criteria, a short verification checklist, or a concise rationale field.',
    },
    eff_token_budget: {
        issue: 'The prompt is close to a token budget that risks truncation.',
        impact: 'Important instructions near the end may be cut, silently changing behavior.',
        whyThisMatters: 'Truncated system instructions fail open, often without any error.',
        fallback: 'Trim or restructure the prompt to stay within a safe token budget.',
    },
    eff_token_bloat: {
        issue: 'The prompt is large enough to risk truncation or high cost.',
        impact: 'Long prompts increase latency and cost and can push instructions out of the window.',
        whyThisMatters: 'Concise prompts are cheaper and less likely to drop instructions.',
        fallback: 'Shorten the prompt or move static context into retrieval.',
    },
    eff_compression_potential: {
        issue: 'The prompt contains redundant or compressible content.',
        impact: 'Wasted tokens add cost and latency without improving output.',
        whyThisMatters: 'Tighter prompts are easier to review and cheaper to run at scale.',
        fallback: 'Remove redundancy and keep only the instructions that change behavior.',
    },
};

function plainLanguageIssue(finding: RepositoryScanFinding): Pick<RepositoryExecutionIssue, 'issue' | 'impact' | 'whyThisMatters' | 'howToFix'> {
    const signal = `${finding.rule_id} ${finding.category || ''} ${finding.message || ''}`.toLowerCase();
    const qualityCopy = QUALITY_ISSUE_COPY[finding.rule_id];

    if (qualityCopy) {
        return {
            issue: qualityCopy.issue,
            impact: qualityCopy.impact,
            whyThisMatters: qualityCopy.whyThisMatters,
            howToFix: plainFixCandidate(finding, qualityCopy.fallback),
        };
    }

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

function structuredIssueFix(finding: RepositoryScanFinding, recommendedFix: string): RepositoryIssueFix {
    const signal = `${finding.rule_id} ${finding.category || ''} ${finding.message || ''}`.toLowerCase();
    const effort: RepositoryIssueFix['effort'] = finding.severity === 'critical'
        ? 'Large'
        : finding.severity === 'high'
            ? 'Moderate'
            : 'Quick';

    if (finding.rule_id.startsWith('eff_') && QUALITY_ISSUE_COPY[finding.rule_id]) {
        return {
            quickFix: 'Reduce prompt size or move static reference material out of the main instruction.',
            recommendedFix,
            safePattern: 'Keep the active prompt concise; retrieve bulky reference material only when needed.',
            effort,
        };
    }
    if (/injection|jailbreak|override|evasion|rag/.test(signal)) {
        return {
            quickFix: 'Block instruction-override phrases and keep untrusted content outside the trusted instruction block.',
            recommendedFix,
            safePattern: 'trustedInstructions + \"\\n<untrusted_input>\" + escape(userInput) + \"</untrusted_input>\"',
            effort,
        };
    }
    if (/secret|credential|api.?key|password|token|pii|sensitive.?data/.test(signal)) {
        return {
            quickFix: 'Remove the exposed value, rotate it if it may be active, and redact it from logs and generated output.',
            recommendedFix,
            safePattern: 'const apiKey = process.env.API_KEY; // never place the value in prompts or checked-in config',
            effort,
        };
    }
    if (/memory|persist|remember|session/.test(signal)) {
        return {
            quickFix: 'Stop storing unvalidated input and clear any saved content that can alter later requests.',
            recommendedFix,
            safePattern: 'if (isTrusted(memoryEntry) && isAllowedForSession(memoryEntry, sessionId)) save(memoryEntry);',
            effort,
        };
    }
    if (/mcp|permission|wildcard|auto.?approve|auto.?execute|tool.?poison/.test(signal)) {
        return {
            quickFix: 'Disable automatic approval and remove wildcard or unused permissions from the affected tool.',
            recommendedFix,
            safePattern: '{ "autoApprove": false, "permissions": ["filesystem.read"] }',
            effort,
        };
    }
    if (/shell|privileged|sink|escalation|workflow|autonomous|tool.?routing/.test(signal)) {
        return {
            quickFix: 'Require explicit approval before the sensitive action and reject unvalidated arguments.',
            recommendedFix,
            safePattern: 'if (!approved || !isAllowed(input)) return; await runScopedAction(input);',
            effort,
        };
    }
    if (finding.rule_id === 'bp_missing_cot') {
        return {
            quickFix: 'Require verification for a multi-step task.',
            recommendedFix,
            safePattern: 'Before returning the result:\\n1. Validate required inputs.\\n2. Check intermediate results against the stated constraints.\\n3. Verify the final output format.\\n4. Report unresolved assumptions, validation failures, or missing inputs.\\n5. Provide a concise verification summary.',
            effort,
        };
    }
    if (finding.rule_id === 'bp_missing_few_shot') {
        return {
            quickFix: 'Add one or two examples that demonstrate the expected input and output.',
            recommendedFix,
            safePattern: 'Example:\\nInput: <representative request>\\nOutput: <expected response shape and edge-case handling>',
            effort,
        };
    }
    if (finding.rule_id === 'bp_missing_persona') {
        return {
            quickFix: 'Define a specific, bounded role for the assistant.',
            recommendedFix,
            safePattern: 'You are a <bounded role>. You may <allowed scope>. You must not <out-of-scope behavior>.',
            effort,
        };
    }
    if (/output|format|structure|clarity|consistency|best.?practice|efficiency|token/.test(signal)) {
        return {
            quickFix: 'State the expected input, output, and failure behavior directly in the instruction.',
            recommendedFix,
            safePattern: 'Input: <validated value>\\nOutput: <required schema>\\nOn failure: return an error without taking action.',
            effort,
        };
    }
    return {
        quickFix: 'Add an explicit boundary around untrusted input and require approval before sensitive operations.',
        recommendedFix,
        safePattern: 'const validated = validate(input); if (approved) await runWithLeastPrivilege(validated);',
        effort,
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
        return action
            ? SENSITIVE_ACTION_LABELS[action].replace(/\b(Execution|Access|Call)\b/, word => word.toLowerCase())
            : node.label.replace(/[_-]+/g, ' ');
    }
    return node.label.replace(/[_-]+/g, ' ');
}

function technicalExecutionPath(
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
    const hasDirectEvidence = issueEvidenceKind(finding) === 'direct' && Boolean(finding.evidence?.trim());
    const hasInferredRelationships = Boolean(finding.workflow?.path);
    const level: RepositoryExecutionIssue['confidence']['level'] = hasInferredRelationships
        ? 'probable'
        : hasDirectEvidence
            ? 'confirmed'
            : 'potential';
    return {
        score,
        level,
        label: pathConfidenceLabel(level),
        definition: repositoryConfidenceDefinition(level),
    };
}

function refineFindingLocation(
    absoluteFile: string,
    finding: RepositoryScanFinding,
    contentCache: Map<string, string | null>,
): { line?: number; column?: number } {
    const reported = { line: finding.line, column: finding.column };
    // Trust the scanner when it reported a real position; only refine the
    // line-1 default by locating the evidence text in the source file.
    if (finding.line && finding.line > 1) return reported;
    const needle = (finding.evidence || '').split(/\r?\n/)[0].trim().replace(/…$/, '').slice(0, 160);
    if (!needle) return reported;
    let content = contentCache.get(absoluteFile);
    if (content === undefined) {
        try {
            content = fs.readFileSync(absoluteFile, 'utf-8');
        } catch {
            content = null;
        }
        contentCache.set(absoluteFile, content);
    }
    if (!content) return reported;
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex(line => line.includes(needle));
    if (index === -1) return reported;
    return { line: index + 1, column: Math.max(1, lines[index].indexOf(needle) + 1) };
}

// A SKILL.md file that declares shell/secret/file/network reach is a capability
// inventory item that needs contextual review. The prompt scanner may emit no
// raw finding on it, so we synthesize repository-level evidence and then let the
// contextual issue normalizer decide whether this is review, risk, or a vuln.
const DECLARED_ACTION_RULE_ID = 'repo_skill_declared_sensitive_action';
const CAPABILITY_ONLY_RULE_IDS = new Set(['repo_skill_declared_sensitive_action', 'MCP-103', 'MCP-104', 'MCP-105']);
const CONTROL_FAILURE_RULE_IDS = new Set(['MCP-002', 'MCP-003', 'MCP-008', 'MCP-011', 'MCP-012', 'MCP-013', 'MCP-014']);

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const CONFIDENCE_RANK: Record<ContextualConfidence, number> = { potential: 1, probable: 2, confirmed: 3 };
const CONFIDENCE_SCORE: Record<ContextualConfidence, number> = { potential: 55, probable: 75, confirmed: 90 };

function artifactKindForContext(artifact: RepositoryArtifact | undefined, provenance: RepositoryProvenance): ArtifactKind {
    if (provenance === 'documentation') return 'documentation';
    if (provenance === 'test') return 'test';
    if (provenance === 'fixture') return 'fixture';
    if (provenance === 'example') return 'example';
    if (!artifact) return 'source';
    if (artifact.type === 'PROMPT') return 'prompt';
    if (artifact.type === 'SKILL') return 'skill';
    if (artifact.type === 'MCP_SERVER') return 'mcp_config';
    if (artifact.type === 'AGENT_CONFIG') return 'agent';
    if (artifact.type === 'MEMORY') return 'memory';
    if (artifact.type === 'TOOL') return 'tool_router';
    if (artifact.type === 'WORKFLOW' || artifact.type === 'ACTION') return 'workflow';
    return 'unknown';
}

function capabilityFromAction(action: RepositorySensitiveAction | undefined): CapabilityType | undefined {
    if (action === 'Shell') return 'shell';
    if (action === 'Filesystem') return 'filesystem.write';
    if (action === 'Network') return 'network';
    if (action === 'Secrets') return 'secret.read';
    if (action === 'External APIs') return 'external_api';
    return undefined;
}

function capabilityFromFinding(finding: RepositoryScanFinding, artifact?: RepositoryArtifact): CapabilityType {
    const actionCapability = capabilityFromAction(artifact?.metadata?.sensitiveActions?.[0]);
    if (finding.rule_id === 'repo_skill_declared_sensitive_action' && actionCapability) return actionCapability;
    if (finding.rule_id === 'MCP-103') return /write|delete|modify/i.test(`${finding.message || ''} ${finding.evidence || ''}`)
        ? 'filesystem.write'
        : 'filesystem.read';
    if (finding.rule_id === 'MCP-104') return 'shell';
    if (finding.rule_id === 'MCP-105') return 'network';

    const signal = `${finding.rule_id} ${finding.category || ''} ${finding.message || ''} ${finding.evidence || ''}`.toLowerCase();
    if (/deploy|cloud role|release|production/.test(signal)) return 'deployment';
    if (/shell|command|exec|process|subprocess|bash|python -c|node -e/.test(signal)) return 'shell';
    if (/secret|credential|api.?key|token|password|process\.env|env/.test(signal)) return 'secret.read';
    if (/write|delete|modify|overwrite/.test(signal) && /file|filesystem|directory|workspace/.test(signal)) return 'filesystem.write';
    if (/file|filesystem|directory|workspace/.test(signal)) return 'filesystem.read';
    if (/database|sql|query/.test(signal)) return /write|insert|update|delete/.test(signal) ? 'database.write' : 'database.read';
    if (/network|http|https|url|domain|external api|remote/.test(signal)) return 'network';
    if (/mcp|tool|router|privileged/.test(signal)) return 'privileged_tool';
    return 'unknown';
}

function capabilityPrivilege(capability: CapabilityType): VerdictInput['capabilityPrivilege'] {
    if (
        capability === 'shell'
        || capability === 'filesystem.write'
        || capability === 'secret.read'
        || capability === 'secret.write'
        || capability === 'database.write'
        || capability === 'deployment'
        || capability === 'privileged_tool'
    ) {
        return 'privileged';
    }
    if (
        capability === 'filesystem.read'
        || capability === 'network'
        || capability === 'external_api'
        || capability === 'database.read'
    ) {
        return 'sensitive';
    }
    return 'ordinary';
}

function controlStateForFinding(finding: RepositoryScanFinding): ControlStatus {
    if (CAPABILITY_ONLY_RULE_IDS.has(finding.rule_id)) return 'unavailable';
    const signal = `${finding.rule_id} ${finding.message || ''} ${finding.evidence || ''} ${finding.fix || ''} ${finding.recommendation || ''}`.toLowerCase();
    if (/contradict|declares approval|required.*but.*auto|auto.*despite/.test(signal)) return 'contradicted';
    if (/bypass|skip confirmation|without approval|auto.?approve|auto.?execute|approval_required=false/.test(signal)) return 'bypassed';
    if (/disabled|disable approval|approval.*false/.test(signal)) return 'disabled';
    if (CONTROL_FAILURE_RULE_IDS.has(finding.rule_id)) return 'missing';
    if (/wildcard|allowall|allow all|unrestricted|overpermission|broad|admin|root|missing auth|lacks api|does not show an authentication|unauthenticated/.test(signal)) return 'missing';
    if (finding.workflow?.path?.privilegedSinkReached) return 'missing';
    return 'unavailable';
}

function requiredControlsForCapability(capability: CapabilityType, finding: RepositoryScanFinding): SecurityControl[] {
    if (capability === 'shell') return ['human_approval', 'command_allowlist', 'argument_validation', 'sandbox'];
    if (capability === 'filesystem.write') return ['filesystem_scope', 'human_approval', 'sandbox'];
    if (capability === 'filesystem.read') return ['filesystem_scope', 'read_only_scope'];
    if (capability === 'network' || capability === 'external_api') return ['network_allowlist', 'authentication'];
    if (capability === 'secret.read' || capability === 'secret.write') return ['secret_scope', 'output_redaction'];
    if (capability === 'deployment') return ['authentication', 'authorization', 'human_approval'];
    if (capability === 'database.read') return ['authorization', 'read_only_scope'];
    if (capability === 'database.write') return ['authorization', 'human_approval', 'argument_validation'];
    if (/approval/i.test(`${finding.message || ''} ${finding.evidence || ''}`)) return ['human_approval'];
    return ['unknown'];
}

function hasUntrustedInfluence(finding: RepositoryScanFinding): boolean {
    const signal = `${finding.rule_id} ${finding.message || ''} ${finding.evidence || ''}`.toLowerCase();
    return Boolean(finding.workflow?.path?.trustBoundaryCrossed)
        || /untrusted|user input|retrieved|rag|webhook|public|prompt injection|ignore previous|tool-description|memory/.test(signal);
}

function sourceToSinkBasisForFinding(
    finding: RepositoryScanFinding,
    pathIds: string[],
    reachablePaths: ReachableExecutionPath[],
    evidenceIds: string[],
    controlState: ControlStatus,
): Extract<VulnerabilityBasis, { kind: 'source_to_sink' }> | undefined {
    if (pathIds.length === 0 || !hasUntrustedInfluence(finding)) return undefined;
    if (!['missing', 'disabled', 'bypassed', 'contradicted'].includes(controlState)) return undefined;
    const matchedPaths = reachablePaths.filter(pathItem => pathIds.includes(pathItem.id));
    const privilegedSinkEvidenceIds = matchedPaths
        .flatMap(pathItem => pathItem.evidenceRefs || pathItem.evidence.map(item => item.id).filter(Boolean) as string[])
        .filter(Boolean);
    return {
        kind: 'source_to_sink',
        pathIds,
        untrustedSourceEvidenceIds: evidenceIds,
        privilegedSinkEvidenceIds: privilegedSinkEvidenceIds.length > 0 ? Array.from(new Set(privilegedSinkEvidenceIds)) : evidenceIds,
        controlFailureEvidenceIds: evidenceIds,
    };
}

function capSeverity(rawSeverity: string, decision: VerdictDecision): string {
    const normalized = rawSeverity.toLowerCase();
    const rawRank = SEVERITY_RANK[normalized] || 1;
    const ceilingRank = SEVERITY_RANK[decision.severityCeiling] || 1;
    return rawRank > ceilingRank ? decision.severityCeiling : normalized;
}

function capIssueConfidence(
    confidence: RepositoryExecutionIssue['confidence'],
    ceiling: ContextualConfidence,
): RepositoryExecutionIssue['confidence'] {
    if (CONFIDENCE_RANK[confidence.level] <= CONFIDENCE_RANK[ceiling]) return confidence;
    return {
        score: CONFIDENCE_SCORE[ceiling],
        level: ceiling,
        label: pathConfidenceLabel(ceiling),
        definition: repositoryConfidenceDefinition(ceiling),
    };
}

function contextualizeRepositoryFinding(args: {
    finding: RepositoryScanFinding;
    artifact?: RepositoryArtifact;
    provenance: RepositoryProvenance;
    pathIds: string[];
    reachablePaths: ReachableExecutionPath[];
    evidenceIds: string[];
}): { context: CanonicalIssueContext; verdictInput: VerdictInput; decision: VerdictDecision } {
    const { finding, artifact, provenance, pathIds, reachablePaths, evidenceIds } = args;
    const artifactKind = artifactKindForContext(artifact, provenance);
    const capability = capabilityFromFinding(finding, artifact);
    const controlState = controlStateForFinding(finding);
    const sourceToSinkBasis = sourceToSinkBasisForFinding(finding, pathIds, reachablePaths, evidenceIds, controlState);
    const secretAssessment = classifySecretSemantics(`${finding.message || ''}\n${finding.evidence || ''}`, {
        evidenceIds,
        untrustedInfluence: hasUntrustedInfluence(finding),
        sourceToSinkBasis,
    });
    const intentAssessment = inferCapabilityIntent({
        artifactKind,
        capability,
        evidenceIds,
        declaredExpectedCapabilities: artifact?.metadata?.sensitiveActions
            ?.map(action => capabilityFromAction(action))
            .filter((value): value is CapabilityType => Boolean(value)),
    });
    const directSecretInput = secretAssessment.kind !== 'none' || finding.rule_id === 'MCP-005'
        ? secretAssessmentToVerdictInput(
            finding.rule_id === 'MCP-005' && secretAssessment.kind !== 'hardcoded_secret'
                ? {
                    kind: 'hardcoded_secret',
                    confidence: 'confirmed',
                    evidenceIds,
                    reason: 'MCP hardcoded secret rule supplied direct evidence.',
                }
                : secretAssessment,
            { untrustedInfluence: hasUntrustedInfluence(finding), sourceToSinkBasis },
        )
        : undefined;
    const verifiedPath = reachablePaths.some(pathItem => pathIds.includes(pathItem.id) && pathItem.confidenceLevel === 'confirmed');
    const verdictInput: VerdictInput = directSecretInput || {
        capabilityPrivilege: capabilityPrivilege(capability),
        exposure: hasUntrustedInfluence(finding) ? 'untrusted' : 'unknown',
        reachability: sourceToSinkBasis ? (verifiedPath ? 'verified' : 'probable') : pathIds.length > 0 ? 'probable' : 'not_verified',
        controlState,
        contextAvailability: controlState === 'unavailable' ? 'unavailable' : 'complete',
        intent: intentAssessment.expected === true ? 'expected' : intentAssessment.expected === false ? 'unexpected' : 'unknown',
        directVulnerability: { present: false },
        sourceToSinkBasis,
    };
    const decision = evaluateContextualVerdict(verdictInput);
    const controls = requiredControlsForCapability(capability, finding);
    const evaluationScope = controlState === 'unavailable'
        ? 'not_available'
        : controlState === 'effective'
            ? 'complete'
            : 'partial';
    const context: CanonicalIssueContext = {
        contextModelVersion: REPORT_SCHEMA_VERSION,
        artifactKind,
        capability,
        trustAssessment: {
            sources: hasUntrustedInfluence(finding)
                ? ['user_input']
                : intentAssessment.expected === true && intentAssessment.confidence === 'confirmed'
                    ? ['developer_instruction']
                    : ['unknown'],
            confidence: hasUntrustedInfluence(finding) ? 'probable' : intentAssessment.confidence === 'confirmed' ? 'confirmed' : 'potential',
            evidenceIds: hasUntrustedInfluence(finding) || intentAssessment.confidence === 'confirmed' ? evidenceIds : [],
        },
        intentAssessment,
        controlAssessment: {
            evaluationScope,
            evaluations: controls.map(control => ({
                control,
                status: controlState,
                confidence: controlState === 'effective' ? 'confirmed' : controlState === 'unavailable' ? 'potential' : 'probable',
                evidenceIds: controlState === 'unavailable' ? [] : evidenceIds,
                reason: controlState === 'unavailable'
                    ? 'Control enforcement was not available in the current analysis context.'
                    : undefined,
            })),
        },
        reachability: {
            pathIds,
            confidence: sourceToSinkBasis ? (verifiedPath ? 'confirmed' : 'probable') : pathIds.length > 0 ? 'probable' : 'potential',
            repositoryVerified: Boolean(sourceToSinkBasis),
        },
        vulnerabilityBasis: decision.vulnerabilityBasis,
        verdict: decision.verdict,
    };
    return { context, verdictInput, decision };
}

function shouldApplyContextualRepositoryFinding(
    finding: RepositoryScanFinding,
    contextual: { context: CanonicalIssueContext; decision: VerdictDecision; verdictInput: VerdictInput },
): boolean {
    return CAPABILITY_ONLY_RULE_IDS.has(finding.rule_id)
        || CONTROL_FAILURE_RULE_IDS.has(finding.rule_id)
        || finding.rule_id === 'sec_privileged_sink_access'
        || Boolean(finding.workflow?.path?.privilegedSinkReached)
        || Boolean(contextual.decision.vulnerabilityBasis)
        || contextual.verdictInput.directVulnerability.present === true;
}

function declaredSensitiveActionFindings(artifacts: RepositoryArtifact[], scanResults: RepositoryScanResult[]): RepositoryScanResult[] {
    const filesWithFindings = new Set(
        scanResults
            .filter(result => (result.findings || []).some(finding => !finding.waived))
            .map(result => path.resolve(result.filePath)),
    );
    const synthetic: RepositoryScanResult[] = [];
    for (const artifact of artifacts) {
        if (artifact.type !== 'SKILL') continue;
        const actions = artifact.metadata?.sensitiveActions || [];
        if (actions.length === 0) continue;
        if (filesWithFindings.has(path.resolve(artifact.filePath))) continue;
        const highRisk = actions.includes('Shell') || actions.includes('Secrets');
        const kind = 'skill';
        const actionList = actions.join(', ');
        synthetic.push({
            filePath: artifact.filePath,
            findings: [{
                rule_id: DECLARED_ACTION_RULE_ID,
                category: 'security',
                severity: highRisk ? 'high' : 'medium',
                line: 1,
                column: 1,
                message: `This ${kind} declares it can perform sensitive actions (${actionList}) without a reviewed, least-privilege boundary.`,
                evidence: artifact.evidence[0] || `Declared sensitive actions: ${actionList}.`,
                recommendation: `Restrict the ${kind} to the minimum operations it needs, require explicit approval before ${actionList.toLowerCase()} actions, and keep secrets out of the instructions.`,
                confidence: highRisk ? 'high' : 'medium',
            }],
        });
    }
    return synthetic;
}

function canonicalIssues(rootPath: string, scanResults: RepositoryScanResult[], reachablePaths: ReachableExecutionPath[], executionMap: RepositoryExecutionMap, artifacts: RepositoryArtifact[] = []): RepositoryExecutionIssue[] {
    const artifactProvenance = new Map<string, RepositoryProvenance>(
        artifacts.filter(artifact => artifact.provenance).map(artifact => [path.resolve(artifact.filePath), artifact.provenance!]),
    );
    const artifactByFile = new Map<string, RepositoryArtifact>(
        artifacts.map(artifact => [path.resolve(artifact.filePath), artifact]),
    );
    const provenanceForFile = (absoluteFile: string): RepositoryProvenance =>
        artifactProvenance.get(absoluteFile) || classifyRepositoryProvenance(absoluteFile, '');
    const root = path.resolve(rootPath);
    const issues = new Map<string, RepositoryExecutionIssue>();
    const contentCache = new Map<string, string | null>();

    for (const result of scanResults) {
        const absoluteFile = path.isAbsolute(result.filePath) ? path.resolve(result.filePath) : path.resolve(root, result.filePath);
        const relativeFile = normalizePath(path.relative(root, absoluteFile));
        const displayFile = relativeFile && !relativeFile.startsWith('../') ? relativeFile : normalizePath(result.filePath);

        for (const finding of result.findings || []) {
            if (finding.waived) continue;

            const location = refineFindingLocation(absoluteFile, finding, contentCache);
            const id = stableId('issue', `${displayFile}:${finding.rule_id}:${location.line || 1}:${location.column || 1}`);
            const evidenceKind = issueEvidenceKind(finding);
            const missingRequirement = finding.missingRequirement || ABSENCE_REQUIREMENTS[finding.rule_id] || finding.message || finding.rule_id;
            const evidenceSnippet = evidenceKind === 'absence'
                ? ''
                : redactSecrets(finding.evidence || finding.message || finding.rule_id);
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
            const fix = structuredIssueFix(finding, copy.howToFix);
            const fixSuggestions = Array.from(new Set([
                fix.quickFix,
                fix.recommendedFix,
                fix.safePattern,
                ...detectedFixSuggestions,
            ]));
            const evidence = [{
                id: stableId('evidence', `${displayFile}:${finding.rule_id}:${location.line || 1}:${location.column || 1}`),
                ruleId: finding.rule_id,
                file: displayFile,
                line: evidenceKind === 'direct' ? location.line : undefined,
                column: evidenceKind === 'direct' ? location.column : undefined,
                snippet: evidenceSnippet,
                kind: evidenceKind,
                startLine: evidenceKind === 'absence' ? finding.scopeStartLine || location.line : undefined,
                endLine: evidenceKind === 'absence' ? finding.scopeEndLine || finding.scopeStartLine || location.line : undefined,
                scopeLabel: evidenceKind === 'absence' ? finding.scopeLabel || 'Instruction block' : undefined,
                missingRequirement: evidenceKind === 'absence' ? redactSecrets(missingRequirement) : undefined,
                source: workflowReason ? 'workflow' as const : 'scanner' as const,
            }];
            const contextual = contextualizeRepositoryFinding({
                finding,
                artifact: artifactByFile.get(absoluteFile),
                provenance: provenanceForFile(absoluteFile),
                pathIds,
                reachablePaths,
                evidenceIds: evidence.map(item => item.id),
            });
            const applyContext = shouldApplyContextualRepositoryFinding(finding, contextual);
            const confidence = applyContext
                ? capIssueConfidence(issueConfidence(finding), contextual.decision.confidenceCeiling)
                : issueConfidence(finding);

            const issue: RepositoryExecutionIssue = {
                id,
                ruleId: finding.rule_id,
                severity: applyContext ? capSeverity(finding.severity, contextual.decision) : finding.severity,
                category: finding.category || 'security',
                ...copy,
                fix,
                evidence,
                confidence,
                technicalDetails: {
                    executionPath: technicalExecutionPath(pathIds, reachablePaths, executionMap),
                    evidence,
                    confidence,
                },
                impactedFiles: [displayFile],
                fixSuggestions,
                pathIds,
                provenance: provenanceForFile(absoluteFile),
                context: applyContext ? contextual.context : undefined,
            };

            if (process.env.NODE_ENV === 'production') {
                issues.set(id, omitMalformedContextualSections(issue));
            } else {
                assertFindingInvariants(issue, applyContext
                    ? {
                        verdictInput: contextual.verdictInput,
                        decision: contextual.decision,
                    }
                    : undefined);
                issues.set(id, issue);
            }
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

function impactedFileType(file: string, artifacts: RepositoryArtifact[]): RepositoryImpactedFileType {
    const normalized = normalizePath(file);
    const lower = normalized.toLowerCase();
    const artifact = artifacts.find(item => normalizePath(item.relativePath) === normalized);

    if (artifact?.type === 'SKILL' || path.basename(lower) === 'skill.md') return 'SKILL.md';
    if (artifact?.type === 'MCP_SERVER' || /(?:^|\/)[^/]*mcp[^/]*\.(?:json|ya?ml|toml)$/.test(lower)) return 'MCP Config';
    if (artifact?.type === 'WORKFLOW' || artifact?.type === 'ACTION' || lower.startsWith('.github/workflows/')) return 'Workflow';
    if (artifact?.type === 'PROMPT' || /\.(?:prompt|ai|chat|system)$/.test(lower) || /(?:^|\/)prompts?\//.test(lower)) return 'Prompt';
    return 'Other';
}

function issueSeverityRank(severity: string): number {
    return ({ low: 1, medium: 2, high: 3, critical: 4 } as Record<string, number>)[severity.toLowerCase()] || 0;
}

function reportRelativeFile(root: string, file: string): string {
    const normalized = normalizePath(file);
    if (!path.isAbsolute(file)) return normalized.replace(/^\/+/, '');
    const relative = normalizePath(path.relative(root, file));
    return relative && !relative.startsWith('../') ? relative : normalized;
}

function canonicalImpactedFiles(root: string, issues: RepositoryExecutionIssue[], artifacts: RepositoryArtifact[], reachablePaths: ReachableExecutionPath[]): RepositoryImpactedFile[] {
    const files = new Map<string, RepositoryExecutionIssue[]>();
    for (const issue of issues) {
        for (const rawFile of issue.impactedFiles) {
            const file = normalizePath(rawFile);
            const fileIssues = files.get(file) || [];
            fileIssues.push(issue);
            files.set(file, fileIssues);
        }
    }

    return Array.from(files.entries()).map(([file, fileIssues]) => {
        const sortedIssues = [...fileIssues].sort((left, right) => left.id.localeCompare(right.id));
        const highestSeverity = [...sortedIssues]
            .sort((left, right) => issueSeverityRank(right.severity) - issueSeverityRank(left.severity))[0]?.severity || 'low';
        const filePathIds = reachablePaths
            .filter(pathItem => pathItem.files.some(pathFile => reportRelativeFile(root, pathFile) === file))
            .map(pathItem => pathItem.id);
        return {
            path: file,
            name: path.basename(file),
            type: impactedFileType(file, artifacts),
            issueIds: sortedIssues.map(issue => issue.id),
            issueCount: sortedIssues.length,
            highestSeverity,
            pathIds: Array.from(new Set([
                ...sortedIssues.flatMap(issue => issue.pathIds),
                ...filePathIds,
            ])).sort(),
        };
    }).sort((left, right) =>
        issueSeverityRank(right.highestSeverity) - issueSeverityRank(left.highestSeverity) ||
        right.issueCount - left.issueCount ||
        left.path.localeCompare(right.path)
    );
}

function sanitizeReachablePaths(paths: ReachableExecutionPath[]): ReachableExecutionPath[] {
    return paths.map(pathItem => {
        const confidenceLevel = pathItem.confidenceLevel || pathConfidenceLevel(pathItem);
        return {
            ...pathItem,
            confidenceLevel,
            confidenceLabel: pathItem.confidenceLabel || pathConfidenceLabel(confidenceLevel),
            confidenceDefinition: pathItem.confidenceDefinition || repositoryConfidenceDefinition(confidenceLevel),
            explanation: redactSecrets(pathItem.explanation),
            evidence: pathItem.evidence.map(evidence => ({
                ...evidence,
                message: redactSecrets(evidence.message),
                snippet: evidence.snippet ? redactSecrets(evidence.snippet) : evidence.snippet,
            })),
        };
    });
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
                    confidenceLabel: edge.confidenceLabel || (edge.evidenceRefs?.length ? 'Probable' : 'Potential'),
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

export function validateRepositoryExecutionPaths(
    executionMap: RepositoryExecutionMap,
    reachablePaths: ReachableExecutionPath[],
    summary?: RepositorySummary,
): RepositoryPathValidation {
    const errors: RepositoryPathValidation['errors'] = [];
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    const edgesById = new Map(executionMap.edges.map(edge => [edge.id, edge]));

    if (summary?.executionGraph.nodes !== undefined && summary.executionGraph.nodes !== executionMap.nodes.length) {
        errors.push({ code: 'node-count-mismatch', message: 'Summary node count does not match the execution graph.' });
    }
    if (summary?.executionGraph.edges !== undefined && summary.executionGraph.edges !== executionMap.edges.length) {
        errors.push({ code: 'edge-count-mismatch', message: 'Summary edge count does not match the execution graph.' });
    }
    if (summary?.reachablePaths !== undefined && summary.reachablePaths !== reachablePaths.length) {
        errors.push({ code: 'reachable-path-count-mismatch', message: 'Summary path count does not match the canonical reachable paths.' });
    }

    for (const pathItem of reachablePaths) {
        const firstNode = nodesById.get(pathItem.nodeIds[0]);
        const lastNode = nodesById.get(pathItem.nodeIds[pathItem.nodeIds.length - 1]);
        const unknownNode = pathItem.nodeIds.find(nodeId => !nodesById.has(nodeId));
        const unknownEdge = pathItem.edgeIds.find(edgeId => !edgesById.has(edgeId));
        if (unknownNode) {
            errors.push({ pathId: pathItem.id, code: 'unknown-node', message: `Path references unknown node ${unknownNode}.` });
        }
        if (unknownEdge) {
            errors.push({ pathId: pathItem.id, code: 'unknown-edge', message: `Path references unknown edge ${unknownEdge}.` });
        }
        const chainIsConnected = pathItem.edgeIds.length === Math.max(0, pathItem.nodeIds.length - 1)
            && pathItem.edgeIds.every((edgeId, index) => {
                const edge = edgesById.get(edgeId);
                return edge?.from === pathItem.nodeIds[index] && edge?.to === pathItem.nodeIds[index + 1];
            });
        if (!chainIsConnected) {
            errors.push({ pathId: pathItem.id, code: 'broken-chain', message: 'Path nodes and edges do not form one connected route.' });
        }
        if (!firstNode || !isPathSourceNode(firstNode, executionMap) || pathItem.sourceNodeId !== firstNode.id) {
            errors.push({ pathId: pathItem.id, code: 'invalid-source', message: 'Path does not start from its earliest known repository source.' });
        }
        const finalAction = lastNode?.type === 'ACTION' ? lastNode.metadata?.action as RepositorySensitiveAction | undefined : undefined;
        if (!lastNode || !finalAction || pathItem.sinkNodeId !== lastNode.id || !pathItem.sensitiveActions.includes(finalAction)) {
            errors.push({ pathId: pathItem.id, code: 'invalid-sensitive-action', message: 'Path does not end in a graph-backed sensitive action.' });
        }
        if ((pathItem.risk === 'critical' || pathItem.risk === 'high') && !pathItem.evidence.some(item => item.message.trim().length > 0)) {
            errors.push({ pathId: pathItem.id, code: 'missing-evidence', message: 'High-risk path does not include evidence.' });
        }
    }

    return {
        valid: errors.length === 0,
        checkedPaths: reachablePaths.length,
        errors,
    };
}

const ACTION_FIX_GUIDANCE: Record<RepositorySensitiveAction, string> = {
    Shell: 'Require explicit human approval and an allowlist of commands before any shell-capable tool runs; reject unvalidated arguments.',
    Filesystem: 'Scope file tools to specific directories, prefer read-only access, and block AI-selected write/delete operations.',
    Network: 'Restrict network egress to an explicit domain allowlist and require approval before internal or external requests.',
    Secrets: 'Keep credentials out of this route, use scoped service tokens, and require review before any secret-access step.',
    'External APIs': 'Allowlist external API destinations and require approval before AI-controlled calls leave the environment.',
};

// One fix-plan entry per (sensitive action × earliest source), not one per
// path, so the plan reads as concrete remediation steps instead of the same
// sentence repeated for every enumerated path.
function dedupeFixPlan(paths: ReachableExecutionPath[], executionMap: RepositoryExecutionMap): RepositoryExecutionReport['fixPlan'] {
    const nodesById = new Map(executionMap.nodes.map(node => [node.id, node]));
    const grouped = new Map<string, { action: RepositorySensitiveAction; sourceLabel: string; sourceNodeId?: string; files: Set<string>; topConfidence: string }>();
    for (const pathItem of paths) {
        const action = (pathItem.sensitiveAction || pathItem.sensitiveActions[0]) as RepositorySensitiveAction | undefined;
        if (!action) continue;
        const sourceNode = pathItem.sourceNodeId ? nodesById.get(pathItem.sourceNodeId) : undefined;
        const sourceLabel = sourceNode?.relativePath || sourceNode?.label || 'AI instructions';
        const key = `${action}:${sourceLabel}`;
        const entry = grouped.get(key) || { action, sourceLabel, sourceNodeId: pathItem.sourceNodeId, files: new Set<string>(), topConfidence: pathItem.confidenceLabel || 'Potential' };
        for (const file of pathItem.files) entry.files.add(normalizePath(file));
        grouped.set(key, entry);
    }
    return Array.from(grouped.values()).slice(0, 12).map(entry => ({
        id: stableId('fix', `${entry.action}:${entry.sourceLabel}`),
        title: `Break the ${entry.action} path from ${entry.sourceLabel}`,
        description: `${ACTION_FIX_GUIDANCE[entry.action]} Affects ${entry.files.size} file${entry.files.size === 1 ? '' : 's'} reachable from ${entry.sourceLabel}.`,
        artifactId: entry.sourceNodeId,
    }));
}

export function generateRepositoryExecutionReport(rootPath: string, artifacts: RepositoryArtifact[], executionMap: RepositoryExecutionMap, reachablePaths: ReachableExecutionPath[], scanResults: RepositoryScanResult[] = [], scanStats?: RepositoryScanStats): RepositoryExecutionReport {
    const root = path.resolve(rootPath);
    const generatedAt = new Date().toISOString();
    const sanitizedArtifacts = sanitizeArtifacts(artifacts);
    const sanitizedPaths = sanitizeReachablePaths(reachablePaths);
    // Synthesize findings for skills/agent-configs that declare sensitive actions
    // but received no scanner finding, so a dangerous SKILL.md yields a real issue.
    const declaredFindings = declaredSensitiveActionFindings(sanitizedArtifacts, scanResults);
    const issueScanResults = declaredFindings.length > 0 ? [...scanResults, ...declaredFindings] : scanResults;
    const issues = canonicalIssues(root, issueScanResults, sanitizedPaths, executionMap, sanitizedArtifacts);
    const issueSummary = summarizeIssues(issues);
    const isNonProduction = (issue: RepositoryExecutionIssue): boolean =>
        NON_PRODUCTION_PROVENANCE.has(issue.provenance ?? 'production');
    const productionIssues = issues.filter(issue => !isNonProduction(issue));
    const nonProductionIssues = issues.filter(isNonProduction);
    const productionIssueSummary = summarizeIssues(productionIssues);
    const nonProductionIssueSummary = summarizeIssues(nonProductionIssues);
    const issuesByProvenance = issues.reduce((acc, issue) => {
        const key = issue.provenance ?? 'production';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {} as Record<RepositoryProvenance, number>);
    const impactedFiles = canonicalImpactedFiles(root, issues, sanitizedArtifacts, sanitizedPaths);
    const summary = generateRepositorySummary(artifacts, executionMap, reachablePaths);
    summary.productionIssueSummary = productionIssueSummary;
    summary.nonProductionIssueSummary = nonProductionIssueSummary;
    summary.issuesByProvenance = issuesByProvenance;
    const pathValidation = validateRepositoryExecutionPaths(executionMap, sanitizedPaths, summary);

    if (scanStats) {
        summary.scanStats = scanStats;
        summary.filesScanned = scanStats.filesScanned;
    }
    summary.pathValidationStatus = pathValidation.valid ? 'passed' : 'failed';
    summary.pathValidationErrors = pathValidation.errors.length;
    // Trust status reflects issue severity in *production* artifacts only:
    // documentation describing attacks and intentional fixtures are visible but
    // never drive trust. Quality-only findings (clarity/best-practice) likewise
    // do not raise trust on their own — only security risk or a failed self-check.
    const productionSecurityRisk = productionIssues.some(issue =>
        issue.category === 'security' || issue.severity === 'high' || issue.severity === 'critical');
    if (productionIssueSummary.critical > 0 || productionIssueSummary.high > 0) {
        summary.trustStatus = 'High Risk';
    } else if (summary.trustStatus === 'Trusted' && (productionSecurityRisk || !pathValidation.valid)) {
        summary.trustStatus = 'Review Required';
    }
    // overallRisk must not contradict the production picture: it is the higher
    // of the production path risk and the highest *security-relevant* production
    // issue severity. We never report "critical" with zero production criticals,
    // and quality-only findings (clarity/best-practice) do not inflate the risk.
    const riskOrder: Array<RepositoryRisk | 'none'> = ['none', 'low', 'medium', 'high', 'critical'];
    const securityIssueRank = productionIssues.reduce((rank, issue) => {
        if (issue.category !== 'security' && issue.severity !== 'high' && issue.severity !== 'critical') return rank;
        return Math.max(rank, riskOrder.indexOf(issue.severity as RepositoryRisk));
    }, 0);
    const currentRisk: RepositoryRisk | 'none' = summary.overallRisk ?? 'none';
    summary.overallRisk = riskOrder[Math.max(riskOrder.indexOf(currentRisk), securityIssueRank)];

    return {
        id: stableId('repo-report', `${root}:${generatedAt}`),
        version: REPORT_VERSION,
        schemaVersion: REPORT_SCHEMA_VERSION,
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
        issueSummary,
        impactedFiles,
        pathValidation,
        confidenceDefinitions: REPOSITORY_CONFIDENCE_DEFINITIONS,
        findings: sanitizeScanResults(scanResults),
        evidence: canonicalEvidence(sanitizedArtifacts, executionMap, sanitizedPaths, scanResults),
        fixPlan: dedupeFixPlan(sanitizedPaths, executionMap),
        exports: { json: true, sarif: true, html: true, mapJson: true },
    };
}

export function analyzeRepositoryExecution(rootPath: string, scanResults: RepositoryScanResult[] = [], options: AnalyzeRepositoryOptions = {}): RepositoryExecutionReport {
    const { artifacts, scanStats } = analyzeRepositoryArtifacts(rootPath, options);
    const executionMap = buildRepositoryExecutionMap(artifacts, scanResults, rootPath);
    const reachablePaths = analyzeReachablePaths(executionMap, artifacts, scanResults);
    return generateRepositoryExecutionReport(rootPath, artifacts, executionMap, reachablePaths, scanResults, scanStats);
}

export function analyzeRepositoryExecutionFromFiles(
    rootPath: string,
    files: InMemoryRepositoryFile[],
    scanResults: RepositoryScanResult[] = [],
    options: AnalyzeRepositoryOptions = {},
): RepositoryExecutionReport {
    const { artifacts, scanStats } = analyzeRepositoryArtifactsFromFiles(rootPath, files, options);
    const executionMap = buildRepositoryExecutionMap(artifacts, scanResults, rootPath);
    const reachablePaths = analyzeReachablePaths(executionMap, artifacts, scanResults);
    return generateRepositoryExecutionReport(rootPath, artifacts, executionMap, reachablePaths, scanResults, scanStats);
}

export function evaluateCanonicalFindings(input: EvaluateCanonicalFindingsInput): RepositoryExecutionReport {
    const scanResults = input.scanResults || [];
    const reachablePaths = analyzeReachablePaths(input.executionGraph, input.analyzedArtifacts, scanResults);
    const report = generateRepositoryExecutionReport(
        input.rootPath,
        input.analyzedArtifacts,
        input.executionGraph,
        reachablePaths,
        scanResults,
        input.scanStats,
    );

    return {
        ...report,
        completeness: input.scanCompleteness,
        profileEvidence: input.profileEvidence,
        threatModel: input.threatModel,
    };
}
