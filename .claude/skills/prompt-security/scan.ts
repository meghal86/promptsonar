import { execFileSync } from 'child_process';

type PromptSonarFinding = {
  severity?: string;
  rule_id?: string;
  ruleId?: string;
  message?: string;
};

type PromptSonarResult = {
  findings?: PromptSonarFinding[];
};

function normalizeSeverity(finding: PromptSonarFinding): string {
  return String(finding.severity || '').toLowerCase();
}

function extractFindings(report: unknown): PromptSonarFinding[] {
  if (Array.isArray(report)) {
    return report.flatMap((item: PromptSonarResult) => item.findings || []);
  }

  if (report && typeof report === 'object' && 'findings' in report) {
    return (report as PromptSonarResult).findings || [];
  }

  return [];
}

export async function scanPrompt(promptPath: string) {
  try {
    const result = execFileSync(
      'npx',
      ['--yes', '@promptsonar/cli', 'scan', promptPath, '--json'],
      {
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
      },
    );

    const report = JSON.parse(result);
    const findings = extractFindings(report);
    const critical = findings.filter((finding) => normalizeSeverity(finding) === 'critical').length;
    const high = findings.filter((finding) => normalizeSeverity(finding) === 'high').length;

    return {
      blocked: critical > 0,
      summary: `${findings.length} findings (${critical} critical, ${high} high)`,
      critical,
      high,
      message: critical === 0 && high === 0
        ? 'Clean scan'
        : `${critical + high} issues need review`,
      report,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Scan failed: ${message}` };
  }
}
