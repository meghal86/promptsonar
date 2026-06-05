import type { RepositoryExecutionReport, RepositoryRisk } from './types';

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sarifLevel(risk: RepositoryRisk): 'error' | 'warning' | 'note' {
    if (risk === 'critical' || risk === 'high') return 'error';
    if (risk === 'medium') return 'warning';
    return 'note';
}

export function formatRepositoryReportJson(report: RepositoryExecutionReport): string {
    return JSON.stringify(report, null, 2);
}

export function formatRepositoryReportSarif(report: RepositoryExecutionReport): string {
    const rules = new Map<string, any>();
    const results = report.reachablePaths.map(pathItem => {
        const ruleId = `PROMPTSONAR-REPO-${pathItem.risk.toUpperCase()}`;
        rules.set(ruleId, {
            id: ruleId,
            shortDescription: { text: `Repository reachable ${pathItem.risk} execution path` },
            fullDescription: { text: 'Repository-level AI execution path analysis connects scanner findings and AI artifacts into reachable paths.' },
            help: { text: 'Review the connected artifacts and remove unnecessary tool, MCP, filesystem, network, shell, or secret reachability.' },
            properties: {
                category: 'repository-execution',
                precision: pathItem.confidence >= 85 ? 'high' : pathItem.confidence >= 70 ? 'medium' : 'low',
            },
        });
        const firstEvidence = pathItem.evidence[0];
        return {
            ruleId,
            level: sarifLevel(pathItem.risk),
            message: {
                text: `${pathItem.explanation} Sensitive actions: ${pathItem.sensitiveActions.join(', ') || 'none'}.`,
            },
            properties: {
                repository_risk: pathItem.risk,
                confidence: pathItem.confidence,
                confidence_level: pathItem.confidenceLevel,
                sensitive_actions: pathItem.sensitiveActions,
                files: pathItem.files,
                node_ids: pathItem.nodeIds,
                edge_ids: pathItem.edgeIds,
                evidence: pathItem.evidence,
                findings: pathItem.findings,
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: { uri: firstEvidence?.filePath || pathItem.files[0] || report.repository.root },
                    region: {
                        startLine: Math.max(1, firstEvidence?.line || 1),
                        startColumn: 1,
                        snippet: firstEvidence?.snippet ? { text: firstEvidence.snippet } : undefined,
                    },
                },
            }],
        };
    });

    return JSON.stringify({
        version: '2.1.0',
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        runs: [{
            tool: {
                driver: {
                    name: 'PromptSonar Repository Execution Analysis',
                    version: report.version,
                    informationUri: 'https://github.com/meghal86/promptsonar',
                    rules: Array.from(rules.values()),
                },
            },
            results,
            properties: {
                repository_summary: report.summary,
                execution_nodes: report.executionMap.nodes.length,
                execution_edges: report.executionMap.edges.length,
                trust_status: report.summary.trustStatus,
            },
        }],
    }, null, 2);
}

