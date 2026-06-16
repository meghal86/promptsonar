export const PLAYGROUND_ISSUE_HIERARCHY = [
  'Issue Summary',
  'Impact',
  'Fix',
  'Evidence',
  'Execution Path',
  'Advanced Details',
] as const;

export const PLAYGROUND_ISSUE_CARD_SECTIONS = [
  'Issue',
  'Impact',
  'Why this matters',
  'Fix',
  'Technical Details',
] as const;

export const PLAYGROUND_ADVANCED_TABS = [
  { key: 'repo_overview', label: 'Overview' },
  { key: 'execution_map', label: 'How it connects' },
  { key: 'findings', label: 'What we found' },
  { key: 'workflows_page', label: 'Proof' },
  { key: 'rules', label: 'How to fix' },
  { key: 'report', label: 'Full report' },
] as const;
