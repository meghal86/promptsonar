import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CanonicalIssueContext } from '../contextual';
import { FindingWorkflow, inferWorkflowForFinding } from '../workflow';
import { normalizeMcpAuditResultContextual } from './contextual';

export type McpSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface McpFinding {
    rule_id: string;
    severity: McpSeverity;
    message: string;
    fix: string;
    path: string;
    server?: string;
    workflow?: FindingWorkflow;
    evidence?: string;
    confidence_contribution?: number;
    line?: number;
    column?: number;
    context?: CanonicalIssueContext;
}

export type McpRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface McpRiskFactor {
    rule_id: string;
    weight: number;
    evidence?: string;
    server?: string;
}

export interface McpRiskScore {
    score: number;
    level: McpRiskLevel;
    factors: McpRiskFactor[];
}

export interface McpServerSummary {
    server: string;
    capabilities: string[];
    permissions: string[];
    execution_mode: 'auto' | 'manual' | 'unknown';
    risk_score: McpRiskScore;
}

export interface McpAuditResult {
    filePath: string;
    status: 'pass' | 'warn' | 'fail';
    findings: McpFinding[];
    risk_score?: McpRiskScore;
    servers?: McpServerSummary[];
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
    /\bunrestricted\s+(filesystem|shell|network)\s+access\b/i,
    /\bshell_exec\b/i,
    /\bfilesystem_access\b/i,
    /\binternal_network_access\b/i,
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

const AUTO_EXECUTE_PATTERNS = [
    /\bautoExecute\b/i,
    /\bauto[-_\s]?execute\b/i,
    /\bexecute\s+automatically\b/i,
    /\bautomatic\s+execution\b/i,
    /\bskip\s+confirmation\b/i,
    /\bwithout\s+(?:approval|confirmation)\b/i,
];

const WILDCARD_PERMISSION_PATTERNS = [
    /\bwildcard\s+permissions?\b/i,
    /"\*"/,
    /\ball\s+permissions?\b/i,
    /\bpermissions?\s*[:=]\s*(?:all|\*)\b/i,
    /\bscopes?\s*[:=]\s*(?:all|\*)\b/i,
];

const CREDENTIAL_PASSTHROUGH_PATTERNS = [
    /\bcredential\s+passthrough\b/i,
    /\bpass\s+(?:through|host)\s+credentials?\b/i,
    /\bforward\s+(?:tokens?|credentials?|secrets?)\b/i,
    /\buse\s+host\s+(?:tokens?|credentials?|secrets?)\b/i,
];

const SELF_MODIFYING_PATTERNS = [
    /\bself[-\s]?modifying\s+mcp\s+instructions?\b/i,
    /\brewrite\s+(?:its\s+|the\s+)?(?:tool\s+)?instructions?\b/i,
    /\bmodify\s+(?:its\s+|the\s+)?(?:mcp\s+|tool\s+)?instructions?\b/i,
    /\boverride\s+system\s+instructions?\b/i,
    /\brewrite\s+(?:the\s+)?system\s+prompt\b/i,
];

const PRIVILEGED_MCP_SINK_PATTERNS = [
    /\bbash\b/i,
    /\bshell\b/i,
    /\bshell_exec\b/i,
    /\bexecute\s+(?:any\s+|all\s+)?commands?\b/i,
    /\bfilesystem\b/i,
    /\bfilesystem_access\b/i,
    /\b--allow-write\b/i,
    /\b--allow-read\b/i,
    /\bnetwork\s+access\b/i,
    /\binternal_network_access\b/i,
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

const FS_CAPABILITY_TOKENS = ['filesystem', 'file_write', 'file_read', 'disk_access', 'workspace_access', 'fs', 'files'];
const SHELL_CAPABILITY_TOKENS = ['shell', 'bash', 'terminal', 'exec', 'spawn', 'process', 'subprocess', 'shell_exec'];
// Launcher binaries that are shells, and interpreters that execute arbitrary
// code when given an inline-eval flag. Kept in sync with the repository-layer
// launcher detection in repository/analyzer.ts so both layers agree.
const SHELL_LAUNCHER_BINARIES = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'powershell', 'pwsh', 'cmd', 'cmd.exe']);
const INLINE_EVAL_INTERPRETERS = new Set(['python', 'python2', 'python3', 'node', 'nodejs', 'ruby', 'perl']);
const NETWORK_CAPABILITY_TOKENS = ['network', 'http', 'https', 'fetch', 'curl', 'axios', 'request', 'webhook'];
const CREDENTIAL_KEY_TOKENS = ['api_key', 'apikey', 'secret', 'token', 'bearer', 'authorization', 'credentials', 'auth_token', 'access_token'];

