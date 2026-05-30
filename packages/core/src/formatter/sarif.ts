import { Finding } from '../rules/types';
import { FindingWorkflow, workflowPathSummary, analyzeRootCause } from '../workflow';

// Deterministic rule_id -> human-readable threat name, used for SARIF
// root_cause / supporting_findings provenance metadata. Exported so the CLI
// renders the same threat names in human-readable output (single source of truth).
export function humanRuleName(ruleId: string): string {
    const MAP: Record<string, string> = {
        sec_owasp_llm01_injection: 'Prompt Injection',
        sec_owasp_llm02_pii: 'Credential Leak',
        sec_mcp_tool_poisoning: 'MCP Tool Poisoning',
        sec_workflow_escalation: 'Workflow Escalation',
        sec_privileged_sink_access: 'Privileged Sink Access',
        sec_unbounded_persona: 'Unbounded Persona',
        sec_unbounded_access: 'Unbounded Tool Access',
        sec_rag_injection: 'RAG Injection',
    };
    if (MAP[ruleId]) return MAP[ruleId];
    return ruleId.replace(/^sec_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type SarifFinding = Finding & {
    filePath?: string;
    line?: number;
    column?: number;
    evidence?: string;
    recommendation?: string;
    owasp?: string;
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    docs_url?: string;
    workflow?: FindingWorkflow;
};

function getOwaspMapping(ruleId: string): string | undefined {
    if (
        ruleId.startsWith('sec_owasp_llm01') ||
        ruleId.startsWith('sec_unicode') ||
        ruleId === 'sec_unbounded_persona' ||
        ruleId === 'sec_base64_encoded_payload' ||
        ruleId === 'sec_homoglyph_evasion' ||
        ruleId === 'sec_zero_width_injection'
    ) {
        return 'OWASP LLM01';
    }
    if (ruleId.startsWith('sec_owasp_llm02')) {
        return 'OWASP LLM02';
    }
    if (ruleId === 'sec_unbounded_access' || ruleId === 'sec_rag_injection') {
        return 'OWASP LLM07';
    }
    return undefined;
}

function getRuleHelpUri(ruleId: string): string {
    return `https://github.com/meghal86/promptsonar/blob/main/docs/rules.md#${ruleId.toLowerCase()}`;
}

function getSeverityLevel(severity: string): 'error' | 'warning' | 'note' {
    if (severity === 'critical' || severity === 'high') return 'error';
    if (severity === 'medium') return 'warning';
    return 'note';
}

function getSecuritySeverity(severity: string): string {
    if (severity === 'critical') return '9.0';
    if (severity === 'high') return '7.0';
    if (severity === 'medium') return '5.0';
    return '2.0';
}

function fingerprint(finding: SarifFinding, fallbackFilePath: string): string {
    return [
        finding.rule_id,
        finding.filePath || fallbackFilePath,
        finding.line || 1,
        finding.column || 1,
        finding.evidence || finding.explanation,
    ].join('|');
}

export function formatToSarif(findings: SarifFinding[], filePath: string): string {
    const sarifOutput = {
        version: "2.1.0",
        $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        runs: [
            {
                tool: {
                    driver: {
                        name: "PromptSonar",
                        version: "1.4.0",
                        informationUri: "https://github.com/meghal86/promptsonar",
                        rules: [] as any[]
                    }
                },
                results: [] as any[]
            }
        ]
    };

    const rulesSet = new Set<string>();

    // Scan-wide root-cause grouping (Feature 3/5). Computed once; attached to
    // every result's property bag so any SARIF consumer can read it.
    const rootCauseAnalysis = analyzeRootCause(findings);
    const rootCauseName = rootCauseAnalysis ? humanRuleName(rootCauseAnalysis.rootCause.rule_id) : undefined;
    const supportingFindingNames = rootCauseAnalysis
        ? rootCauseAnalysis.supportingFindings.map(sf => humanRuleName(sf.rule_id))
        : [];

    findings.forEach(f => {
        // Map rules to the driver
        if (!rulesSet.has(f.rule_id)) {
            rulesSet.add(f.rule_id);
            sarifOutput.runs[0].tool.driver.rules.push({
                id: f.rule_id,
                shortDescription: {
                    text: `${f.rule_id} (${f.category.replace('_', ' ')})`
                },
                fullDescription: {
                    text: f.explanation
                },
                help: {
                    text: f.recommendation || f.suggested_fix || "Review prompt and apply best practices.",
                    markdown: [
                        `**Risk:** ${f.explanation}`,
                        '',
                        `**Recommended fix:** ${f.recommendation || f.suggested_fix || 'Review prompt and apply best practices.'}`,
                    ].join('\n')
                },
                helpUri: f.docs_url || getRuleHelpUri(f.rule_id),
                defaultConfiguration: {
                    level: getSeverityLevel(f.severity),
                },
                properties: {
                    category: f.category,
                    severity: f.severity,
                    securitySeverity: getSecuritySeverity(f.severity),
                    owasp: f.owasp || getOwaspMapping(f.rule_id),
                    confidence: f.confidence || "HIGH",
                    precision: (f.confidence || "HIGH").toLowerCase().replace('_', '-')
                }
            });
        }

        // Map findings to results
        const findingFile = f.filePath || filePath;
        const recommendation = f.recommendation || f.suggested_fix || "Review prompt and apply best practices.";

        sarifOutput.runs[0].results.push({
            ruleId: f.rule_id,
            level: getSeverityLevel(f.severity),
            message: {
                text: `${f.explanation} Recommendation: ${recommendation}`
            },
            properties: {
                owasp: f.owasp || getOwaspMapping(f.rule_id),
                confidence: f.confidence || "HIGH",
                recommendation,
                evidence: f.evidence,
                // Feature 5: deterministic provenance metadata (backward compatible —
                // existing consumers ignore unknown property-bag keys).
                confidence_score: f.workflow?.confidence_score,
                confidence_level: f.workflow?.confidence_level,
                workflow_evidence: f.workflow?.evidence,
                root_cause: rootCauseName,
                supporting_findings: supportingFindingNames,
                workflow: f.workflow ? {
                    source: f.workflow.source,
                    sink: f.workflow.sink,
                    trustBoundaryCrossed: f.workflow.path.trustBoundaryCrossed,
                    privilegedSinkReached: f.workflow.path.privilegedSinkReached,
                    pathSummary: workflowPathSummary(f.workflow),
                    risk: f.workflow.risk,
                    confidence: f.workflow.confidence,
                    nodes: f.workflow.path.nodes.map(node => ({
                        id: node.id,
                        label: node.label,
                        type: node.type,
                        trust: node.trust,
                        confidence: node.confidence,
                        reason: node.reason,
                        evidence: node.evidence,
                        inferredBy: node.inferredBy,
                        tainted: node.tainted,
                        privilegePropagated: node.privilegePropagated,
                    })),
                    edges: f.workflow.path.edges.map(edge => ({
                        from: edge.from,
                        to: edge.to,
                        type: edge.type,
                        risk: edge.risk,
                        reason: edge.reason,
                        confidence: edge.confidence,
                        tainted: edge.tainted,
                        privilegePropagated: edge.privilegePropagated,
                    })),
                    explanation: f.workflow.path.explanation,
                    riskStory: f.workflow.path.riskStory,
                    severityReason: f.workflow.path.severityReason,
                } : undefined,
                // Workflow Diff Engine: remediation before/after metadata
                // (backward compatible — undefined unless a privileged sink path exists).
                workflow_diff: f.workflow?.workflow_diff ? {
                    workflow_diff_version: f.workflow.workflow_diff.workflowDiffVersion,
                    diff_reason: f.workflow.workflow_diff.diffReason,
                    risk_reduction: f.workflow.workflow_diff.riskReduction,
                    before_risk: f.workflow.workflow_diff.beforeRisk,
                    after_risk: f.workflow.workflow_diff.afterRisk,
                    execution_path_removed: f.workflow.workflow_diff.executionPathRemoved,
                    removed_nodes: f.workflow.workflow_diff.removedNodes,
                    removed_edges: f.workflow.workflow_diff.removedEdges,
                    added_nodes: f.workflow.workflow_diff.addedNodes,
                    added_edges: f.workflow.workflow_diff.addedEdges,
                    before_path: f.workflow.workflow_diff.before.nodes.map(node => node.type),
                    after_path: f.workflow.workflow_diff.after.nodes.map(node => node.type),
                    removed_privileged_sinks: f.workflow.workflow_diff.comparison.privilegedSinks.removed,
                    trust_boundary_removed: f.workflow.workflow_diff.comparison.trustBoundaries.removed,
                } : undefined,
            },
            partialFingerprints: {
                promptsonarFinding: fingerprint(f, filePath),
            },
            locations: [
                {
                    physicalLocation: {
                        artifactLocation: {
                            uri: findingFile,
                            uriBaseId: "%SRCROOT%"
                        },
                        region: {
                            startLine: Math.max(1, f.line || 1),
                            startColumn: Math.max(1, f.column || 1),
                            snippet: f.evidence ? { text: f.evidence } : undefined,
                        }
                    }
                }
            ]
        });
    });

    return JSON.stringify(sarifOutput, null, 2);
}
