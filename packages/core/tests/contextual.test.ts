import { describe, expect, it } from 'vitest';
import {
    CAPABILITY_PRIVILEGES,
    CONTEXT_AVAILABILITIES,
    CONTROL_STATES,
    EXPOSURES,
    INTENTS,
    REACHABILITIES,
    analyzeRepositoryExecutionFromFiles,
    assertFindingInvariants,
    classifySecretSemantics,
    contextualVerdictToSarifLevel,
    evaluateContextualVerdict,
    fallbackVerdictInputForMcpFinding,
    fallbackVerdictInputForRawFinding,
    formatRepositoryReportSarif,
    inferCapabilityIntent,
    isAcceptedVulnerabilityBasis,
    secretAssessmentToVerdictInput,
    validateContextualFindingPresentation,
    validateFindingInvariants,
    validateSarifLogShape,
    type CanonicalAnalysisIssue,
    type CanonicalIssueContext,
    type ControlStatus,
    type RepositoryExecutionReport,
    type VerdictDecision,
    type VerdictInput,
    type VulnerabilityBasis,
} from '../src';

const directBasis: Extract<VulnerabilityBasis, { kind: 'direct_evidence' }> = {
    kind: 'direct_evidence',
    directEvidenceClass: 'hardcoded_secret',
    evidenceIds: ['ev-secret'],
};

const sourceToSinkBasis: Extract<VulnerabilityBasis, { kind: 'source_to_sink' }> = {
    kind: 'source_to_sink',
    pathIds: ['path-1'],
    untrustedSourceEvidenceIds: ['ev-source'],
    privilegedSinkEvidenceIds: ['ev-sink'],
    controlFailureEvidenceIds: ['ev-control'],
};

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
    return {
        capabilityPrivilege: 'privileged',
        exposure: 'trusted',
        reachability: 'verified',
        controlState: 'effective',
        contextAvailability: 'complete',
        intent: 'expected',
        directVulnerability: { present: false },
        ...overrides,
    };
}

function context(controlStatus: ControlStatus): CanonicalIssueContext {
    return {
        artifactKind: 'skill',
        capability: 'shell',
        trustAssessment: {
            sources: ['developer_instruction'],
            confidence: 'confirmed',
            evidenceIds: ['ev-trust'],
        },
        intentAssessment: {
            expected: true,
            source: 'config',
            confidence: 'confirmed',
            evidenceIds: ['ev-intent'],
        },
        controlAssessment: {
            evaluationScope: controlStatus === 'unavailable' ? 'not_available' : 'complete',
            evaluations: [{
                control: 'human_approval',
                status: controlStatus,
                confidence: controlStatus === 'effective' ? 'confirmed' : 'potential',
                evidenceIds: ['ev-control'],
            }],
        },
        reachability: {
            pathIds: ['path-1'],
            confidence: 'confirmed',
            repositoryVerified: true,
        },
        verdict: 'expected_capability',
    };
}

type TestCanonicalIssue = CanonicalAnalysisIssue & {
    fix?: {
        quickFix?: string;
        recommendedFix?: string;
        safePattern?: string;
        ruleId?: string;
    };
    presentationProvenance?: {
        issueRuleId?: string;
        impactRuleId?: string;
        whyThisMattersRuleId?: string;
        howToFixRuleId?: string;
        safePatternRuleId?: string;
    };
};