interface ServerStructuralAnalysis {
    autoExecute?: { value: unknown; key: string };
    autoApprove?: { value: unknown; key: string };
    approvalRequired?: { value: unknown; key: string };
    wildcardPermissions: string[];
    allowAll?: { value: unknown; key: string };
    fsCapabilities: string[];
    shellCapabilities: string[];
    networkCapabilities: string[];
    credentialFields: string[];
    routedTo: string[];
}

function collectStrings(value: unknown, out: string[]): void {
    if (value == null) return;
    if (typeof value === 'string') {
        out.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, out);
        return;
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out);
    }
}

function containsToken(haystack: string, tokens: string[]): string | undefined {
    const lower = haystack.toLowerCase();
    return tokens.find(token => lower.includes(token));
}

function findKeyValues(node: unknown, key: string, out: Array<{ value: unknown; path: string }>, currentPath = ''): void {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        node.forEach((item, idx) => findKeyValues(item, key, out, `${currentPath}[${idx}]`));
        return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const nextPath = currentPath ? `${currentPath}.${k}` : k;
        if (k.toLowerCase() === key.toLowerCase()) {
            out.push({ value: v, path: nextPath });
        }
        findKeyValues(v, key, out, nextPath);
    }
}

function analyzeServerStructure(server: any): ServerStructuralAnalysis {
    const analysis: ServerStructuralAnalysis = {
        wildcardPermissions: [],
        fsCapabilities: [],
        shellCapabilities: [],
        networkCapabilities: [],
        credentialFields: [],
        routedTo: [],
    };

    if (!server || typeof server !== 'object') return analysis;

    const autoExec: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'autoExecute', autoExec);
    findKeyValues(server, 'auto_execute', autoExec);
    if (autoExec.length > 0) analysis.autoExecute = { value: autoExec[0].value, key: autoExec[0].path };

    const autoApprove: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'autoApprove', autoApprove);
    findKeyValues(server, 'auto_approve', autoApprove);
    if (autoApprove.length > 0) analysis.autoApprove = { value: autoApprove[0].value, key: autoApprove[0].path };

    const approval: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'approvalRequired', approval);
    findKeyValues(server, 'approval_required', approval);
    findKeyValues(server, 'requiresApproval', approval);
    if (approval.length > 0) analysis.approvalRequired = { value: approval[0].value, key: approval[0].path };

    const allowAll: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'allowAll', allowAll);
    findKeyValues(server, 'allow_all', allowAll);
    if (allowAll.length > 0) analysis.allowAll = { value: allowAll[0].value, key: allowAll[0].path };

    const permissions: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'permissions', permissions);
    findKeyValues(server, 'scopes', permissions);
    for (const p of permissions) {
        const values: string[] = [];
        collectStrings(p.value, values);
        if (p.value === '' || values.some(v => v === '*' || v === '' || v.toLowerCase() === 'all')) {
            analysis.wildcardPermissions.push(`${p.path}=${stableStringify(p.value)}`);
        }
    }

    const capabilities: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'capabilities', capabilities);
    findKeyValues(server, 'tools', capabilities);
    const capabilityStrings: string[] = [];
    for (const c of capabilities) collectStrings(c.value, capabilityStrings);
    for (const cap of capabilityStrings) {
        const fs = containsToken(cap, FS_CAPABILITY_TOKENS);
        if (fs) analysis.fsCapabilities.push(cap);
        const sh = containsToken(cap, SHELL_CAPABILITY_TOKENS);
        if (sh) analysis.shellCapabilities.push(cap);
        const nt = containsToken(cap, NETWORK_CAPABILITY_TOKENS);
        if (nt) analysis.networkCapabilities.push(cap);
    }

    const argsStrings: string[] = [];
    collectStrings(server.args, argsStrings);

    if (typeof server.command === 'string') {
        const command = server.command.trim();
        const binary = command.split(/[\\/\s]+/).filter(Boolean).pop()?.toLowerCase() || '';
        // A shell binary launcher is itself shell execution.
        if (SHELL_LAUNCHER_BINARIES.has(binary) || containsToken(command, SHELL_CAPABILITY_TOKENS)) {
            analysis.shellCapabilities.push(`command=${server.command}`);
        }
        // An interpreter launched with an inline-eval flag (python -c, node -e,
        // ruby -e, perl -e) runs arbitrary code — equivalent to shell.
        if (INLINE_EVAL_INTERPRETERS.has(binary) && argsStrings.some(arg => arg === '-c' || arg === '-e')) {
            analysis.shellCapabilities.push(`command=${server.command} (inline eval)`);
        }
    }
    for (const a of argsStrings) {
        // bash/sh/zsh -c form, or a shell binary referenced in an argument.
        if ((a === '-c' || a === '/c') && argsStrings.some(arg => SHELL_LAUNCHER_BINARIES.has(arg.toLowerCase()))) {
            analysis.shellCapabilities.push(`args=${a}`);
        }
        if (containsToken(a, SHELL_CAPABILITY_TOKENS) && /\bbash\b|\bsh\b|\bzsh\b/i.test(a)) {
            analysis.shellCapabilities.push(`args=${a}`);
        }
    }

    // MCP-013 (credential propagation) targets passthrough of host credentials, not
    // hardcoded secrets (MCP-005) or normal outbound auth. Only flag credential-named
    // keys whose values reference host env interpolation (`${VAR}`) or empty placeholders.
    const credentialCarriers: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'headers', credentialCarriers);
    findKeyValues(server, 'env', credentialCarriers);
    for (const hc of credentialCarriers) {
        if (hc.value && typeof hc.value === 'object' && !Array.isArray(hc.value)) {
            for (const [k, v] of Object.entries(hc.value as Record<string, unknown>)) {
                const matchesKey = CREDENTIAL_KEY_TOKENS.some(token => k.toLowerCase().includes(token));
                if (!matchesKey) continue;
                const valueText = typeof v === 'string' ? v : stableStringify(v);
                const isInEnv = hc.path === 'env' || hc.path.endsWith('.env');
                const referencesHostEnv = /\$\{[A-Z_][A-Z0-9_]*\}/.test(valueText) || /\$[A-Z_][A-Z0-9_]*/.test(valueText);
                if (isInEnv && referencesHostEnv) {
                    analysis.credentialFields.push(`${hc.path}.${k}=${valueText}`);
                }
            }
        }
    }

    const routing: Array<{ value: unknown; path: string }> = [];
    findKeyValues(server, 'routeTo', routing);
    findKeyValues(server, 'route_to', routing);
    findKeyValues(server, 'forwardsTo', routing);
    findKeyValues(server, 'forwards_to', routing);
    findKeyValues(server, 'upstream', routing);
    findKeyValues(server, 'upstreams', routing);
    findKeyValues(server, 'chain', routing);
    findKeyValues(server, 'delegate', routing);
    findKeyValues(server, 'delegateTo', routing);
    for (const r of routing) {
        const values: string[] = [];
        collectStrings(r.value, values);
        analysis.routedTo.push(...values);
    }

    return analysis;
}

