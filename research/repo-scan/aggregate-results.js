const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'results/repo-scan');
const STATUS_FILE = path.join(OUT_DIR, 'scan-status.json');
const SUMMARY_JSON = path.join(OUT_DIR, 'summary.json');
const SUMMARY_MD = path.join(OUT_DIR, 'summary.md');
const CSV_FILE = path.join(OUT_DIR, 'summary.csv');

function safeName(fullName) {
  return fullName.replace(/[^\w.-]+/g, '__');
}

function isSecretFinding(finding) {
  const text = `${finding.rule_id} ${finding.message || ''} ${finding.fix || ''}`.toLowerCase();
  return /llm02|pii|secret|api key|credential|token|password|credit card|ssn/.test(text);
}

function isInjectionFinding(finding) {
  const text = `${finding.rule_id} ${finding.message || ''}`.toLowerCase();
  return /llm01|injection|jailbreak|homoglyph|zero_width|encoded_payload|unbounded_persona|rag/.test(text);
}

function isHighOrCritical(finding) {
  return ['high', 'critical'].includes(String(finding.severity || '').toLowerCase());
}

function isProductionLikeFile(file) {
  const normalized = String(file || '').replace(/\\/g, '/').toLowerCase();
  if (!normalized) {
    return true;
  }
  return !/(^|\/)(docs?|documentation|examples?|tests?|test|spec|fixtures?|benchmarks?|cookbook|notebooks?|samples?|demo|demos|evals?|__tests__|__mocks__)(\/|$)|readme\.|\.md$|\.mdx$|\.ipynb$|\.snap$/.test(normalized);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  const statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  const rows = [];
  const examples = [];

  for (const status of statuses.filter((item) => item.status === 'scanned')) {
    const resultFile = path.join(OUT_DIR, `${safeName(status.full_name)}.json`);
    let results = [];
    try {
      results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch {
      continue;
    }

    const findings = results.flatMap((result) =>
      (result.findings || []).map((finding) => ({ ...finding, source_file: result.file || '' })),
    );
    const productionFindings = findings.filter((finding) => isProductionLikeFile(finding.source_file));
    const scores = results.map((result) => Number(result.overall_score)).filter(Number.isFinite);
    const securityScores = results
      .map((result) => Number(result.pillar_scores?.security))
      .filter(Number.isFinite);
    const secretFindings = findings.filter(isSecretFinding);
    const injectionFindings = findings.filter(isInjectionFinding);
    const highCriticalSecurityFindings = productionFindings.filter(
      (finding) => isHighOrCritical(finding) && (finding.category === 'security' || isSecretFinding(finding) || isInjectionFinding(finding)),
    );
    const highCriticalSecretFindings = highCriticalSecurityFindings.filter(isSecretFinding);
    const highCriticalInjectionFindings = highCriticalSecurityFindings.filter(isInjectionFinding);
    const clarityFindings = findings.filter((finding) => finding.category === 'clarity');
    const outputConstraintFindings = findings.filter((finding) => /format|output|json|yaml|length|quantifier|structure/i.test(`${finding.rule_id} ${finding.message || ''}`));
    const contextIsolationFindings = findings.filter((finding) => /rag|context|unbounded_access|delimiter/i.test(`${finding.rule_id} ${finding.message || ''}`));
    const consistencyFindings = findings.filter((finding) => finding.category === 'consistency');
    const auditabilityFindings = findings.filter((finding) => /waiver|governance|audit|version|logging/i.test(`${finding.rule_id} ${finding.message || ''}`));

    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
    const avgSecurity = securityScores.length ? Math.round(securityScores.reduce((a, b) => a + b, 0) / securityScores.length) : 100;
    const topFinding = findings[0];
    const notes = topFinding ? `${topFinding.rule_id}: ${topFinding.message || ''}` : 'No findings';

    rows.push({
      repo: status.full_name,
      stars: status.stars,
      language: status.language,
      files_scanned: results.length,
      avg_score: avgScore,
      security_score: avgSecurity,
      secrets_found: secretFindings.length,
      injection_risks: injectionFindings.length,
      production_high_critical_security: highCriticalSecurityFindings.length,
      production_high_critical_secrets: highCriticalSecretFindings.length,
      production_high_critical_injection: highCriticalInjectionFindings.length,
      clarity_issues: clarityFindings.length,
      output_constraint_issues: outputConstraintFindings.length,
      context_isolation_issues: contextIsolationFindings.length,
      consistency_issues: consistencyFindings.length,
      auditability_signals: auditabilityFindings.length,
      total_findings: findings.length,
      notes,
    });

    for (const finding of highCriticalSecurityFindings.slice(0, 5)) {
      examples.push({
        repo: status.full_name,
        stars: status.stars,
        language: status.language,
        rule_id: finding.rule_id,
        severity: finding.severity,
        file: finding.source_file || finding.file || finding.filePath || '',
        line: finding.line || '',
        message: finding.message || '',
      });
    }
  }

  const scanned = rows.length;
  const metric = (predicate) => rows.filter(predicate).length;
  const avgSecurityScore = scanned
    ? Math.round(rows.reduce((total, row) => total + row.security_score, 0) / scanned)
    : 100;

  const summary = {
    scanned_repos: scanned,
    candidate_repos: statuses.length,
    with_hardcoded_secrets: metric((row) => row.secrets_found > 0),
    with_injection_risk: metric((row) => row.injection_risks > 0),
    with_production_high_critical_security: metric((row) => row.production_high_critical_security > 0),
    with_production_high_critical_secrets: metric((row) => row.production_high_critical_secrets > 0),
    with_production_high_critical_injection: metric((row) => row.production_high_critical_injection > 0),
    with_clarity_issues: metric((row) => row.clarity_issues > 0),
    with_output_constraint_issues: metric((row) => row.output_constraint_issues > 0),
    with_context_isolation_issues: metric((row) => row.context_isolation_issues > 0),
    with_consistency_issues: metric((row) => row.consistency_issues > 0),
    with_auditability_gaps: metric((row) => row.auditability_signals === 0),
    average_security_score: avgSecurityScore,
    rows,
    anonymized_examples: examples.slice(0, 20).map((example, index) => ({
      label: `Repo ${String.fromCharCode(65 + index)}`,
      stars: example.stars,
      language: example.language,
      rule_id: example.rule_id,
      severity: example.severity,
      file: example.file,
      message: example.message,
    })),
  };

  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2));
  const headers = Object.keys(rows[0] || { repo: '', stars: '', language: '', notes: '' });
  fs.writeFileSync(CSV_FILE, [headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n'));

  const md = [
    '# PromptSonar Repo Scan Summary',
    '',
    `Repos scanned: ${summary.scanned_repos}`,
    `With high/critical security signals in production-like files: ${summary.with_production_high_critical_security}`,
    `With high/critical secret signals in production-like files: ${summary.with_production_high_critical_secrets}`,
    `With high/critical injection signals in production-like files: ${summary.with_production_high_critical_injection}`,
    `With any hardcoded secret signals, including docs/tests/examples: ${summary.with_hardcoded_secrets}`,
    `With any injection signals, including docs/tests/examples: ${summary.with_injection_risk}`,
    `With clarity issues: ${summary.with_clarity_issues}`,
    `Average security score: ${summary.average_security_score}/100`,
    '',
    'Note: high/critical production-like counts exclude docs, tests, examples, fixtures, benchmarks, notebooks, and README/Markdown files. These are scanner signals, not manually confirmed vulnerabilities.',
    '',
    '| Repo | Stars | Language | Prod High/Critical Security | Prod Secrets | Prod Injection | Clarity | Security Score | Notes |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row.repo} | ${row.stars} | ${row.language} | ${row.production_high_critical_security} | ${row.production_high_critical_secrets} | ${row.production_high_critical_injection} | ${row.clarity_issues} | ${row.security_score} | ${row.notes.replace(/\|/g, '/')} |`),
    '',
    '## Anonymized Examples',
    '',
    ...summary.anonymized_examples.map((example) => `- ${example.label} (${example.language}): ${example.severity.toUpperCase()} ${example.rule_id} — ${example.message}`),
    '',
  ].join('\n');
  fs.writeFileSync(SUMMARY_MD, md);
  console.log(md);
}

main();