function contextForDecision(verdictInput: VerdictInput, decision: VerdictDecision): CanonicalIssueContext {
    const sources = verdictInput.exposure === 'trusted'
        ? ['developer_instruction' as const]
        : verdictInput.exposure === 'mixed'
            ? ['developer_instruction' as const, 'user_input' as const]
            : verdictInput.exposure === 'untrusted'
                ? ['user_input' as const]
                : ['unknown' as const];
    return {
        artifactKind: 'skill',
        capability: verdictInput.capabilityPrivilege === 'ordinary' ? 'unknown' : 'shell',
        trustAssessment: {
            sources,
            confidence: verdictInput.exposure === 'unknown' ? 'potential' : 'probable',
            evidenceIds: verdictInput.exposure === 'unknown' ? [] : ['ev-trust'],
        },
        intentAssessment: {
            expected: verdictInput.intent === 'expected' ? true : verdictInput.intent === 'unexpected' ? false : 'unknown',
            source: verdictInput.intent === 'expected' ? 'config' : 'inferred',
            confidence: verdictInput.intent === 'unknown' ? 'potential' : 'probable',
            evidenceIds: verdictInput.intent === 'unknown' ? [] : ['ev-intent'],
        },
        controlAssessment: {
            evaluationScope: verdictInput.contextAvailability === 'unavailable'
                ? 'not_available'
                : verdictInput.contextAvailability,
            evaluations: [{
                control: verdictInput.controlState === 'effective' ? 'human_approval' : 'unknown',
                status: verdictInput.controlState,
                confidence: verdictInput.controlState === 'effective' ? 'confirmed' : 'potential',
                evidenceIds: verdictInput.controlState === 'unavailable' ? [] : ['ev-control'],
            }],
        },
        reachability: {
            pathIds: verdictInput.reachability === 'verified' || verdictInput.reachability === 'probable' ? ['path-1'] : [],
            confidence: verdictInput.reachability === 'verified' ? 'confirmed' : verdictInput.reachability === 'probable' ? 'probable' : 'potential',
            repositoryVerified: verdictInput.reachability === 'verified',
        },
        vulnerabilityBasis: decision.vulnerabilityBasis,
        verdict: decision.verdict,
    };
}

function issueForDecision(verdictInput: VerdictInput, decision: VerdictDecision, overrides: Partial<TestCanonicalIssue> = {}): TestCanonicalIssue {
    const ruleId = overrides.ruleId || 'sec_contextual_fixture';
    return {
        id: overrides.id || 'issue-contextual-fixture',
        ruleId,
        severity: overrides.severity || decision.severityCeiling,
        category: overrides.category || 'security',
        issue: overrides.issue || 'Contextual fixture issue.',
        impact: overrides.impact || 'Contextual fixture impact.',
        whyThisMatters: overrides.whyThisMatters || 'Contextual fixture rationale.',
        howToFix: overrides.howToFix || 'Apply the rule-owned fix.',
        evidence: overrides.evidence || [{ id: 'ev-issue', ruleId }],
        fix: overrides.fix || {
            quickFix: 'Apply the scoped control.',
            recommendedFix: 'Apply the scoped control.',
            safePattern: 'if (!approved || !isAllowed(input)) return;',
            ruleId,
        },
        context: overrides.context || contextForDecision(verdictInput, decision),
        ...overrides,
    };
}