function redactSecret(value: string): string {
    if (value.length <= 8) return '***';
    return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

function redactEvidence(text: string): string {
    let redacted = text;
    for (const pattern of SECRET_PATTERNS) {
        redacted = redacted.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'), match => redactSecret(match));
    }
    return redacted;
}

function isFalsyApproval(value: unknown): boolean {
    return value === false || value === 'false' || value === 0 || value === '0' || value === 'no' || value === 'off';
}

function isTruthyFlag(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes' || value === 'on';
}

const RISK_WEIGHTS: Record<string, number> = {
    'MCP-001': 25,
    'MCP-002': 15,
    'MCP-003': 10,
    'MCP-004': 10,
    'MCP-005': 20,
    'MCP-006': 5,
    'MCP-008': 15,
    'MCP-009': 15,
    'MCP-010': 8,
    'MCP-011': 20,
    'MCP-012': 25,
    'MCP-013': 20,
    'MCP-014': 15,
    'MCP-103': 15,
    'MCP-104': 25,
    'MCP-105': 15,
    'MCP-107': 12,
    'MCP-108': 30,
    'MCP-109': 30,
};

function levelFromScore(score: number): McpRiskLevel {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 25) return 'MEDIUM';
    return 'LOW';
}

function computeRiskScore(findings: McpFinding[], scopeServer?: string): McpRiskScore {
    const factors: McpRiskFactor[] = [];
    let total = 0;
    for (const f of findings) {
        if (scopeServer && f.server !== scopeServer) continue;
        const weight = f.confidence_contribution ?? RISK_WEIGHTS[f.rule_id] ?? 5;
        total += weight;
        factors.push({
            rule_id: f.rule_id,
            weight,
            evidence: f.evidence,
            server: f.server,
        });
    }
    const score = Math.min(100, total);
    return { score, level: levelFromScore(score), factors };
}

