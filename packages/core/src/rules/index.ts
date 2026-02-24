import { RuleInput, RuleResult } from './types';
import { checkClarity } from './clarity';
import { checkStructure } from './structure';
import { checkBestPractices } from './best_practices';
import { checkConsistency } from './consistency';
import { checkOwaspPatterns } from './security/owasp_patterns';
import { checkPii } from './security/pii';
import { checkTokenLimit } from './efficiency/token_limit';

export * from './types';

export function evaluatePrompt(input: RuleInput, config: any = {}): RuleResult {
    const findings = [
        ...checkClarity(input),
        ...checkStructure(input),
        ...checkBestPractices(input),
        ...checkConsistency(input),
        ...checkOwaspPatterns(input),
        ...checkPii(input),
        ...checkTokenLimit(input, config?.efficiency?.token_budget || 8192),
    ];

    // Master Scoring (Security 40%, Clarity 15%, Structure 15%, Best Practices 15%, Consistency 10%, Efficiency 5%)
    let totalPenalty = 0;
    for (const finding of findings) {
        if (finding.category === 'security') totalPenalty += (finding.penalty_score || 0) * 0.40;
        if (finding.category === 'clarity') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'structure') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'best_practices') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'consistency') totalPenalty += (finding.penalty_score || 0) * 0.10;
        if (finding.category === 'efficiency') totalPenalty += (finding.penalty_score || 0) * 0.05;
        // safety can be lumped into security/pii for this MVP mapping
        if (finding.category === 'safety') totalPenalty += (finding.penalty_score || 0) * 0.05;
    }

    let status: "pass" | "warn" | "fail" = "pass";
    let score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

    if (score < 70) {
        status = "fail";
    } else if (score < 85) {
        status = "warn";
    }

    const hasCritical = findings.some(f => f.severity === 'critical');
    if (hasCritical) {
        score = Math.min(score, 49); // Hard fail ceiling
        status = "fail";
    }

    // Strip internal fields like penalty_score from output
    const cleanFindings = findings.map(f => {
        const { penalty_score, ...rest } = f;
        return rest;
    });

    return {
        score,
        status,
        findings: cleanFindings as any
    };
}
