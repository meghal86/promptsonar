import fs from 'fs';
import path from 'path';
import Link from 'next/link';
import { auditMcpConfig, evaluatePrompt } from '@promptsonar/core';
import type { Finding, McpFinding, Severity } from '@promptsonar/core';

type Risk = 'critical' | 'high' | 'medium' | 'low' | 'none';

interface AnalyzedFinding extends Finding {
  sourceFile: string;
}

interface AnalyzedMcpFinding extends McpFinding {
  sourceFile: string;
}

const toneClasses: Record<string, string> = {
  red: 'bg-red-50 text-red-700 border-red-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  slate: 'bg-slate-50 text-slate-700 border-slate-100'
};

const riskRank: Record<Risk, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1
};

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2
};

const workflowLabel: Record<string, string> = {
  user_input: 'User Input',
  untrusted_content: 'Untrusted Content',
  system_prompt: 'System Prompt',
  developer_prompt: 'Developer Prompt',
  prompt_template: 'Prompt Template',
  agent_memory: 'Memory',
  retrieved_context: 'Retrieved Context',
  rag_context: 'RAG Context',
  mcp_server: 'MCP Server',
  mcp_tool: 'MCP Tool',
  privileged_tool: 'Privileged Tool',
  tool_router: 'Tool Router',
  tool_execution: 'Tool Execution',
  shell_execution: 'Shell Execution',
  network_access: 'Network',
  filesystem_access: 'Filesystem',
  credential_store: 'Credential Store',
  external_api: 'External API',
  policy_override: 'Policy Override',
  secret: 'Secret',
  model: 'Model',
  response: 'Response',
  unknown: 'Unknown'
};

function findRepoRoot(start: string): string {
  let current = start;
  while (current !== path.dirname(current)) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string };
        if (parsed.name === 'promptsonar') return current;
      } catch {
        return current;
      }
    }
    current = path.dirname(current);
  }
  return start;
}

function readFixtureFiles(repoRoot: string, relativeDirs: string[], extensions: string[]): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile() && extensions.includes(path.extname(entry.name))) files.push(fullPath);
    }
  };
  for (const relativeDir of relativeDirs) visit(path.join(repoRoot, relativeDir));
  return files.sort();
}