// Locate the config line a finding refers to: prefer a key named in the
// evidence (e.g. "permissions=..."), then the last JSON-path segment, then the
// server name itself. The search is anchored at the server entry so two
// servers with the same key resolve to their own lines.
export function locateMcpFindingPosition(content: string, finding: Pick<McpFinding, 'path' | 'server' | 'evidence'>): { line: number; column: number } | undefined {
    const lines = content.split(/\r?\n/);
    const serverIndex = finding.server
        ? lines.findIndex(line => line.includes(`"${finding.server}"`) || line.includes(`'${finding.server}'`))
        : -1;

    const candidates: string[] = [];
    for (const match of (finding.evidence || '').matchAll(/(?:^|[\s;])([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)=/g)) {
        candidates.push(match[1].split('.').pop()!);
    }
    const pathSegments = (finding.path || '').split('.').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment && lastSegment !== finding.server && lastSegment !== 'mcpServers' && lastSegment !== 'servers') {
        candidates.push(lastSegment);
    }

    for (const key of candidates) {
        for (let index = Math.max(0, serverIndex); index < lines.length; index++) {
            const column = lines[index].indexOf(`"${key}"`);
            if (column >= 0) return { line: index + 1, column: column + 1 };
        }
    }
    if (serverIndex >= 0) {
        return { line: serverIndex + 1, column: Math.max(1, lines[serverIndex].indexOf(`"${finding.server}"`) + 1) };
    }
    return undefined;
}

