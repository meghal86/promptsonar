export interface ModelEvalResult {
  model: string;
  safetyScore: number;
  structureScore: number;
  driftIndex: number;
  outputSample: string;
  regressions: string[];
}

export interface CrossModelEvalSummary {
  promptPath: string;
  modelsEvaluated: string[];
  safety_pass_rate: number;
  structure_compliance: number;
  regressions_detected: boolean;
  modelBreakdown: ModelEvalResult[];
}

/**
 * Live cross-model execution is intentionally unavailable until BYOK provider
 * calls are implemented. PromptSonar must not fabricate provider behavior.
 */
export async function runCrossModelEvaluation(
  _promptText?: string,
  _promptPath?: string,
  _models?: string[]
): Promise<CrossModelEvalSummary> {
  throw new Error(
    'Live model evaluation is not implemented. Use compareModels()/compareModelOutputs() with real pasted outputs, or add BYOK provider execution before calling this API.'
  );
}
