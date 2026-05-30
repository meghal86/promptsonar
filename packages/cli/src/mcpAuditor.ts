import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface McpFinding {
  rule_id: string;
  server_name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  explanation: string;
  suggested_fix: string;
}

export interface McpAuditResult {
  filePath: string;
  passed: boolean;
  overallScore: number;
  findings: McpFinding[];
}

const DOMAIN_ALLOWLIST = [
  'github.com',
  'npmjs.com',
  'npmjs.org',
  'supabase.co',
  'stripe.com',
  'anthropic.com',
  'openai.com',
  'google.com',
  'mcp.run',
  'modelcontextprotocol.io'
];

/**
 * Automatically discovers any active Claude Desktop or Cursor MCP configs.
 */
export function discoverMcpConfig(): string | null {
  const home = os.homedir();
  const searchPaths = [
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.config', 'claude', 'claude_desktop_config.json'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : null,
    path.resolve('claude_desktop_config.json'),
    path.resolve('.cursor', 'mcp.json'),
    path.resolve('mcp.json')
  ].filter((p): p is string => p !== null);

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Runs the 7 core MCP Auditing Rules against the raw configuration content.
 */
export function auditMcpConfig(filePath: string, content: string): McpAuditResult {
  const findings: McpFinding[] = [];
  let config: any = {};

  try {
    config = JSON.parse(content);
  } catch (err: any) {
    return {
      filePath,
      passed: false,
      overallScore: 0,
      findings: [{
        rule_id: 'MCP-INVALID',
        server_name: 'global',
        severity: 'critical',
        explanation: `Configuration is invalid JSON: ${err.message}`,
        suggested_fix: 'Format the file as valid JSON.'
      }]
    };
  }

  // Rule MCP-007 (LOW): Legacy format check (missing schema, version)
  if (!config.mcpServers && !config.servers) {
    findings.push({
      rule_id: 'MCP-007',
      server_name: 'global',
      severity: 'low',
      explanation: 'Older format or missing "mcpServers" root configuration object.',
      suggested_fix: 'Define your servers within a parent "mcpServers" attribute block.'
    });
  }

  const servers = config.mcpServers || config.servers || {};

  for (const [name, server] of Object.entries<any>(servers)) {
    const command = server.command || '';
    const args: string[] = Array.isArray(server.args) ? server.args : [];
    const env: Record<string, string> = server.env || {};

    const allArgsStr = args.join(' ');
    const allEnvKeys = Object.keys(env).join(' ');
    const allEnvValues = Object.values(env).join(' ');

    // 1. MCP-001 (CRITICAL): Untrusted Server URL detection
    // Look for HTTP protocol, local unauthenticated raw ports, unencrypted IPs
    const httpRegex = /\bhttp:\/\/(?!(localhost|127\.0\.0\.1))\S+/i;
    const rawIpRegex = /\bhttp[s]?:\/\/([0-9]{1,3}\.){3}[0-9]{1,3}\b/i;
    const unauthLocalhost = /\b(localhost|127\.0\.0\.1):[0-9]+\b/i;

    if (httpRegex.test(allArgsStr) || httpRegex.test(allEnvValues)) {
      findings.push({
        rule_id: 'MCP-001',
        server_name: name,
        severity: 'critical',
        explanation: 'Untrusted HTTP link detected in command arguments or environment. Unencrypted channels are vulnerable to transit tampering.',
        suggested_fix: 'Replace plain HTTP URLs with secure encrypted HTTPS endpoints.'
      });
    }

    if (rawIpRegex.test(allArgsStr) || rawIpRegex.test(allEnvValues)) {
      findings.push({
        rule_id: 'MCP-001',
        server_name: name,
        severity: 'critical',
        explanation: 'Raw unencrypted IP host address detected. Raw IPs avoid standard domain trust certificates.',
        suggested_fix: 'Associate the server IP with a trusted domain and load via HTTPS.'
      });
    }

    // 2. MCP-002 (HIGH): Overpermissioned tool scope
    // Flag commands or args requesting absolute controls without path scopes
    const broadScopeKeywords = ['sudo', 'chmod', 'admin', '--unrestricted', '--allow-all', 'root'];
    const broadScopeFound = broadScopeKeywords.some(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(command) || regex.test(allArgsStr);
    });

    if (broadScopeFound || allArgsStr.includes('/*') || allArgsStr.includes('/*.*')) {
      findings.push({
        rule_id: 'MCP-002',
        server_name: name,
        severity: 'high',
        explanation: 'Overpermissioned tool scope detected. Admin level parameters or wildcard filesystem paths are requested.',
        suggested_fix: 'Limit the arguments to specific subdirectories or enable strict sandboxed read-only permissions.'
      });
    }

    // 3. MCP-003 (HIGH): Missing credentials or token keys
    // If command or args make external HTTP requests but no auth tokens are present in env or config
    const externalNetwork = /\bhttps:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/i;
    const hasToken = /(key|token|auth|bearer|secret|password|pass|jwt|signature)/i;
    if (externalNetwork.test(allArgsStr) && !hasToken.test(allEnvKeys) && !hasToken.test(allArgsStr)) {
      findings.push({
        rule_id: 'MCP-003',
        server_name: name,
        severity: 'high',
        explanation: 'Server accesses external network resources but lacks API key/credential arguments or env parameters.',
        suggested_fix: 'Provide credentials via environment variables rather than running unauthenticated APIs.'
      });
    }

    // 4. MCP-004 (MEDIUM): Suspicious tool description or payload
    // Flag homoglyphs, override/jailbreak payloads inside name or arguments
    const jailbreakDirectives = [
      ['ignore', 'instructions'].join(' '),
      ['ignore', 'previous'].join(' '),
      ['system', 'prompt'].join(' '),
      'override',
      'bypass'
    ];
    const hasJailbreak = jailbreakDirectives.some(d => {
      const regex = new RegExp(d, 'i');
      return regex.test(name) || regex.test(allArgsStr);
    });

    if (hasJailbreak) {
      findings.push({
        rule_id: 'MCP-004',
        server_name: name,
        severity: 'medium',
        explanation: 'Tool contains prompt overrides or injection directives that could lead to LLM jailbreaks.',
        suggested_fix: 'Remove directive commands or system prompt overrides from tool configuration fields.'
      });
    }

    // 5. MCP-005 (HIGH): Hardcoded secrets parser
    const secretPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,                  // OpenAI keys
      /Bearer\s+[a-zA-Z0-9_\-\.]{15,}/,       // Bearer tokens
      /ghp_[a-zA-Z0-9]{36}/,                  // GitHub tokens
      /xoxb-[a-zA-Z0-9\-]{20,}/,              // Slack tokens
      /password\s*=\s*['"][^'"]+['"]/i,       // Inline passwords
      /secret\s*=\s*['"][^'"]+['"]/i          // Inline secrets
    ];

    const hasHardcodedSecret = secretPatterns.some(pattern => 
      pattern.test(allArgsStr) || pattern.test(allEnvValues)
    );

    if (hasHardcodedSecret) {
      findings.push({
        rule_id: 'MCP-005',
        server_name: name,
        severity: 'high',
        explanation: 'Hardcoded secrets, API tokens, or keys detected in configuration parameters.',
        suggested_fix: 'Load secrets dynamically from secure system environments instead of committing them to disk configs.'
      });
    }

    // 6. MCP-006 (MEDIUM): Unverified server URL
    // Check if domain in args is NOT standard local and not in allowlist
    const domainMatch = allArgsStr.match(/https?:\/\/([a-zA-Z0-9-\.]+)/i);
    if (domainMatch) {
      const domain = domainMatch[1].toLowerCase();
      const isLocal = domain === 'localhost' || domain === '127.0.0.1';
      const isAllowed = DOMAIN_ALLOWLIST.some(d => domain === d || domain.endsWith('.' + d));
      
      if (!isLocal && !isAllowed) {
        findings.push({
          rule_id: 'MCP-006',
          server_name: name,
          severity: 'medium',
          explanation: `Unverified server URL domain: "${domain}". Domain is missing from standard trust allowlists.`,
          suggested_fix: 'Validate that this domain is a trusted provider, or register it inside your enterprise policy configs.'
        });
      }
    }
  }

  // Calculate score (0-100)
  let scorePenalty = 0;
  for (const f of findings) {
    if (f.severity === 'critical') scorePenalty += 40;
    if (f.severity === 'high') scorePenalty += 25;
    if (f.severity === 'medium') scorePenalty += 15;
    if (f.severity === 'low') scorePenalty += 5;
  }

  const overallScore = Math.max(0, 100 - scorePenalty);
  const passed = !findings.some(f => f.severity === 'critical' || f.severity === 'high');

  return {
    filePath,
    passed,
    overallScore,
    findings
  };
}