describe('contextual verdict engine', () => {
    it('accepts direct-evidence vulnerability only with rule-owned evidence and ceilings', () => {
        const decision = evaluateContextualVerdict(input({
            capabilityPrivilege: 'ordinary',
            intent: 'unexpected',
            reachability: 'not_applicable',
            directVulnerability: {
                present: true,
                basis: directBasis,
                ruleId: 'sec_hardcoded_secret',
                confidence: 'confirmed',
                severityCeiling: 'high',
            },
        }));

        expect(decision).toMatchObject({
            verdict: 'vulnerability',
            severityCeiling: 'high',
            confidenceCeiling: 'confirmed',
            explanationCode: 'direct_evidence_vulnerability',
            vulnerabilityBasis: directBasis,
        });
    });

    it('accepts source-to-sink vulnerability only when basis, reachability, source trust, and control failure align', () => {
        const decision = evaluateContextualVerdict(input({
            exposure: 'untrusted',
            controlState: 'missing',
            sourceToSinkBasis,
        }));

        expect(decision.verdict).toBe('vulnerability');
        expect(decision.severityCeiling).toBe('critical');
        expect(decision.vulnerabilityBasis).toEqual(sourceToSinkBasis);
    });

    it('does not turn capability presence alone into a vulnerability', () => {
        expect(evaluateContextualVerdict(input()).verdict).toBe('expected_capability');

        const unknownTrustedRoute = evaluateContextualVerdict(input({
            exposure: 'unknown',
            intent: 'unknown',
            controlState: 'missing',
        }));

        expect(unknownTrustedRoute.verdict).toBe('capability_review');
        expect(unknownTrustedRoute.verdict).not.toBe('vulnerability');
        expect(unknownTrustedRoute.severityCeiling).not.toBe('critical');
    });

    it('does not allow unavailable or present-unverified controls to satisfy expected capability', () => {
        const presentUnverified = evaluateContextualVerdict(input({
            controlState: 'present_unverified',
        }));
        const unavailable = evaluateContextualVerdict(input({
            controlState: 'unavailable',
        }));

        expect(presentUnverified.verdict).toBe('capability_review');
        expect(unavailable.verdict).toBe('needs_more_context');
    });

    it('does not fabricate a vulnerability from an incomplete direct-evidence basis', () => {
        const decision = evaluateContextualVerdict(input({
            capabilityPrivilege: 'ordinary',
            intent: 'unexpected',
            directVulnerability: {
                present: true,
                basis: {
                    kind: 'direct_evidence',
                    directEvidenceClass: 'hardcoded_secret',
                    evidenceIds: [],
                },
                ruleId: 'sec_hardcoded_secret',
                confidence: 'confirmed',
                severityCeiling: 'critical',
            },
        }));

        expect(decision.verdict).not.toBe('vulnerability');
        expect(isAcceptedVulnerabilityBasis(decision.vulnerabilityBasis)).toBe(false);
    });

    it('is deterministic for normalized inputs', () => {
        const normalized = input({
            exposure: 'mixed',
            reachability: 'probable',
            controlState: 'contradicted',
            sourceToSinkBasis,
        });

        expect(JSON.stringify(evaluateContextualVerdict(normalized))).toBe(JSON.stringify(evaluateContextualVerdict(normalized)));
    });

    it('has an explicit invariant-valid outcome for every normalized Gate 1.5 verdict cell', () => {
        let cells = 0;
        for (const capabilityPrivilege of CAPABILITY_PRIVILEGES) {
            for (const exposure of EXPOSURES) {
                for (const reachability of REACHABILITIES) {
                    for (const controlState of CONTROL_STATES) {
                        for (const contextAvailability of CONTEXT_AVAILABILITIES) {
                            for (const intent of INTENTS) {
                                const decision = evaluateContextualVerdict({
                                    capabilityPrivilege,
                                    exposure,
                                    reachability,
                                    controlState,
                                    contextAvailability,
                                    intent,
                                    directVulnerability: { present: false },
                                });
                                const verdictInput = {
                                    capabilityPrivilege,
                                    exposure,
                                    reachability,
                                    controlState,
                                    contextAvailability,
                                    intent,
                                    directVulnerability: { present: false },
                                } satisfies VerdictInput;
                                cells += 1;
                                expect(decision.verdict).toMatch(/^(expected_capability|capability_review|risky_configuration|vulnerability|hardening_suggestion|quality_suggestion|needs_more_context)$/);
                                expect(decision.severityCeiling).toMatch(/^(low|medium|high|critical)$/);
                                expect(decision.confidenceCeiling).toMatch(/^(confirmed|probable|potential)$/);
                                expect(decision.explanationCode.length).toBeGreaterThan(0);
                                expect(decision.verdict).not.toBe('vulnerability');
                                expect(() => assertFindingInvariants(issueForDecision(verdictInput, decision), {
                                    verdictInput,
                                    decision,
                                })).not.toThrow();
                            }
                        }
                    }
                }
            }
        }

        expect(cells).toBe(
            CAPABILITY_PRIVILEGES.length
            * EXPOSURES.length
            * REACHABILITIES.length
            * CONTROL_STATES.length
            * CONTEXT_AVAILABILITIES.length
            * INTENTS.length,
        );
    });
});

