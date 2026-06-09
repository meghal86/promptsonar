export const PLAYGROUND_ISSUE_HIERARCHY = [
  'Issue Summary',
  'Impact',
  'Fix',
  'Evidence',
  'Execution Path',
  'Advanced Details',
] as const;

export const PLAYGROUND_ISSUE_CARD_QUESTIONS = [
  'What is wrong?',
  'Why should I care?',
  'How do I fix it?',
] as const;

export const PLAYGROUND_ADVANCED_TABS = [
  { key: 'repo_overview', label: 'Overview' },
  { key: 'execution_map', label: 'Execution Map' },
  { key: 'findings', label: 'Findings' },
  { key: 'workflows_page', label: 'Evidence' },
  { key: 'rules', label: 'Fix Plan' },
  { key: 'report', label: 'Report' },
] as const;
