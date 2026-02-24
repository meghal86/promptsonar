"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePrompt = evaluatePrompt;
const clarity_1 = require("./clarity");
const structure_1 = require("./structure");
const best_practices_1 = require("./best_practices");
const consistency_1 = require("./consistency");
const owasp_patterns_1 = require("./security/owasp_patterns");
const pii_1 = require("./security/pii");
const token_limit_1 = require("./efficiency/token_limit");
__exportStar(require("./types"), exports);
function evaluatePrompt(input, config = {}) {
    const findings = [
        ...(0, clarity_1.checkClarity)(input),
        ...(0, structure_1.checkStructure)(input),
        ...(0, best_practices_1.checkBestPractices)(input),
        ...(0, consistency_1.checkConsistency)(input),
        ...(0, owasp_patterns_1.checkOwaspPatterns)(input),
        ...(0, pii_1.checkPii)(input),
        ...(0, token_limit_1.checkTokenLimit)(input, config?.efficiency?.token_budget || 8192),
    ];
    // Master Scoring (Security 40%, Clarity 15%, Structure 15%, Best Practices 15%, Consistency 10%, Efficiency 5%)
    let totalPenalty = 0;
    for (const finding of findings) {
        if (finding.category === 'security')
            totalPenalty += (finding.penalty_score || 0) * 0.40;
        if (finding.category === 'clarity')
            totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'structure')
            totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'best_practices')
            totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'consistency')
            totalPenalty += (finding.penalty_score || 0) * 0.10;
        if (finding.category === 'efficiency')
            totalPenalty += (finding.penalty_score || 0) * 0.05;
        // safety can be lumped into security/pii for this MVP mapping
        if (finding.category === 'safety')
            totalPenalty += (finding.penalty_score || 0) * 0.05;
    }
    let status = "pass";
    let score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
    if (score < 70) {
        status = "fail";
    }
    else if (score < 85) {
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
        findings: cleanFindings
    };
}
