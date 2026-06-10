type ConfidenceLevel = 'confirmed' | 'probable' | 'potential';

const DEFAULT_CONFIDENCE_DEFINITIONS: Record<ConfidenceLevel, string> = {
  confirmed: 'Direct evidence exists.',
  probable: 'Evidence inferred from connected relationships.',
  potential: 'Structural inference only.',
};

function normalizedConfidenceLevel(value: string): ConfidenceLevel {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'probable') return 'probable';
  return 'potential';
}

export function confidenceDefinition(value: string, report?: any): string {
  const level = normalizedConfidenceLevel(value);
  return report?.confidenceDefinitions?.[level] || DEFAULT_CONFIDENCE_DEFINITIONS[level];
}

export function confidenceDefinitionRows(report?: any): Array<[string, string]> {
  return [
    ['Confirmed', confidenceDefinition('confirmed', report)],
    ['Probable', confidenceDefinition('probable', report)],
    ['Potential', confidenceDefinition('potential', report)],
  ];
}
