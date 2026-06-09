import { describe, expect, it } from 'vitest';
import {
  PLAYGROUND_ADVANCED_TABS,
  PLAYGROUND_ISSUE_CARD_SECTIONS,
  PLAYGROUND_ISSUE_HIERARCHY,
} from '../src/lib/playgroundIssueHierarchy';

describe('Playground issue-first hierarchy', () => {
  it('keeps the issue summary and remediation ahead of execution details', () => {
    expect(PLAYGROUND_ISSUE_HIERARCHY).toEqual([
      'Issue Summary',
      'Impact',
      'Fix',
      'Evidence',
      'Execution Path',
      'Advanced Details',
    ]);
  });

  it('requires every primary issue card to show plain-language and technical sections', () => {
    expect(PLAYGROUND_ISSUE_CARD_SECTIONS).toEqual([
      'Issue',
      'Impact',
      'Why this matters',
      'Fix',
      'Technical Details',
    ]);
  });

  it('preserves the existing advanced tabs and execution map', () => {
    expect(PLAYGROUND_ADVANCED_TABS.map((tab) => tab.label)).toEqual([
      'Overview',
      'Execution Map',
      'Findings',
      'Evidence',
      'Fix Plan',
      'Report',
    ]);
  });
});