describe('finding structural invariants', () => {
    it('asserts valid contextual findings and rejects vulnerabilities without accepted basis', () => {
        const validDecision = evaluateContextualVerdict(input());
        expect(() => assertFindingInvariants(issueForDecision(input(), validDecision), { requireContext: true })).not.toThrow();

        const invalid = issueForDecision(input(), validDecision, {
            severity: 'critical',
            context: {
                ...context('missing'),
                verdict: 'vulnerability',
                vulnerabilityBasis: {
                    kind: 'source_to_sink',
                    pathIds: [],
                    untrustedSourceEvidenceIds: [],
                    privilegedSinkEvidenceIds: [],
                    controlFailureEvidenceIds: [],
                },
            },
        });

        expect(() => assertFindingInvariants(invalid, { requireContext: true })).toThrow(/accepted VulnerabilityBasis/);
    });

    it('prevents unavailable controls from increasing severity', () => {
        const decision = evaluateContextualVerdict(input({
            controlState: 'unavailable',
            contextAvailability: 'unavailable',
        }));
        const invalid = issueForDecision(input({
            controlState: 'unavailable',
            contextAvailability: 'unavailable',
        }), decision, {
            severity: 'critical',
        });

        const validation = validateFindingInvariants(invalid, { requireContext: true, decision });
        expect(validation.valid).toBe(false);
        expect(validation.errors.join('\n')).toContain('needs_more_context cannot raise severity');
    });

    it('prevents title, impact, evidence, remediation, and safe pattern rule crossing', () => {
        const invalid = issueForDecision(input(), evaluateContextualVerdict(input()), {
            ruleId: 'eff_token_bloat',
            category: 'efficiency',
            evidence: [{ id: 'ev-secret', ruleId: 'sec_secret_exposure' }],
            fix: {
                quickFix: 'Rotate the leaked token.',
                recommendedFix: 'Move the token to a secret manager.',
                safePattern: 'const apiKey = process.env.API_KEY;',
                ruleId: 'sec_secret_exposure',
            },
            presentationProvenance: {
                issueRuleId: 'sec_secret_exposure',
                impactRuleId: 'sec_secret_exposure',
                howToFixRuleId: 'sec_secret_exposure',
                safePatternRuleId: 'sec_secret_exposure',
            },
        });

        const validation = validateFindingInvariants(invalid, { requireContext: true });
        expect(validation.valid).toBe(false);
        expect(validation.errors.join('\n')).toContain('evidence ev-secret belongs to sec_secret_exposure');
        expect(validation.errors.join('\n')).toContain('issueRuleId belongs to sec_secret_exposure');
        expect(validation.errors.join('\n')).toContain('fix belongs to sec_secret_exposure');
        expect(validation.errors.join('\n')).toContain('secret-handling remediation');
    });
});

