import { describe, expect, it } from 'vitest';
import { runCrossModelEvaluation } from '../src/evaluation/crossModel';

describe('Cross-Model Evaluation Engine', () => {
  it('does not fabricate live model evaluation results', async () => {
    await expect(runCrossModelEvaluation()).rejects.toThrow(
      'Live model evaluation is not implemented'
    );
  });
});