export function formatRepositoryReportHtml(report: RepositoryExecutionReport): string {
    const summary = report.summary;
    const topPaths = report.reachablePaths.slice(0, 10);
    const highestPath = report.reachablePaths[0];
    const fileName = (file: string) => file.split(/[\\/]/).filter(Boolean).pop() || file;
    const fileType = (file: string): string => {
        const lower = file.toLowerCase();
        if (lower.includes('mcp') || lower.includes('/.cursor/') || lower.includes('/.claude/')) return 'MCP';
        if (lower.endsWith('skill.md') || lower.includes('/skills/')) return 'Skills';
        if (lower.includes('workflow') || lower.includes('/.github/workflows/')) return 'Workflows';
        if (lower.includes('memory')) return 'Memory';
        if (lower.includes('prompt') || lower.endsWith('.prompt') || lower.endsWith('.md')) return 'Prompts';
        return 'Other';
    };
    const groupedFiles = (files: string[]) => Array.from(files.reduce((groups, file) => {
        const type = fileType(file);
        const existing = groups.get(type) || [];
        existing.push(file);
        groups.set(type, existing);
        return groups;
    }, new Map<string, string[]>()).entries());
    const topContributors = (files: string[]) => Array.from(new Set(files.map(fileName))).slice(0, 4);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PromptSonar Repository Execution Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #17202a; background: #f7f9fb; }
    header { background: #101820; color: white; padding: 28px 32px; }
    main { max-width: 1100px; margin: 0 auto; padding: 28px 20px 48px; }
    h1, h2 { margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 18px 0 28px; }
    .card, section { background: white; border: 1px solid #d9e1ea; border-radius: 8px; padding: 16px; }
    .metric { font-size: 28px; font-weight: 700; }
    .label { color: #596776; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { border-bottom: 1px solid #e6ebf1; padding: 10px; text-align: left; vertical-align: top; }
    th { color: #34495e; font-size: 13px; }
    .risk-critical { color: #b42318; font-weight: 700; }
    .risk-high { color: #c2410c; font-weight: 700; }
    .risk-medium { color: #a16207; font-weight: 700; }
    .risk-low { color: #0369a1; font-weight: 700; }
    code { background: #eef2f6; padding: 2px 4px; border-radius: 4px; }
    .path-chain { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
    .node { background: #f1f5f9; border: 1px solid #dbe3ea; border-radius: 6px; padding: 6px 8px; font-weight: 700; font-size: 13px; }
    .arrow { color: #64748b; }
    details { margin-top: 8px; }
    summary { cursor: pointer; font-weight: 700; color: #334155; }
  </style>
</head>
<body>
  <header>
    <h1>Repository Execution Report</h1>
    <div>${escapeHtml(report.repository.name)} · ${escapeHtml(report.generated_at)} · Trust Status: ${escapeHtml(summary.trustStatus)}</div>
  </header>
  <main>
    <div class="grid">
      <div class="card"><div class="metric">${summary.aiSurfacesFound.prompts + summary.aiSurfacesFound.skills + summary.aiSurfacesFound.mcpServers + summary.aiSurfacesFound.tools + summary.aiSurfacesFound.workflows + summary.aiSurfacesFound.memorySystems}</div><div class="label">AI Surfaces</div></div>
      <div class="card"><div class="metric">${summary.executionGraph.nodes}</div><div class="label">Execution Nodes</div></div>
      <div class="card"><div class="metric">${summary.executionGraph.edges}</div><div class="label">Execution Edges</div></div>
      <div class="card"><div class="metric">${report.reachablePaths.length}</div><div class="label">Reachable Paths</div></div>
    </div>
    <section>
      <h2>Reachable Execution Paths</h2>
      <div class="metric">${report.reachablePaths.length}</div>
      <div class="label">${summary.confidenceSummary.confirmed} Confirmed · ${summary.confidenceSummary.probable} Probable · ${summary.confidenceSummary.potential} Potential</div>
    </section>
    ${highestPath ? `<section style="margin-top:18px">
      <h2>Highest Risk Path</h2>
      <div class="path-chain">
        ${highestPath.nodeIds.slice(0, 6).map((nodeId, index) => {
            const node = report.executionMap.nodes.find(item => item.id === nodeId);
            return `${index > 0 ? '<span class="arrow">↓</span>' : ''}<span class="node">${escapeHtml(node?.label || nodeId)}</span>`;
        }).join('')}
      </div>
      <p><strong>Risk:</strong> ${escapeHtml(highestPath.explanation)}</p>
      <p><strong>Confidence:</strong> ${escapeHtml(highestPath.confidenceLevel)} (${highestPath.confidence}%)</p>
      <p><strong>Files:</strong> ${highestPath.files.length}</p>
      <p><a href="#path-${escapeHtml(highestPath.id)}">Analyze in Playground →</a></p>
    </section>` : ''}
    <section>
      <h2>AI Surfaces</h2>
      <table>
        <tr><th>Prompts</th><th>Skills</th><th>MCP Servers</th><th>Tools</th><th>Workflows</th><th>Memory Systems</th></tr>
        <tr><td>${summary.aiSurfacesFound.prompts}</td><td>${summary.aiSurfacesFound.skills}</td><td>${summary.aiSurfacesFound.mcpServers}</td><td>${summary.aiSurfacesFound.tools}</td><td>${summary.aiSurfacesFound.workflows}</td><td>${summary.aiSurfacesFound.memorySystems}</td></tr>
      </table>
    </section>
    <section style="margin-top:18px">
      <h2>Most Critical Paths</h2>
      <table>
        <tr><th>Risk</th><th>Actions</th><th>Explanation</th><th>Files</th><th>Confidence</th></tr>
        ${topPaths.map(pathItem => `<tr id="path-${escapeHtml(pathItem.id)}"><td class="risk-${pathItem.risk}">${escapeHtml(pathItem.risk.toUpperCase())}</td><td>${escapeHtml(pathItem.sensitiveActions.join(', '))}</td><td>${escapeHtml(pathItem.explanation)}</td><td>${pathItem.files.length} files involved<br><strong>Top Contributors</strong><br>${topContributors(pathItem.files).map(file => `<code>${escapeHtml(file)}</code>`).join('<br>')}<details><summary>Show file list</summary>${groupedFiles(pathItem.files).map(([type, files]) => `<p><strong>${escapeHtml(type)}</strong><br>${files.slice(0, 30).map(file => `<code>${escapeHtml(file)}</code>`).join('<br>')}</p>`).join('')}</details></td><td>${escapeHtml(pathItem.confidenceLevel)}<br>${pathItem.confidence}%</td></tr>`).join('')}
      </table>
    </section>
  </main>
</body>
</html>`;
}
