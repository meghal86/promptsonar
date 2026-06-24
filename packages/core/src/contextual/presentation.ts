import type { CanonicalIssueContext, ContextualVerdict, VulnerabilityBasis } from './types';
import { isAcceptedVulnerabilityBasis } from './verdict';

export interface ContextualFindingPresentation {
    id?: string;
    ruleId?: string;
    category?: string;
    issue?: string;
    impact?: string;
    whyThisMatters?: string;
    howToFix?: string;
    fix?: {
        quickFix?: string;
        recommendedFix?: string;
        safePattern?: string;
        ruleId?: string;
    };
    evidence?: Array<{
        id?: string;
        ruleId?: string;
    }>;
    presentationProvenance?: {
        issueRuleId?: string;
        impactRuleId?: string;
        whyThisMattersRuleId?: string;
        howToFixRuleId?: string;
        safePatternRuleId?: string;
    };
    fixSuggestions?: string[];
    context?: CanonicalIssueContext;
}

export interface ContextualFindingPresentationValidation {
    valid: boolean;
    errors: string[];
}

const CONTEXTUAL_VERDICT_LABELS: Record<ContextualVerdict, string> = {
    expected_capability: 'Expected capability',
    capability_review: 'Capability review',
    risky_configuration: 'Risky configuration',
    vulnerability: 'Vulnerability',
    hardening_suggestion: 'Hardening suggestion',
    quality_suggestion: 'Quality suggestion',
    needs_more_context: 'Needs more context',
};

const CONTEXTUAL_VERDICT_SUMMARIES: Record<ContextualVerdict, string> = {
    expected_capability: 'Capability appears intentional and positively controlled by the analyzed evidence.',
    capability_review: 'Capability appears intentional, but the analyzed evidence does not fully verify the controls.',
    risky_configuration: 'Capability appears intentional, but controls or permissions are demonstrably too broad or weak.',
    vulnerability: 'Evidence supports a vulnerability basis, not just the presence of a capability.',
    hardening_suggestion: 'Evidence supports a lower-risk hardening improvement.',
    quality_suggestion: 'Evidence supports a quality or maintainability improvement.',
    needs_more_context: 'Required control, trust, or wiring evidence was not available in the current analysis context.',
};

export function contextualVerdictLabel(verdict?: ContextualVerdict): string {
    return verdict ? CONTEXTUAL_VERDICT_LABELS[verdict] : 'Uncontextualized finding';
}

export function contextualVerdictSummary(verdict?: ContextualVerdict): string {
    return verdict
        ? CONTEXTUAL_VERDICT_SUMMARIES[verdict]
        : 'This finding was produced before contextual normalization was available.';
}

export function contextualIssueKind(finding: Pick<ContextualFindingPresentation, 'context'>): string {
    return contextualVerdictLabel(finding.context?.verdict);
}

const EFFICIENCY_RULE_SAFE_PATTERN_FORBIDDEN = /\b(?:process\.env|api[_-]?key|secret store|credential|token)\b/i;

function validateExpectedCapabilityControls(context: CanonicalIssueContext, errors: string[]): void {
    if (context.verdict !== 'expected_capability') return;
    const evaluations = context.controlAssessment.evaluations;
    if (evaluations.length === 0) {
        errors.push('expected_capability requires positive effective control evidence');
        return;
    }
    const nonEffective = evaluations.filter(evaluation => evaluation.status !== 'effective');
    if (nonEffective.length > 0) {
        errors.push('expected_capability cannot be satisfied by non-effective controls');
    }
}

function validateVulnerabilityContext(context: CanonicalIssueContext, errors: string[]): void {
    const basis: VulnerabilityBasis | undefined = context.vulnerabilityBasis;
    if (basis && !isAcceptedVulnerabilityBasis(basis)) {
        errors.push('vulnerabilityBasis is incomplete');
    }
    if (context.verdict === 'vulnerability' && !isAcceptedVulnerabilityBasis(basis)) {
        errors.push('vulnerability verdict requires an accepted vulnerabilityBasis');
    }
}

export function validateContextualFindingPresentation(finding: ContextualFindingPresentation): ContextualFindingPresentationValidation {
    const errors: string[] = [];
    const ruleId = finding.ruleId;
    if (!finding.id) errors.push('finding id is required');
    if (!ruleId) errors.push('ruleId is required');

    if (ruleId) {
        for (const evidence of finding.evidence || []) {
            if (evidence.ruleId && evidence.ruleId !== ruleId) {
                errors.push(`evidence ${evidence.id || '<unknown>'} belongs to ${evidence.ruleId}, not ${ruleId}`);
            }
        }
        if (finding.fix?.ruleId && finding.fix.ruleId !== ruleId) {
            errors.push(`fix belongs to ${finding.fix.ruleId}, not ${ruleId}`);
        }
        for (const [field, owner] of Object.entries(finding.presentationProvenance || {})) {
            if (owner && owner !== ruleId) {
                errors.push(`${field} belongs to ${owner}, not ${ruleId}`);
            }
        }
        if (ruleId.startsWith('eff_') && finding.fix?.safePattern && EFFICIENCY_RULE_SAFE_PATTERN_FORBIDDEN.test(finding.fix.safePattern)) {
            errors.push('efficiency rule safe pattern appears to contain secret-handling remediation');
        }
        if (ruleId.startsWith('eff_') && finding.category === 'security') {
            errors.push('efficiency rule is presented with security category');
        }
    }

    if (finding.context) {
        validateVulnerabilityContext(finding.context, errors);
        validateExpectedCapabilityControls(finding.context, errors);
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function assertContextualFindingPresentation(finding: ContextualFindingPresentation): void {
    const validation = validateContextualFindingPresentation(finding);
    if (!validation.valid) {
        throw new Error(`Invalid contextual finding presentation: ${validation.errors.join('; ')}`);
    }
}

export function omitMalformedContextualSections<T extends ContextualFindingPresentation>(finding: T): T {
    const validation = validateContextualFindingPresentation(finding);
    if (validation.valid) return finding;
    const next = { ...finding };
    delete next.context;
    next.fixSuggestions = [];
    if (next.fix) {
        next.fix = {
            ...next.fix,
            safePattern: '',
        };
    }
    return next;
}