function formatNode(type: string): string {
  return workflowLabel[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function riskTone(risk: string): string {
  if (risk === 'critical') return 'red';
  if (risk === 'high' || risk === 'medium') return 'amber';
  if (risk === 'ready' || risk === 'pass') return 'emerald';
  return 'slate';
}

function fileTime(filePath: string): string {
  const modified = fs.statSync(filePath).mtime;
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(modified);
}

function includesAny(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function buildIntelligence() {
  const repoRoot = findRepoRoot(process.cwd());
  const promptFiles = readFixtureFiles(repoRoot, [
    'packages/core/test/fixtures/workflows',
    'tests/validation/security/should_flag'
  ], ['.prompt', '.ts', '.js', '.py', '.go', '.java', '.rs']);
  const mcpFiles = readFixtureFiles(repoRoot, [
    'packages/core/test/fixtures/workflows',
    'tests/fixtures/mcp',
    'benchmarks/mcp/fixtures'
  ], ['.json']);

  const findings: AnalyzedFinding[] = promptFiles.flatMap((filePath) => {
    const text = fs.readFileSync(filePath, 'utf8');
    return evaluatePrompt({ text, context: { filePath } }).findings.map((finding) => ({ ...finding, sourceFile: filePath }));
  });

  const mcpFindings: AnalyzedMcpFinding[] = mcpFiles.flatMap((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return auditMcpConfig(filePath, content).findings.map((finding) => ({ ...finding, sourceFile: filePath }));
  });

  const workflowFindings = findings.filter((finding) => finding.workflow?.path?.nodes?.length);
  const workflows = workflowFindings.map((finding) => finding.workflow!).filter(Boolean);
  const securityFindings = findings.filter((finding) => finding.category === 'security');
  const allRuleFindings = [...securityFindings, ...mcpFindings.map((finding) => ({
    rule_id: finding.rule_id,
    severity: finding.severity as Severity,
    explanation: finding.message,
    sourceFile: finding.sourceFile
  }))];

  const confidenceScores = workflows
    .map((workflow) => workflow.confidence_score ?? workflow.path.confidence_score ?? 0)
    .filter((score) => score > 0);
  const confidenceAverage = average(confidenceScores);
  const highConfidence = confidenceScores.filter((score) => score >= 80).length;
  const mediumConfidence = confidenceScores.filter((score) => score >= 50 && score < 80).length;
  const lowConfidence = confidenceScores.filter((score) => score > 0 && score < 50).length;

  const trustBoundaryCrossed = workflows.filter((workflow) => workflow.path.trustBoundaryCrossed).length;
  const privilegedSinksReached = workflows.filter((workflow) => workflow.path.privilegedSinkReached).length;
  const executionPathsDetected = workflows.length;

  const executionPathMap = new Map<string, {
    path: string[];
    observed: number;
    confidence: number[];
    risk: Risk;
  }>();
  for (const workflow of workflows) {
    const pathTypes = workflow.path.nodes.map((node) => node.type);
    const key = pathTypes.join('>');
    const existing = executionPathMap.get(key) || { path: pathTypes, observed: 0, confidence: [], risk: 'none' as Risk };
    existing.observed += 1;
    existing.confidence.push(workflow.confidence_score ?? workflow.path.confidence_score ?? 0);
    if (riskRank[workflow.risk as Risk] > riskRank[existing.risk]) existing.risk = workflow.risk as Risk;
    executionPathMap.set(key, existing);
  }

  const topExecutionPaths = Array.from(executionPathMap.values())
    .map((entry) => ({ ...entry, confidenceAverage: average(entry.confidence) }))
    .sort((a, b) => riskRank[b.risk] - riskRank[a.risk] || b.observed - a.observed || b.confidenceAverage - a.confidenceAverage)
    .slice(0, 3);

  const boundaryMap = new Map<string, { from: string; to: string; frequency: number; confidence: number[]; risk: Risk }>();
  for (const workflow of workflows) {
    for (const edge of workflow.path.edges) {
      const from = workflow.path.nodes.find((node) => node.id === edge.from)?.type || edge.from || 'unknown';
      const to = workflow.path.nodes.find((node) => node.id === edge.to)?.type || edge.to || 'unknown';
      const crossesBoundary = edge.type === 'trust_boundary' || edge.risk === 'high' || edge.risk === 'critical';
      if (!crossesBoundary) continue;
      const key = `${from}>${to}`;
      const existing = boundaryMap.get(key) || { from, to, frequency: 0, confidence: [], risk: 'none' as Risk };
      existing.frequency += 1;
      existing.confidence.push(workflow.confidence_score ?? workflow.path.confidence_score ?? 0);
      if (riskRank[edge.risk as Risk] > riskRank[existing.risk]) existing.risk = edge.risk as Risk;
      boundaryMap.set(key, existing);
    }
  }

  const trustBoundaries = Array.from(boundaryMap.values())
    .map((entry) => ({ ...entry, confidenceAverage: average(entry.confidence) }))
    .sort((a, b) => riskRank[b.risk] - riskRank[a.risk] || b.frequency - a.frequency || b.confidenceAverage - a.confidenceAverage)
    .slice(0, 5);

  const mcpRegistry = Object.values(mcpFindings.reduce<Record<string, { ruleId: string; observed: number; severity: Severity }>>((acc, finding) => {
    const existing = acc[finding.rule_id] || { ruleId: finding.rule_id, observed: 0, severity: finding.severity as Severity };
    existing.observed += 1;
    if (severityRank[finding.severity as Severity] > severityRank[existing.severity]) existing.severity = finding.severity as Severity;
    acc[finding.rule_id] = existing;
    return acc;
  }, {}))
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.observed - a.observed || a.ruleId.localeCompare(b.ruleId))
    .slice(0, 3);

  const rootCauseGroups = [
    {
      rootCause: 'MCP Tool Poisoning',
      supporting: ['Workflow Escalation', 'Privileged Sink Access', 'Approval Bypass'],
      findings: allRuleFindings.filter((finding) => includesAny(finding.rule_id, ['mcp', 'workflow_escalation', 'privileged_sink']))
    },
    {
      rootCause: 'Prompt Injection',
      supporting: ['Role Override', 'Policy Rewrite', 'Instruction Laundering'],
      findings: allRuleFindings.filter((finding) => includesAny(finding.rule_id, ['llm01', 'injection', 'override', 'evasion', 'unbounded_persona']))
    },
    {
      rootCause: 'Sensitive Context Propagation',
      supporting: ['Credential Leak', 'Secret Exposure', 'PII Passthrough'],
      findings: allRuleFindings.filter((finding) => includesAny(finding.rule_id, ['llm02', 'pii', 'credential', 'secret']))
    }
  ]
    .map((group) => {
      const groupWorkflowScores = workflowFindings
        .filter((finding) => group.findings.some((candidate) => candidate.rule_id === finding.rule_id && candidate.sourceFile === finding.sourceFile))
        .map((finding) => finding.workflow?.confidence_score ?? finding.workflow?.path.confidence_score ?? 0)
        .filter((score) => score > 0);
      return {
        ...group,
        affectedPaths: group.findings.length,
        averageConfidence: average(groupWorkflowScores.length ? groupWorkflowScores : confidenceScores)
      };
    })
    .filter((group) => group.affectedPaths > 0)
    .sort((a, b) => b.affectedPaths - a.affectedPaths)
    .slice(0, 2);

  const overrideAttempts = securityFindings.filter((finding) => includesAny(`${finding.rule_id} ${finding.explanation}`, ['ignore', 'override', 'prior instruction', 'previous instruction', 'jailbreak', 'llm01'])).length;
  const roleRewritePatterns = securityFindings.filter((finding) => includesAny(`${finding.rule_id} ${finding.explanation}`, ['role', 'persona', 'developer mode', 'dan'])).length;
  const launderingChains = workflows.filter((workflow) => workflow.path.nodes.some((node) => node.type === 'policy_override') && workflow.path.nodes.some((node) => node.type === 'tool_router' || node.type === 'mcp_server')).length;
  const credentialLeaks = securityFindings.filter((finding) => includesAny(finding.rule_id, ['pii', 'llm02']) || includesAny(finding.explanation, ['credential', 'secret', 'token', 'password'])).length;
  const apiKeyExposure = securityFindings.filter((finding) => includesAny(finding.explanation, ['api key', 'openai', 'anthropic', 'sk-'])).length;
  const sensitiveContext = securityFindings.filter((finding) => includesAny(finding.explanation, ['context', 'pii', 'ssn', 'credit card', 'secret'])).length;
  const ragBoundaryCrossings = workflows.filter((workflow) => workflow.path.nodes.some((node) => node.type === 'retrieved_context' || node.type === 'rag_context') && workflow.path.trustBoundaryCrossed).length;
  const unvalidatedQueryPatterns = securityFindings.filter((finding) => finding.rule_id === 'sec_rag_injection').length;
  const contextPoisoningRoutes = workflows.filter((workflow) => workflow.path.nodes.some((node) => node.type === 'retrieved_context' || node.type === 'rag_context') && workflow.path.nodes.some((node) => node.type === 'policy_override' || node.type === 'tool_router')).length;

  const timeline = [
    ...workflowFindings.slice(0, 3).map((finding) => ({
      time: fileTime(finding.sourceFile),
      event: finding.rule_id === 'sec_workflow_escalation' ? 'Workflow Escalation Detected' : finding.rule_id.includes('injection') ? 'Prompt Injection Detected' : 'Privileged Execution Path Detected',
      detail: finding.workflow?.path.privilegedSinkReached ? 'Sink: privileged execution' : `Rule: ${finding.rule_id}`,
      confidence: finding.workflow?.confidence_score ?? finding.workflow?.path.confidence_score ?? 0
    })),
    ...mcpFindings.slice(0, 2).map((finding) => ({
      time: fileTime(finding.sourceFile),
      event: finding.rule_id === 'MCP-109' ? 'Approval Bypass Detected' : finding.rule_id === 'MCP-108' ? 'MCP Privilege Escalation Detected' : 'MCP Risk Detected',
      detail: `Rule: ${finding.rule_id}`,
      confidence: finding.confidence_contribution || 0
    }))
  ].slice(0, 4);

  return {
    signals: [
      {
        label: 'Injection Pressure',
        value: overrideAttempts > 0 ? 'Critical' : 'Ready',
        tone: overrideAttempts > 0 ? 'red' : 'emerald',
        lines: [`Observed: ${overrideAttempts} override attempts`, `${roleRewritePatterns} role rewrite patterns`, `${launderingChains} instruction laundering chains`, 'Most Common: sec_owasp_llm01_injection']
      },
      {
        label: 'Data Exposure',
        value: credentialLeaks > 0 ? 'High' : 'Ready',
        tone: credentialLeaks > 0 ? 'amber' : 'emerald',
        lines: [`Detected: ${credentialLeaks} credential/PII leaks`, `${apiKeyExposure} API key exposures`, `${sensitiveContext} sensitive context references`, 'Highest Risk: credential or PII propagation']
      },
      {
        label: 'RAG Trust Boundary',
        value: ragBoundaryCrossings > 0 ? 'High' : 'Ready',
        tone: ragBoundaryCrossings > 0 ? 'amber' : 'emerald',
        lines: [`Detected: ${ragBoundaryCrossings} retrieval boundary crossings`, `${unvalidatedQueryPatterns} unvalidated_query patterns`, `${contextPoisoningRoutes} context poisoning routes`]
      },
      {
        label: 'Governance Evidence',
        value: 'Ready',
        tone: 'emerald',
        lines: ['Artifacts: SARIF', 'Public Report', 'Workflow Diff', 'Root Cause Ledger']
      }
    ],
    attackSurface: {
      trustBoundaryCrossed,
      privilegedSinksReached,
      executionPathsDetected,
      confidenceAverage
    },
    topExecutionPaths,
    timeline,
    rootCauseGroups,
    confidenceDistribution: {
      high: percent(highConfidence, confidenceScores.length),
      medium: percent(mediumConfidence, confidenceScores.length),
      low: percent(lowConfidence, confidenceScores.length)
    },
    trustBoundaries,
    mcpRegistry,
    replayReadiness: {
      paths: workflows.filter((workflow) => workflow.workflow_replay?.events?.length).length,
      evidence: percent(workflows.filter((workflow) => (workflow.workflow_evidence?.length || workflow.path.workflow_evidence?.length || 0) > 0).length, workflows.length),
      confidence: percent(confidenceScores.length, workflows.length)
    }
  };
}

export default function IntelligencePage() {
  const intelligence = buildIntelligence();

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#1C1917]">
      <main className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">PromptSonar Intelligence</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Threat Intelligence Console</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
              A focused view of prompt security signals, attack paths, governance evidence, and model drift coming from the playground scanner.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/playground" className="rounded-full border border-[#E4E3DE] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Back to Playground
            </Link>
            <Link href="/risk-registry" className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
              Open Risk Registry
            </Link>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-4">
          {intelligence.signals.map((signal) => (
            <article key={signal.label} className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-[#A8A29E]">{signal.label}</p>
              <div className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${toneClasses[signal.tone]}`}>
                {signal.value}
              </div>
              <div className="mt-4 space-y-1 text-sm leading-6 text-[#57534E]">
                {signal.lines.map((line) => <p key={line}>{line}</p>)}
              </div>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <article className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E4E3DE] pb-4">
              <div>
                <h2 className="text-xl font-black">Attack Surface Map</h2>
                <p className="mt-1 text-sm text-[#78716C]">How untrusted input can move through retrieval, tools, and model output.</p>
              </div>
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-red-700">
                {intelligence.attackSurface.executionPathsDetected} paths
              </span>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ['Inputs', 'User Input', 'Retrieved Context'],
                ['Processing', 'Model', 'Memory', 'MCP Server', 'Tool Router'],
                ['Outputs', 'Response', 'Filesystem', 'Network', 'Shell']
              ].map(([stage, ...items]) => (
                <div key={stage} className="rounded-2xl border border-[#E4E3DE] bg-[#FAF9F6] p-5">
                  <p className="text-xs font-black uppercase tracking-widest text-[#A8A29E]">{stage}</p>
                  <div className="mt-4 space-y-2">
                    {items.map((item, index) => (
                      <div key={item} className={`rounded-lg border px-3 py-2 text-sm font-bold ${index === 0 ? 'border-red-100 bg-red-50 text-red-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              {[
                ['Trust Boundaries Crossed', intelligence.attackSurface.trustBoundaryCrossed],
                ['Privileged Sinks Reached', intelligence.attackSurface.privilegedSinksReached],
                ['Execution Paths Detected', intelligence.attackSurface.executionPathsDetected],
                ['Confidence Average', `${intelligence.attackSurface.confidenceAverage}%`]
              ].map(([label, value]) => (
                <div key={label} className="border-t border-[#E4E3DE] pt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">{label}</p>
                  <p className="mt-1 text-lg font-black">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-[#E4E3DE] pt-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#A8A29E]">Top Execution Paths</h3>
              <div className="mt-4 space-y-4">
                {intelligence.topExecutionPaths.map((entry) => (
                  <div key={entry.path.join('>')} className="border-b border-[#F1F0EC] pb-4 last:border-0">
                    <p className="font-mono text-sm font-black text-slate-900">{entry.path.map(formatNode).join(' -> ')}</p>
                    <div className="mt-2 grid gap-2 text-xs font-bold text-[#57534E] md:grid-cols-3">
                      <span>Observed: {entry.observed}</span>
                      <span>Confidence: {entry.confidenceAverage}%</span>
                      <span className={`uppercase ${riskTone(entry.risk) === 'red' ? 'text-red-700' : 'text-amber-700'}`}>Risk: {entry.risk}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 border-t border-[#E4E3DE] pt-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#A8A29E]">Root Cause Ledger</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {intelligence.rootCauseGroups.map((group) => (
                  <div key={group.rootCause}>
                    <p className="text-sm font-black">{group.rootCause}</p>
                    <p className="mt-2 text-xs font-bold text-[#78716C]">Supporting Findings: {group.supporting.join(', ')}</p>
                    <p className="mt-2 text-xs text-[#57534E]">Affected Paths: {group.affectedPaths}</p>
                    <p className="text-xs text-[#57534E]">Average Confidence: {group.averageConfidence}%</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 grid gap-6 border-t border-[#E4E3DE] pt-6 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-[#A8A29E]">Confidence Distribution</h3>
                <div className="mt-3 space-y-2 text-sm font-bold text-[#57534E]">
                  <p>High Confidence: {intelligence.confidenceDistribution.high}%</p>
                  <p>Medium Confidence: {intelligence.confidenceDistribution.medium}%</p>
                  <p>Low Confidence: {intelligence.confidenceDistribution.low}%</p>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-[#A8A29E]">Workflow Replay Ready</h3>
                <div className="mt-3 space-y-2 text-sm font-bold text-[#57534E]">
                  <p>Replay-capable paths: {intelligence.replayReadiness.paths}</p>
                  <p>Evidence captured: {intelligence.replayReadiness.evidence}%</p>
                  <p>Confidence available: {intelligence.replayReadiness.confidence}%</p>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-[#E4E3DE] pt-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#A8A29E]">Trust Boundary Observatory</h3>
              <div className="mt-4 space-y-3">
                {intelligence.trustBoundaries.map((boundary) => (
                  <div key={`${boundary.from}-${boundary.to}`} className="grid gap-2 text-sm md:grid-cols-[1fr_80px_80px_80px]">
                    <p className="font-mono font-bold">{formatNode(boundary.from)} {'->'} {formatNode(boundary.to)}</p>
                    <p className="text-[#57534E]">Freq: {boundary.frequency}</p>
                    <p className="text-[#57534E]">Risk: {boundary.risk}</p>
                    <p className="text-[#57534E]">Conf: {boundary.confidenceAverage}%</p>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">Security Timeline</h2>
            <div className="mt-6 space-y-4">
              {intelligence.timeline.map((item) => (
                <div key={`${item.time}-${item.event}-${item.detail}`} className="grid grid-cols-[54px_1fr] gap-4 border-b border-[#F1F0EC] pb-4 last:border-0">
                  <span className="font-mono text-xs font-bold text-[#A8A29E]">{item.time}</span>
                  <div>
                    <p className="text-sm font-black">{item.event}</p>
                    <p className="mt-1 text-xs text-[#78716C]">Confidence: {item.confidence}%</p>
                    <p className="mt-1 font-mono text-xs text-[#78716C]">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-[#E4E3DE] pt-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#A8A29E]">Top MCP Risks</h3>
              <div className="mt-4 space-y-4">
                {intelligence.mcpRegistry.map((risk) => (
                  <div key={risk.ruleId} className="border-b border-[#F1F0EC] pb-4 last:border-0">
                    <p className="font-mono text-sm font-black">{risk.ruleId}</p>
                    <p className="mt-1 text-xs font-bold text-[#57534E]">Observed: {risk.observed}</p>
                    <p className="mt-1 text-xs font-bold uppercase text-red-700">Severity: {risk.severity}</p>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