describe('locked contextual regression fixtures', () => {
    it('FIX-001 rejects cross-rule contamination and accepts coherent eff_token_bloat', () => {
        const contaminated = issueForDecision(input(), evaluateContextualVerdict(input()), {
            ruleId: 'eff_token_bloat',
            category: 'security',
            evidence: [{ id: 'ev-secret', ruleId: 'sec_secret_exposure' }],
            fix: {
                quickFix: 'Rotate the key.',
                recommendedFix: 'Use environment variables.',
                safePattern: 'const apiKey = process.env.API_KEY;',
                ruleId: 'sec_secret_exposure',
            },
        });
        const coherent = issueForDecision(input({ capabilityPrivilege: 'ordinary' }), evaluateContextualVerdict(input({ capabilityPrivilege: 'ordinary' })), {
            ruleId: 'eff_token_bloat',
            category: 'efficiency',
            issue: 'The prompt is large enough to risk truncation or high cost.',
            impact: 'Long prompts increase latency and cost and can push instructions out of the window.',
            whyThisMatters: 'Concise prompts are cheaper and less likely to drop instructions.',
            howToFix: 'Shorten the prompt or move static context into retrieval.',
            evidence: [{ id: 'ev-token', ruleId: 'eff_token_bloat' }],
            fix: {
                quickFix: 'Trim repeated context.',
                recommendedFix: 'Shorten the prompt or move static context into retrieval.',
                safePattern: 'Input: <validated value>\nOutput: <required schema>',
                ruleId: 'eff_token_bloat',
            },
        });

        expect(() => assertFindingInvariants(contaminated, { requireContext: true })).toThrow();
        expect(() => assertFindingInvariants(coherent, { requireContext: true })).not.toThrow();
    });

    it('FIX-002 keeps autonomous skill shell capability out of critical without path evidence', () => {
        const verdictInput = fallbackVerdictInputForRawFinding({
            severity: 'critical',
            workflow: { path: { privilegedSinkReached: true } },
        });
        const decision = evaluateContextualVerdict(verdictInput);
        const issue = issueForDecision(verdictInput, decision, {
            ruleId: 'sec_privileged_sink_access',
            severity: decision.severityCeiling,
        });

        expect(decision.verdict).toBe('needs_more_context');
        expect(issue.severity).not.toBe('critical');
        expect(issue.context?.controlAssessment.evaluations[0]?.status).toBe('unavailable');
        expect(() => assertFindingInvariants(issue, { requireContext: true, verdictInput, decision })).not.toThrow();
    });

    it('FIX-003 keeps unicode injection remediation coherent', () => {
        const verdictInput = input({
            capabilityPrivilege: 'ordinary',
            intent: 'unexpected',
        });
        const decision = evaluateContextualVerdict(verdictInput);
        const issue = issueForDecision(verdictInput, decision, {
            ruleId: 'sec_unicode_injection_obfuscation',
            issue: 'Unicode control characters can hide or alter untrusted instructions.',
            impact: 'Obfuscated text can bypass review and make instruction boundaries unclear.',
            howToFix: 'Normalize and escape untrusted input before placing it near trusted instructions.',
            evidence: [{ id: 'ev-unicode', ruleId: 'sec_unicode_injection_obfuscation' }],
            fix: {
                quickFix: 'Normalize Unicode control characters.',
                recommendedFix: 'Normalize and escape untrusted input before placing it near trusted instructions.',
                safePattern: 'trustedInstructions + "\\n<untrusted_input>" + escape(userInput) + "</untrusted_input>"',
                ruleId: 'sec_unicode_injection_obfuscation',
            },
        });

        expect(() => assertFindingInvariants(issue, { requireContext: true, verdictInput, decision })).not.toThrow();
    });

    it('FIX-004 distinguishes controlled, vulnerable, and unavailable variants of the same shell sink', () => {
        const controlledInput = input();
        const vulnerableInput = input({
            exposure: 'untrusted',
            controlState: 'missing',
            sourceToSinkBasis,
        });
        const unavailableInput = input({
            exposure: 'unknown',
            controlState: 'unavailable',
            contextAvailability: 'unavailable',
        });
        const controlled = evaluateContextualVerdict(controlledInput);
        const vulnerable = evaluateContextualVerdict(vulnerableInput);
        const unavailable = evaluateContextualVerdict(unavailableInput);

        expect(controlled.verdict).toBe('expected_capability');
        expect(vulnerable.verdict).toBe('vulnerability');
        expect(unavailable.verdict).toBe('needs_more_context');

        for (const [verdictInput, decision] of [[controlledInput, controlled], [vulnerableInput, vulnerable], [unavailableInput, unavailable]] as const) {
            expect(() => assertFindingInvariants(issueForDecision(verdictInput, decision), {
                requireContext: true,
                verdictInput,
                decision,
            })).not.toThrow();
        }
    });
});

describe('contextual presentation binding', () => {
    it('keeps rule evidence and remediation bound to the same canonical issue', () => {
        const valid = validateContextualFindingPresentation({
            id: 'issue-1',
            ruleId: 'eff_token_bloat',
            category: 'efficiency',
            fix: {
                safePattern: 'Shorten static context and move reference material into retrieval.',
            },
            evidence: [{ id: 'ev-1', ruleId: 'eff_token_bloat' }],
        });

        expect(valid.valid).toBe(true);
    });

    it('rejects cross-rule evidence and known remediation-family contamination', () => {
        const invalid = validateContextualFindingPresentation({
            id: 'issue-1',
            ruleId: 'eff_token_bloat',
            category: 'efficiency',
            fix: {
                safePattern: 'const apiKey = process.env.API_KEY;',
            },
            evidence: [{ id: 'ev-1', ruleId: 'sec_secret_exposure' }],
        });

        expect(invalid.valid).toBe(false);
        expect(invalid.errors.join('\n')).toContain('sec_secret_exposure');
        expect(invalid.errors.join('\n')).toContain('secret-handling remediation');
    });

    it('rejects vulnerability verdicts without an accepted basis', () => {
        const invalid = validateContextualFindingPresentation({
            id: 'issue-1',
            ruleId: 'sec_privileged_sink_access',
            context: {
                ...context('missing'),
                verdict: 'vulnerability',
                vulnerabilityBasis: {
                    kind: 'source_to_sink',
                    pathIds: [],
                    untrustedSourceEvidenceIds: [],
                    privilegedSinkEvidenceIds: [],
                    controlFailureEvidenceIds: [],
                },
            },
        });

        expect(invalid.valid).toBe(false);
        expect(invalid.errors.join('\n')).toContain('vulnerability verdict requires');
    });

    it('rejects expected capability when controls are unavailable or only present-unverified', () => {
        const unavailable = validateContextualFindingPresentation({
            id: 'issue-1',
            ruleId: 'sec_privileged_sink_access',
            context: context('unavailable'),
        });
        const presentUnverified = validateContextualFindingPresentation({
            id: 'issue-2',
            ruleId: 'sec_privileged_sink_access',
            context: context('present_unverified'),
        });

        expect(unavailable.valid).toBe(false);
        expect(presentUnverified.valid).toBe(false);
    });
});

