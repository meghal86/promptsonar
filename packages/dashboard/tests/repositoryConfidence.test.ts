import { describe, expect, it } from 'vitest';
import {
  confidenceDefinition,
  confidenceDefinitionRows,
} from '../src/lib/repositoryConfidence';

describe('repository confidence definitions', () => {
  it('displays the canonical evidence-based confidence meanings', () => {
    const report = {
      confidenceDefinitions: {
        confirmed: 'Direct evidence exists.',
        probable: 'Evidence inferred from connected relationships.',
        potential: 'Structural inference only.',
      },
    };

    expect(confidenceDefinitionRows(report)).toEqual([
      ['Confirmed', 'Direct evidence exists.'],
      ['Probable', 'Evidence inferred from connected relationships.'],
      ['Potential', 'Structural inference only.'],
    ]);
    expect(confidenceDefinition('Confirmed', report)).toBe('Direct evidence exists.');
    expect(confidenceDefinition('probable', report)).toBe('Evidence inferred from connected relationships.');
    expect(confidenceDefinition('Potential', report)).toBe('Structural inference only.');
  });
});