function addFinding(findings: McpFinding[], finding: McpFinding, content?: string, filePath?: string): void {
    if (content && finding.line === undefined) {
        const position = locateMcpFindingPosition(content, finding);
        if (position) {
            finding.line = position.line;
            finding.column = position.column;
        }
    }
    if (!finding.workflow) {
        const workflow = inferWorkflowForFinding({
            ruleId: finding.rule_id,
            severity: finding.severity,
            text: `${finding.message}\n${finding.fix}`,
            content,
            filePath,
            message: finding.message,
        });
        if (workflow) finding.workflow = workflow;
    }

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

function hasPrivilegedMcpSink(text: string): boolean {
    return PRIVILEGED_MCP_SINK_PATTERNS.some(pattern => pattern.test(text));
}

function mcpExecutionSeverity(text: string): McpSeverity {
    const hasPrivilegedSink = hasPrivilegedMcpSink(text);
    const hasAutonomousOrBypass = AUTO_EXECUTE_PATTERNS.some(pattern => pattern.test(text));
    const hasPersistenceOrOverride = SELF_MODIFYING_PATTERNS.some(pattern => pattern.test(text))
        || /\bpersist\s+instructions?\b/i.test(text)
        || /\boverride\b/i.test(text)
        || /\bignore\s+(?:previous|all|system)\s+instructions?\b/i.test(text);
    return hasPrivilegedSink && (hasAutonomousOrBypass || hasPersistenceOrOverride) ? 'critical' : 'high';
}

function auditServer(name: string, server: any, serverPath: string, findings: McpFinding[], content: string, filePath: string): ServerStructuralAnalysis {
    const text = stableStringify(server);
    const urls = extractUrls(server);
    const structure = analyzeServerStructure(server);

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
            }, content, filePath);
        }

        if (!isLocal && !hasAuthIndicator(server)) {
            addFinding(findings, {
                rule_id: 'MCP-003',
                severity: 'high',
                message: `Remote MCP server "${name}" does not show an authentication indicator.`,
                fix: 'Add explicit auth headers, OAuth, API key env references, or another documented authentication control.',
                path: serverPath,
                server: name,
            }, content, filePath);
        }

        if (!isLocal && !ALLOWED_REMOTE_DOMAINS.has(host)) {
            addFinding(findings, {
                rule_id: 'MCP-006',
                severity: 'medium',
                message: `Remote MCP domain "${host}" is not in the built-in review allowlist.`,
                fix: 'Review the server publisher, pin the package/version, and document why this domain is trusted.',
                path: serverPath,
                server: name,
            }, content, filePath);
        }
    }

    if (BROAD_SCOPE_PATTERNS.some(pattern => pattern.test(text))) {
        addFinding(findings, {
            rule_id: 'MCP-002',
            severity: mcpExecutionSeverity(text),
            message: `MCP server "${name}" appears to request broad filesystem, shell, admin, or network scope.`,
            fix: 'Scope tools to specific directories, commands, domains, and read/write actions.',
            path: serverPath,
            server: name,
        }, content, filePath);
    }

    if (SUSPICIOUS_DESCRIPTION_PATTERNS.some(pattern => pattern.test(text)) || /[\u200B-\u200D\uFEFF]/.test(text)) {
        addFinding(findings, {
            rule_id: 'MCP-004',
            severity: hasPrivilegedMcpSink(text) ? mcpExecutionSeverity(text) : 'medium',
            message: `MCP server "${name}" contains suspicious tool text or prompt-injection language.`,
            fix: 'Remove directive-like text from tool descriptions and review the package source.',
            path: serverPath,
            server: name,
        }, content, filePath);
    }

    if (SECRET_PATTERNS.some(pattern => pattern.test(text))) {
        addFinding(findings, {
            rule_id: 'MCP-005',
            severity: 'high',
            message: `MCP server "${name}" appears to contain a hardcoded secret.`,
            fix: 'Move secrets to environment variables or a managed secret store and rotate exposed credentials.',
            path: serverPath,
            server: name,
        }, content, filePath);
    }

    if (WRITE_SCOPE_PATTERNS.some(pattern => pattern.test(text)) && /\/|root|all|any|filesystem|workspace/i.test(text)) {
        addFinding(findings, {
            rule_id: 'MCP-008',
            severity: 'high',
            message: `MCP server "${name}" appears to allow write/delete filesystem operations with broad scope.`,
            fix: 'Restrict write tools to explicit safe directories, prefer read-only mode, and require human approval for destructive actions.',
            path: serverPath,
            server: name,
        }, content, filePath);
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
        }, content, filePath);
    }

    if (MUTABLE_PACKAGE_PATTERNS.some(pattern => pattern.test(text)) && !hasPinnedPackageIndicator(text)) {
        addFinding(findings, {
            rule_id: 'MCP-010',
            severity: 'medium',
            message: `MCP server "${name}" appears to install or execute an unpinned/mutable tool package.`,
            fix: 'Pin package versions, container digests, or commit SHAs before allowing the MCP server in CI or production.',
            path: serverPath,
            server: name,
        }, content, filePath);
    }

    const autoExecuteEvidence: string[] = [];
    if (structure.autoExecute && isTruthyFlag(structure.autoExecute.value)) {
        autoExecuteEvidence.push(`${structure.autoExecute.key}=${stableStringify(structure.autoExecute.value)}`);
    }
    if (structure.autoApprove && isTruthyFlag(structure.autoApprove.value)) {
        autoExecuteEvidence.push(`${structure.autoApprove.key}=${stableStringify(structure.autoApprove.value)}`);
    }
    if (structure.approvalRequired && isFalsyApproval(structure.approvalRequired.value)) {
        autoExecuteEvidence.push(`${structure.approvalRequired.key}=${stableStringify(structure.approvalRequired.value)}`);
    }
    const hasAutoExecuteRegex = AUTO_EXECUTE_PATTERNS.some(pattern => pattern.test(text));
    if (autoExecuteEvidence.length > 0 || hasAutoExecuteRegex) {
        addFinding(findings, {
            rule_id: 'MCP-011',
            severity: mcpExecutionSeverity(text),
            message: `MCP server "${name}" appears to allow automatic tool execution without reliable approval gating.`,
            fix: 'Disable auto-execution and require explicit human approval for privileged MCP tool calls.',
            path: serverPath,
            server: name,
            evidence: autoExecuteEvidence.join('; ') || 'matched auto-execute language in config text',
            confidence_contribution: RISK_WEIGHTS['MCP-011'],
        }, content, filePath);
    }

    const wildcardEvidence: string[] = [...structure.wildcardPermissions];
    if (structure.allowAll && isTruthyFlag(structure.allowAll.value)) {
        wildcardEvidence.push(`${structure.allowAll.key}=${stableStringify(structure.allowAll.value)}`);
    }
    const hasWildcardRegex = WILDCARD_PERMISSION_PATTERNS.some(pattern => pattern.test(text));
    if (wildcardEvidence.length > 0 || hasWildcardRegex) {
        addFinding(findings, {
            rule_id: 'MCP-012',
            severity: hasPrivilegedMcpSink(text) ? mcpExecutionSeverity(text) : 'high',
            message: `MCP server "${name}" appears to request wildcard permissions or all scopes.`,
            fix: 'Replace wildcard MCP permissions with explicit tool, path, command, and network allowlists.',
            path: serverPath,
            server: name,
            evidence: wildcardEvidence.join('; ') || 'wildcard permission pattern in config text',
            confidence_contribution: RISK_WEIGHTS['MCP-012'],
        }, content, filePath);
    }

    if (structure.fsCapabilities.length > 0) {
        addFinding(findings, {
            rule_id: 'MCP-103',
            severity: 'high',
            message: `MCP server "${name}" declares filesystem capability.`,
            fix: 'Scope filesystem tools to specific directories and prefer read-only access where possible.',
            path: serverPath,
            server: name,
            evidence: Array.from(new Set(structure.fsCapabilities)).join(', '),
            confidence_contribution: RISK_WEIGHTS['MCP-103'],
        }, content, filePath);
    }

    if (structure.shellCapabilities.length > 0) {
        addFinding(findings, {
            rule_id: 'MCP-104',
            severity: 'critical',
            message: `MCP server "${name}" declares shell or process execution capability.`,
            fix: 'Remove shell/exec capability or restrict it to a fixed allowlist of commands with human approval.',
            path: serverPath,
            server: name,
            evidence: Array.from(new Set(structure.shellCapabilities)).join(', '),
            confidence_contribution: RISK_WEIGHTS['MCP-104'],
        }, content, filePath);
    }

    if (structure.networkCapabilities.length > 0) {
        addFinding(findings, {
            rule_id: 'MCP-105',
            severity: 'high',
            message: `MCP server "${name}" declares external network capability.`,
            fix: 'Restrict network egress to an explicit domain allowlist and disable arbitrary fetch.',
            path: serverPath,
            server: name,
            evidence: Array.from(new Set(structure.networkCapabilities)).join(', '),
            confidence_contribution: RISK_WEIGHTS['MCP-105'],
        }, content, filePath);
    }

    const credentialEvidence: string[] = [...structure.credentialFields];
    const hasCredentialPassthrough = CREDENTIAL_PASSTHROUGH_PATTERNS.some(pattern => pattern.test(text));
    if (credentialEvidence.length > 0 || hasCredentialPassthrough) {
        addFinding(findings, {
            rule_id: 'MCP-013',
            severity: 'high',
            message: `MCP server "${name}" appears to propagate host credentials, tokens, or authorization headers to tools.`,
            fix: 'Use scoped service credentials and do not pass host secrets into MCP process or remote tool contexts.',
            path: serverPath,
            server: name,
            evidence: redactEvidence(credentialEvidence.join('; ') || 'credential passthrough language in config'),
            confidence_contribution: RISK_WEIGHTS['MCP-013'],
        }, content, filePath);
    }

    if (SELF_MODIFYING_PATTERNS.some(pattern => pattern.test(text))) {
        addFinding(findings, {
            rule_id: 'MCP-014',
            severity: mcpExecutionSeverity(text),
            message: `MCP server "${name}" contains self-modifying or system-instruction rewrite behavior.`,
            fix: 'Remove instruction-rewrite behavior from MCP metadata and pin reviewed tool instructions.',
            path: serverPath,
            server: name,
            confidence_contribution: RISK_WEIGHTS['MCP-014'],
        }, content, filePath);
    }

    return structure;
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
        }, content, filePath);
    }

    if (!config.schemaVersion && !config.version) {
        addFinding(findings, {
            rule_id: 'MCP-007',
            severity: 'low',
            message: 'MCP config does not declare a schemaVersion or version.',
            fix: 'Add a schemaVersion/version field so config migrations are auditable.',
            path: '$',
        }, content, filePath);
    }

    const serverNames = new Set(servers.map(([name]) => String(name)));
    const serverSummaries: McpServerSummary[] = [];

    for (const [name, server, serverPath] of servers) {
        const structure = auditServer(name, server, serverPath, findings, content, filePath);

        const internalTargets = structure.routedTo.filter(target => serverNames.has(target) && target !== name);
        const externalTargets = structure.routedTo.filter(target => !serverNames.has(target) && /^[a-z][\w.-]*$/i.test(target));
        const chainTargets = [...internalTargets, ...externalTargets];
        if (chainTargets.length > 0) {
            addFinding(findings, {
                rule_id: 'MCP-107',
                severity: 'high',
                message: `MCP server "${name}" chains execution to additional MCP server(s): ${chainTargets.join(', ')}.`,
                fix: 'Document and minimize MCP-to-MCP hops. Each hop must enforce its own auth, allowlist, and approval gates.',
                path: serverPath,
                server: name,
                evidence: `chain: ${name} -> ${chainTargets.join(', ')}`,
                confidence_contribution: RISK_WEIGHTS['MCP-107'],
            }, content, filePath);
        }

        const serverFindings = findings.filter(f => f.server === name);
        const hasFs = structure.fsCapabilities.length > 0 || serverFindings.some(f => f.rule_id === 'MCP-008');
        const hasShell = structure.shellCapabilities.length > 0;
        const hasNetwork = structure.networkCapabilities.length > 0;
        const broadOrWildcard = serverFindings.some(f => f.rule_id === 'MCP-002' || f.rule_id === 'MCP-012');
        const autoExec = serverFindings.some(f => f.rule_id === 'MCP-011');

        if ((hasFs || hasShell || hasNetwork) && (broadOrWildcard || autoExec)) {
            const sinks = [hasShell && 'shell', hasFs && 'filesystem', hasNetwork && 'network'].filter(Boolean).join('+');
            addFinding(findings, {
                rule_id: 'MCP-108',
                severity: 'critical',
                message: `MCP server "${name}" exposes a privilege escalation path: untrusted prompt -> MCP tool -> ${sinks}.`,
                fix: 'Break the escalation path: scope capabilities, require approval, and isolate the privileged sink behind a trusted broker.',
                path: serverPath,
                server: name,
                evidence: `sinks=${sinks}; trigger=${broadOrWildcard ? 'broad/wildcard scope' : 'auto-exec'}`,
                confidence_contribution: RISK_WEIGHTS['MCP-108'],
            }, content, filePath);
        }

        const wildcardFinding = serverFindings.find(f => f.rule_id === 'MCP-012');
        const autoExecFinding = serverFindings.find(f => f.rule_id === 'MCP-011');
        const shellFinding = serverFindings.find(f => f.rule_id === 'MCP-104');
        const approvalRequiredFalsy = !!structure.approvalRequired && isFalsyApproval(structure.approvalRequired.value);
        if ((autoExecFinding && approvalRequiredFalsy) || (wildcardFinding && shellFinding)) {
            const parts: string[] = [];
            if (autoExecFinding) parts.push(autoExecFinding.evidence || 'auto-exec');
            if (approvalRequiredFalsy && structure.approvalRequired) parts.push(`${structure.approvalRequired.key}=${stableStringify(structure.approvalRequired.value)}`);
            if (wildcardFinding) parts.push(wildcardFinding.evidence || 'wildcard permissions');
            if (shellFinding) parts.push(shellFinding.evidence || 'shell capability');
            addFinding(findings, {
                rule_id: 'MCP-109',
                severity: 'critical',
                message: `MCP server "${name}" combines settings that bypass human approval for dangerous actions.`,
                fix: 'Re-enable approval gating and remove either the auto-execute flag or the privileged capability before shipping.',
                path: serverPath,
                server: name,
                evidence: parts.join(' AND '),
                confidence_contribution: RISK_WEIGHTS['MCP-109'],
            }, content, filePath);
        }

        const capabilities = Array.from(new Set([
            ...structure.fsCapabilities,
            ...structure.shellCapabilities,
            ...structure.networkCapabilities,
        ]));
        const permissions = structure.wildcardPermissions.length > 0
            ? Array.from(new Set(structure.wildcardPermissions))
            : [];
        const executionMode: McpServerSummary['execution_mode'] = autoExec
            ? 'auto'
            : (structure.approvalRequired && !isFalsyApproval(structure.approvalRequired.value)) ? 'manual' : 'unknown';

        const serverScopedFindings = findings.filter(f => f.server === name);
        serverSummaries.push({
            server: String(name),
            capabilities,
            permissions,
            execution_mode: executionMode,
            risk_score: computeRiskScore(serverScopedFindings, String(name)),
        });
    }

    const overallScore = computeRiskScore(findings);

    return normalizeMcpAuditResultContextual({
        filePath,
        status: statusFromFindings(findings),
        findings,
        risk_score: overallScore,
        servers: serverSummaries,
    });
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