describe('contextual adapter seams and report schema', () => {
    it('normalizes legacy raw findings conservatively without creating vulnerabilities', () => {
        const raw = fallbackVerdictInputForRawFinding({
            severity: 'critical',
            workflow: {
                path: {
                    privilegedSinkReached: true,
                },
            },
        });
        const mcp = fallbackVerdictInputForMcpFinding({ severity: 'critical' });

        expect(evaluateContextualVerdict(raw).verdict).toBe('needs_more_context');
        expect(evaluateContextualVerdict(mcp).verdict).not.toBe('vulnerability');
    });

    it('adds schemaVersion to the report without repurposing product version or issue shape', () => {
        const report = analyzeRepositoryExecutionFromFiles('/uploaded-repository', [{
            path: 'agent.prompt',
            content: 'System prompt: answer concisely.',
        }], [{
            filePath: '/uploaded-repository/agent.prompt',
            findings: [{
                rule_id: 'eff_token_bloat',
                category: 'efficiency',
                severity: 'low',
                line: 1,
                message: 'The prompt is large enough to risk truncation or high cost.',
                evidence: 'System prompt: answer concisely.',
            }],
        }]);

        expect(report.version).toBe('1.4.3');
        expect(report.schemaVersion).toBe('2026-06-23.contextual-v1');
        expect(report.schemaVersion).not.toBe(report.version);
        expect(report.issues[0]).not.toHaveProperty('schemaVersion');
        expect(report.issues[0]?.evidence[0]?.ruleId).toBe('eff_token_bloat');
    });
});

describe('Gate 2 intent inference semantics', () => {
    it('marks inferred artifact intent as heuristic rather than confirmed', () => {
        const inferred = inferCapabilityIntent({
            artifactKind: 'skill',
            capability: 'shell',
            evidenceIds: ['ev-skill'],
        });
        const configured = inferCapabilityIntent({
            artifactKind: 'workflow',
            capability: 'deployment',
            declaredExpectedCapabilities: ['deployment'],
            evidenceIds: ['ev-config'],
        });
        const documentation = inferCapabilityIntent({
            artifactKind: 'documentation',
            capability: 'shell',
            evidenceIds: ['ev-doc'],
        });

        expect(inferred).toMatchObject({ expected: true, source: 'inferred', confidence: 'probable' });
        expect(configured).toMatchObject({ expected: true, source: 'config', confidence: 'confirmed' });
        expect(documentation).toMatchObject({ expected: 'unknown', source: 'inferred', confidence: 'potential' });
    });
});

