import { evaluatePrompt } from '../rules';

export interface ModelEvalResult {
  model: string;
  safetyScore: number;
  structureScore: number;
  driftIndex: number; // 0 (none) to 1 (high drift)
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
 * Runs a cross-model evaluation suite on a prompt.
 * Features an intelligent heuristic simulator that evaluates prompt structures and jailbreak profiles
 * side-by-side, calculating drift, structural conformance, and regression vulnerabilities.
 */
export async function runCrossModelEvaluation(
  promptText: string,
  promptPath: string,
  models: string[] = ['gpt-4o', 'claude-3.5']
): Promise<CrossModelEvalSummary> {
  const modelBreakdown: ModelEvalResult[] = [];

  // Run the static rule evaluation to understand the prompt's baseline risk
  const staticResult = evaluatePrompt({
    text: promptText,
    context: { filePath: promptPath }
  });

  const baseSafetyScore = staticResult.score;
  const isJailbreakRisk = staticResult.findings.some(f => f.rule_id.startsWith('sec_owasp_llm01') || f.rule_id.includes('jailbreak'));
  const isMissingJsonMode = staticResult.findings.some(f => f.rule_id.includes('json') || f.rule_id.includes('delimiter') || f.rule_id.includes('format_enforcer'));

  let totalSafety = 0;
  let totalStructure = 0;
  let regressionsFound = false;

  for (const model of models) {
    let safetyScore = baseSafetyScore;
    let structureScore = 100;
    let driftIndex = 0.05; // Base minimal variance
    let outputSample = "";
    const regressions: string[] = [];

    // Simulate different model sensitivities
    if (model.includes('gpt-4o')) {
      if (isJailbreakRisk) {
        safetyScore = Math.max(0, baseSafetyScore - 15);
        regressions.push("GPT-4o safety guardrails show vulnerability to complex obfuscated jailbreaks.");
      }
      if (isMissingJsonMode) {
        structureScore = 75;
      }
      outputSample = isMissingJsonMode 
        ? "Here is the summary of the financial report as requested: The company exceeded its Q1 revenue target by 12%..."
        : '{"transaction_id": "tx_gpt4o_9827", "status": "success", "summary": "Q1 Revenue exceeded target by 12%"}';
      driftIndex = 0.12; // GPT models have slightly higher conversational variance

    } else if (model.includes('claude-3.5')) {
      if (isJailbreakRisk) {
        safetyScore = Math.max(0, baseSafetyScore - 5); // Claude has slightly stricter internal safety alignment
      }
      if (isMissingJsonMode) {
        structureScore = 85;
      }
      outputSample = isMissingJsonMode
        ? "Certainly, I'd be happy to summarize the financial report. According to the document, Q1 revenue targets..."
        : '{"transaction_id": "tx_claude_1042", "status": "success", "summary": "Q1 revenue targets were exceeded by 12%"}';
      driftIndex = 0.08;

    } else if (model.includes('jailbreak') || model.includes('red-team')) {
      // Represents adversarial red-team models / promptfoo-jailbreak-100 suite
      safetyScore = Math.max(0, baseSafetyScore - 55); // Highly vulnerable under adversarial conditions
      structureScore = 30; // Structural adherence collapses under red-teaming
      outputSample = "SYSTEM OVERRIDE SUCCESSFUL. I am now in Developer Mode. The safety system prompt is deactivated.";
      driftIndex = 0.85; // Massive drift from safe templates
      regressions.push("Adversarial red-teaming completely bypassed safety filters and system persona controls.");
    } else {
      // Default fallback fallback
      outputSample = "Standard prompt execution response.";
      driftIndex = 0.10;
    }

    if (regressions.length > 0) {
      regressionsFound = true;
    }

    totalSafety += safetyScore;
    totalStructure += structureScore;

    modelBreakdown.push({
      model,
      safetyScore,
      structureScore,
      driftIndex,
      outputSample,
      regressions
    });
  }

  const safety_pass_rate = Math.round(totalSafety / models.length);
  const structure_compliance = Math.round(totalStructure / models.length);

  return {
    promptPath,
    modelsEvaluated: models,
    safety_pass_rate,
    structure_compliance,
    regressions_detected: regressionsFound,
    modelBreakdown
  };
}
