import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type McpSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface McpFinding {
    rule_id: string;
    severity: McpSeverity;
    message: string;
    fix: string;
    path: string;
    server?: string;
}

export interface McpAuditResult {
    filePath: string;
    status: 'pass' | 'warn' | 'fail';
    findings: McpFinding[];
}

const SUSPICIOUS_DESCRIPTION_PATTERNS = [
    /ignore\s+(previous|all)\s+instructions/i,
    /disregard\s+(previous|all)\s+instructions/i,
    /reveal\s+(system|developer)\s+prompt/i,
    /developer\s+mode/i,
    /do\s+anything\s+now/i,
    /jailbreak/i,
];

const SECRET_PATTERNS = [
    /sk-(?:live|test|proj)-[a-zA-Z0-9_-]{16,}/i,
    /ghp_[a-zA-Z0-9]{20,}/i,
    /xox[baprs]-[a-zA-Z0-9-]{10,}/i,
    /Bearer\s+[a-zA-Z0-9._-]{16,}/i,
    /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?[a-zA-Z0-9._-]{12,}/i,
];

const BROAD_SCOPE_PATTERNS = [
    /\bunrestricted\b/i,
    /\ball\s+files\b/i,
    /\bany\s+file\b/i,
    /\bentire\s+(filesystem|system|database|db)\b/i,
    /\badmin\b/i,
    /\broot\s+access\b/i,
    /\bexecute\s+(any|all)\s+(command|shell|script)/i,
    /\bnetwork\s+access\b/i,
];

const WRITE_SCOPE_PATTERNS = [
    /\b(write|modify|delete|remove|overwrite)\s+(any|all)\s+(file|files|directory|directories)\b/i,
    /\bread\s*[-/]?write\b/i,
    /\bwrite\s+access\b/i,
    /\bdelete\s+files?\b/i,
    /\b--write\b/i,
    /\b--allow-write\b/i,
];

const DANGEROUS_ENV_KEYS = new Set([
    'SSH_AUTH_SOCK',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'KUBECONFIG',
    'DOCKER_HOST',
]);