describe('Gate 2 secret semantics', () => {
    it('classifies environment secret access as reference, not exposure', () => {
        const assessment = classifySecretSemantics('const key = process.env.OPENAI_API_KEY;', {
            evidenceIds: ['ev-ref'],
        });
        const decision = evaluateContextualVerdict(secretAssessmentToVerdictInput(assessment));

        expect(assessment.kind).toBe('secret_reference');
        expect(decision.verdict).not.toBe('vulnerability');
        expect(decision.severityCeiling).not.toBe('critical');
    });

    it('keeps literal credentials as direct-evidence vulnerabilities', () => {
        const assessment = classifySecretSemantics('const key = "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";', {
            evidenceIds: ['ev-secret'],
        });
        const decision = evaluateContextualVerdict(secretAssessmentToVerdictInput(assessment));

        expect(assessment.kind).toBe('hardcoded_secret');
        expect(decision.verdict).toBe('vulnerability');
        expect(decision.severityCeiling).toBe('high');
        expect(decision.vulnerabilityBasis).toEqual({
            kind: 'direct_evidence',
            directEvidenceClass: 'hardcoded_secret',
            evidenceIds: ['ev-secret'],
        });
    });

    it('requires a valid basis before secret enumeration becomes high-confidence vulnerability', () => {
        const assessment = classifySecretSemantics('Object.keys(process.env).forEach(key => send(key));', {
            untrustedInfluence: true,
            evidenceIds: ['ev-enum'],
        });
        const withoutBasis = evaluateContextualVerdict(secretAssessmentToVerdictInput(assessment, {
            untrustedInfluence: true,
        }));
        const withBasis = evaluateContextualVerdict(secretAssessmentToVerdictInput(assessment, {
            untrustedInfluence: true,
            sourceToSinkBasis,
        }));

        expect(assessment.kind).toBe('secret_enumeration');
        expect(withoutBasis.verdict).not.toBe('vulnerability');
        expect(withoutBasis.severityCeiling).not.toBe('critical');
        expect(withBasis.verdict).toBe('vulnerability');
        expect(withBasis.severityCeiling).toBe('critical');
        expect(withBasis.vulnerabilityBasis).toEqual(sourceToSinkBasis);
    });
});

describe('Gate 2 SARIF contextual policy', () => {
    it('maps contextual verdicts to SARIF levels explicitly', () => {
        expect(contextualVerdictToSarifLevel('vulnerability', 'critical')).toBe('error');
        expect(contextualVerdictToSarifLevel('risky_configuration', 'high')).toBe('error');
        expect(contextualVerdictToSarifLevel('risky_configuration', 'medium')).toBe('warning');
        expect(contextualVerdictToSarifLevel('capability_review', 'low')).toBe('warning');
        expect(contextualVerdictToSarifLevel('needs_more_context', 'low')).toBe('note');
        expect(contextualVerdictToSarifLevel('hardening_suggestion', 'low')).toBe('note');
        expect(contextualVerdictToSarifLevel('quality_suggestion', 'low')).toBe('omit');
        expect(contextualVerdictToSarifLevel('quality_suggestion', 'low', { includeQualitySuggestions: true })).toBe('note');
        expect(contextualVerdictToSarifLevel('expected_capability', 'low')).toBe('omit');
        expect(contextualVerdictToSarifLevel('expected_capability', 'low', { includeCapabilityInventory: true })).toBe('note');
    });

    it('omits expected capabilities from repository SARIF by default and includes them when requested', () => {
        const base = analyzeRepositoryExecutionFromFiles('/uploaded-repository', [{
            path: 'agent.prompt',
            content: 'System prompt: use process.env.OPENAI_API_KEY to call the approved API.',
        }], [{
            filePath: '/uploaded-repository/agent.prompt',
            findings: [{
                rule_id: 'sec_secret_reference',
                category: 'security',
                severity: 'low',
                line: 1,
                message: 'Secret reference.',
                evidence: 'process.env.OPENAI_API_KEY',
            }],
        }]);
        const expectedIssue = {
            ...base.issues[0],
            severity: 'low',
            context: context('effective'),
        };
        const report: RepositoryExecutionReport = {
            ...base,
            issues: [expectedIssue],
            issueSummary: { total: 1, critical: 0, high: 0, medium: 0, low: 1 },
        };
        const defaultSarif = JSON.parse(formatRepositoryReportSarif(report));
        const inventorySarif = JSON.parse(formatRepositoryReportSarif(report, { includeCapabilityInventory: true }));

        expect(defaultSarif.runs[0].results).toHaveLength(0);
        expect(defaultSarif.runs[0].properties.omitted_expected_capability_issue_ids).toEqual([expectedIssue.id]);
        expect(validateSarifLogShape(defaultSarif)).toEqual({ valid: true, errors: [] });
        expect(inventorySarif.runs[0].results).toHaveLength(1);
        expect(inventorySarif.runs[0].results[0].level).toBe('note');
        expect(inventorySarif.runs[0].results[0].properties.contextual_verdict).toBe('expected_capability');
        expect(inventorySarif.runs[0].results[0].rank).toBe(20);
        expect(inventorySarif.runs[0].results[0].properties['security-severity']).toBe('2.0');
        expect(validateSarifLogShape(inventorySarif)).toEqual({ valid: true, errors: [] });
    });
});
