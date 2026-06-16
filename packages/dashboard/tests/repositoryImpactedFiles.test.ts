import { describe, expect, it } from 'vitest';
import {
  buildImpactedFileViews,
  REPOSITORY_IMPACTED_FILE_TYPES,
} from '../src/lib/repositoryImpactedFiles';

describe('Repository Explorer impacted files', () => {
  it('uses the report-owned file index and exposes file-specific risk details', () => {
    const report = {
      impactedFiles: [{
        path: 'skills/review/SKILL.md',
        name: 'SKILL.md',
        type: 'SKILL.md',
        issueIds: ['issue-skill'],
        issueCount: 1,
        highestSeverity: 'critical',
        pathIds: [],
      }],
      issues: [{
        id: 'issue-skill',
        severity: 'critical',
        impact: 'Repository instructions could trigger a sensitive action.',
        howToFix: 'Require approval before sensitive actions.',
        fix: {
          quickFix: 'Disable automatic execution.',
          recommendedFix: 'Require approval before sensitive actions.',
          safePattern: 'if (approved) run();',
          effort: 'Moderate',
        },
        evidence: [{ id: 'evidence-skill', file: 'skills/review/SKILL.md', snippet: 'run shell tools' }],
        pathIds: ['path-shell'],
      }, {
        id: 'issue-not-indexed',
        severity: 'high',
        impact: 'This issue belongs to another file.',
        howToFix: 'Change another file.',
        evidence: [],
        pathIds: [],
      }],
      reachablePaths: [{
        id: 'path-shell',
        explanation: 'The skill can reach shell execution.',
        files: ['skills/review/SKILL.md'],
      }],
    };

    const views = buildImpactedFileViews(report);

    expect(REPOSITORY_IMPACTED_FILE_TYPES).toEqual(['SKILL.md', 'MCP Config', 'Workflow', 'Prompt']);
    expect(views).toHaveLength(report.impactedFiles.length);
    expect(views[0].issueCount).toBe(report.impactedFiles[0].issueCount);
    expect(views[0].issues.map((issue: any) => issue.id)).toEqual(['issue-skill']);
    expect(views[0].impacts).toEqual(['Repository instructions could trigger a sensitive action.']);
    expect(views[0].evidence.map((item: any) => item.id)).toEqual(['evidence-skill']);
    expect(views[0].fixes).toEqual([
      'Disable automatic execution.',
      'Require approval before sensitive actions.',
      'if (approved) run();',
    ]);
    expect(views[0].executionPaths.map((path: any) => path.id)).toEqual(['path-shell']);
  });
});