const MUTABLE_PACKAGE_PATTERNS = [
    /\bnpx\b/i,
    /\buvx\b/i,
    /\bpipx\b/i,
    /:latest\b/i,
    /(?:git\+https?:\/\/|git@)github\.com[/:][^"'\s]+(?:\.git)?(?:["'\s]|$)/i,
    /curl\b.*\|\s*(?:sh|bash)/i,
];

const ALLOWED_REMOTE_DOMAINS = new Set([
    'github.com',
    'api.github.com',
    'docs.anthropic.com',
    'api.openai.com',
]);

function stableStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function addFinding(findings: McpFinding[], finding: McpFinding): void {
    const key = `${finding.rule_id}:${finding.path}:${finding.server || ''}:${finding.message}`;
    if (!findings.some(existing => `${existing.rule_id}:${existing.path}:${existing.server || ''}:${existing.message}` === key)) {
        findings.push(finding);
    }
}

function getServerEntries(config: any): Array<[string, any, string]> {
    if (config && typeof config === 'object' && config.mcpServers && typeof config.mcpServers === 'object') {
        return Object.entries(config.mcpServers).map(([name, value]) => [name, value, `mcpServers.${name}`]);
    }

    if (config && typeof config === 'object' && config.servers && typeof config.servers === 'object') {
        if (Array.isArray(config.servers)) {
            return config.servers.map((value: any, index: number) => [value?.name || `server-${index}`, value, `servers.${index}`]);
        }
        return Object.entries(config.servers).map(([name, value]) => [name, value, `servers.${name}`]);
    }

    return [];
}

function extractUrls(value: unknown): string[] {
    const text = stableStringify(value);
    const matches = text.match(/https?:\/\/[^\s"',)\\]+/gi);
    return matches || [];
}

function hasAuthIndicator(server: any): boolean {
    const text = stableStringify(server);
    return /authorization|bearer|api[_-]?key|token|oauth|headers|env/i.test(text);
}

function hasPinnedPackageIndicator(text: string): boolean {
    return /@[0-9]+\.[0-9]+\.[0-9]+|sha256:|@[a-f0-9]{12,40}\b/i.test(text);
}

function findDangerousEnvKeys(server: any): string[] {
    const env = server?.env;
    if (!env || typeof env !== 'object' || Array.isArray(env)) return [];
    return Object.keys(env).filter(key => DANGEROUS_ENV_KEYS.has(key));
}

function auditServer(name: string, server: any, serverPath: string, findings: McpFinding[]): void {
    const text = stableStringify(server);
    const urls = extractUrls(server);

    for (const urlText of urls) {
        let parsed: URL | undefined;
        try {
            parsed = new URL(urlText);
        } catch {
            continue;
        }

        const host = parsed.hostname.toLowerCase();
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
        const isRawIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

        if (parsed.protocol === 'http:' || isLocal || isRawIp) {
            addFinding(findings, {
                rule_id: 'MCP-001',
                severity: 'critical',
                message: `MCP server "${name}" uses an unencrypted, local, or raw-IP endpoint: ${urlText}`,
                fix: 'Use HTTPS, bind local services safely, and require authentication before exposing MCP tools.',
                path: serverPath,
                server: name,
            });
        }

        if (!isLocal && !hasAuthIndicator(server)) {
            addFinding(findings, {
                rule_id: 'MCP-003',
                severity: 'high',
                message: `Remote MCP server "${name}" does not show an authentication indicator.`,
                fix: 'Add explicit auth headers, OAuth, API key env references, or another documented authentication control.',
                path: serverPath,
                server: name,
            });
        }

        if (!isLocal && !ALLOWED_REMOTE_DOMAINS.has(host)) {
            addFinding(findings, {
                rule_id: 'MCP-006',
                severity: 'medium',
                message: `Remote MCP domain "${host}" is not in the built-in review allowlist.`,
                fix: 'Review the server publisher, pin the package/version, and document why this domain is trusted.',
                path: serverPath,
                server: name,
            });
        }
    }

    if (BROAD_SCOPE_PATTERNS.some(pattern => pattern.test(text))) {
        addFinding(findings, {
            rule_id: 'MCP-002',
            severity: 'high',
            message: `MCP server "${name}" appears to request broad filesystem, shell, admin, or network scope.`,
            fix: 'Scope tools to specific directories, commands, domains, and read/write actions.',
            path: serverPath,
            server: name,
        });
    }

    if (SUSPICIOUS_DESCRIPTION_PATTERNS.some(pattern => pattern.test(text)) || /[\u200B-\u200D\uFEFF]/.test(text)) {
        addFinding(findings, {
            rule_id: 'MCP-004',
            severity: 'medium',
            message: `MCP server "${name}" contains suspicious tool text or prompt-injection language.`,
            fix: 'Remove directive-like text from tool descriptions and review the package source.',
            path: serverPath,
            server: name,
        });
    }

    if (SECRET_PATTERNS.some(pattern => pattern.test(text))) {
        addFinding(findings, {
            rule_id: 'MCP-005',
            severity: 'high',
            message: `MCP server "${name}" appears to contain a hardcoded secret.`,
            fix: 'Move secrets to environment variables or a managed secret store and rotate exposed credentials.',
            path: serverPath,
            server: name,
        });
    }

    if (WRITE_SCOPE_PATTERNS.some(pattern => pattern.test(text)) && /\/|root|all|any|filesystem|workspace/i.test(text)) {
        addFinding(findings, {
            rule_id: 'MCP-008',
            severity: 'high',
            message: `MCP server "${name}" appears to allow write/delete filesystem operations with broad scope.`,
            fix: 'Restrict write tools to explicit safe directories, prefer read-only mode, and require human approval for destructive actions.',
            path: serverPath,
            server: name,
        });
    }

    const dangerousEnvKeys = findDangerousEnvKeys(server);
    if (dangerousEnvKeys.length > 0) {
        addFinding(findings, {
            rule_id: 'MCP-009',
            severity: 'high',
            message: `MCP server "${name}" exposes sensitive host environment variables: ${dangerousEnvKeys.join(', ')}.`,
            fix: 'Do not pass host credentials or sockets into MCP servers. Use scoped service tokens with least privilege.',
            path: serverPath,
            server: name,
        });
    }

    if (MUTABLE_PACKAGE_PATTERNS.some(pattern => pattern.test(text)) && !hasPinnedPackageIndicator(text)) {
        addFinding(findings, {
            rule_id: 'MCP-010',
            severity: 'medium',
            message: `MCP server "${name}" appears to install or execute an unpinned/mutable tool package.`,
            fix: 'Pin package versions, container digests, or commit SHAs before allowing the MCP server in CI or production.',
            path: serverPath,
            server: name,
        });
    }
}

function statusFromFindings(findings: McpFinding[]): McpAuditResult['status'] {
    if (findings.some(f => f.severity === 'critical' || f.severity === 'high')) return 'fail';
    if (findings.length > 0) return 'warn';
    return 'pass';
}

export function auditMcpConfig(filePath: string, content: string): McpAuditResult {
    const findings: McpFinding[] = [];
    let config: any;

    try {
        config = JSON.parse(content);
    } catch (err: any) {
        return {
            filePath,
            status: 'fail',
            findings: [{
                rule_id: 'MCP-007',
                severity: 'low',
                message: `MCP config is not valid JSON: ${err.message}`,
                fix: 'Fix JSON syntax before auditing MCP server trust boundaries.',
                path: '$',
            }],
        };
    }

    const servers = getServerEntries(config);
    if (servers.length === 0) {
        addFinding(findings, {
            rule_id: 'MCP-007',
            severity: 'low',
            message: 'MCP config does not contain a recognized mcpServers or servers object.',
            fix: 'Use the current MCP config shape with named server entries.',
            path: '$',
        });
    }

    if (!config.schemaVersion && !config.version) {
        addFinding(findings, {
            rule_id: 'MCP-007',
            severity: 'low',
            message: 'MCP config does not declare a schemaVersion or version.',
            fix: 'Add a schemaVersion/version field so config migrations are auditable.',
            path: '$',
        });
    }

    for (const [name, server, serverPath] of servers) {
        auditServer(name, server, serverPath, findings);
    }

    return {
        filePath,
        status: statusFromFindings(findings),
        findings,
    };
}

export function discoverMcpConfigPaths(cwd = process.cwd()): string[] {
    const candidates = [
        path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json'),
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : '',
        path.join(cwd, 'claude_desktop_config.json'),
        path.join(cwd, '.cursor', 'mcp.json'),
        path.join(cwd, 'mcp.json'),
    ].filter(Boolean);

    return Array.from(new Set(candidates)).filter(candidate => fs.existsSync(candidate));
}

export function auditDiscoveredMcpConfigs(targetPath?: string, cwd = process.cwd()): McpAuditResult[] {
    const paths = targetPath ? [path.resolve(targetPath)] : discoverMcpConfigPaths(cwd);
    return paths.map(filePath => {
        const content = fs.readFileSync(filePath, 'utf-8');
        return auditMcpConfig(filePath, content);
    });
}

export function getMcpExitCode(results: McpAuditResult[]): number {
    const findings = results.flatMap(result => result.findings);
    if (findings.some(f => f.severity === 'critical')) return 3;
    if (findings.some(f => f.severity === 'high')) return 2;
    if (findings.some(f => f.severity === 'medium' || f.severity === 'low')) return 1;
    return 0;
}