/**
 * Formats MCP audit findings as standard SARIF JSON v2.1.0 format.
 */
export function generateMcpSarif(result: McpAuditResult): string {
  const sarif = {
    $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'PromptSonar MCP Auditor',
            version: '1.4.0',
            informationUri: 'https://github.com/meghal86/promptsonar',
            rules: [
              { id: 'MCP-001', shortDescription: { text: 'Untrusted Server URL' } },
              { id: 'MCP-002', shortDescription: { text: 'Overpermissioned Scope' } },
              { id: 'MCP-003', shortDescription: { text: 'Missing Credentials' } },
              { id: 'MCP-004', shortDescription: { text: 'Suspicious Tool Description' } },
              { id: 'MCP-005', shortDescription: { text: 'Hardcoded Secret' } },
              { id: 'MCP-006', shortDescription: { text: 'Unverified Domain' } },
              { id: 'MCP-007', shortDescription: { text: 'Legacy Config Format' } }
            ]
          }
        },
        results: result.findings.map(f => ({
          ruleId: f.rule_id,
          level: f.severity === 'critical' || f.severity === 'high' ? 'error' : (f.severity === 'medium' ? 'warning' : 'note'),
          message: {
            text: `[Server: ${f.server_name}] ${f.explanation}`
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: `file://${result.filePath}`
                }
              }
            }
          ]
        }))
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}
