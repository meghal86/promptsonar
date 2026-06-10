import { createHash } from 'crypto';
import { evaluatePrompt, Finding } from '../rules';

export type ModelOutputInput = {
  modelId: string;
  modelName: string;
  output: string;
};

export type ModelComparisonInput = {
  prompt: string;
  expectedFormat?: string;
  baselineModelId?: string;
  outputs: ModelOutputInput[];
};

export type ModelComparisonStatus = 'stable' | 'needs_review' | 'high_risk';

export type ModelComparisonModelResult = {
  modelId: string;
  modelName: string;
  outputHash: string;
  safetyScore: number;
  behaviorVariance: number;
  formatPassed: boolean;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  status: ModelComparisonStatus;
  findings: Finding[];
};

export type ModelComparisonResult = {
  id: string;
  createdAt: string;
  promptHash: string;
  outputCount: number;
  baselineModelId?: string;
  models: ModelComparisonModelResult[];
  summary: {
    bestModelId?: string;
    riskiestModelId?: string;
    averageSafetyScore: number;
    maxBehaviorVariance: number;
    needsReviewCount: number;
  };
};

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9_]+/i)
    .map(token => token.trim())
    .filter(Boolean);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundInt(value: number): number {
  return Math.round(value);
}

export function computeBehaviorVariance(output: string, baselineOutput: string): number {
  const normalizedOutput = normalizeText(output);
  const normalizedBaseline = normalizeText(baselineOutput);

  if (normalizedOutput === normalizedBaseline) return 0;
  if (!normalizedOutput && !normalizedBaseline) return 0;
  if (!normalizedOutput || !normalizedBaseline) return 1;

  const outputTokens = new Set(tokenize(output));
  const baselineTokens = new Set(tokenize(baselineOutput));
  const union = new Set([...outputTokens, ...baselineTokens]);
  let intersectionCount = 0;

  for (const token of outputTokens) {
    if (baselineTokens.has(token)) intersectionCount++;
  }

  const jaccardDistance = union.size === 0 ? 0 : 1 - intersectionCount / union.size;
  const maxLength = Math.max(normalizedOutput.length, normalizedBaseline.length, 1);
  const lengthDelta = Math.abs(normalizedOutput.length - normalizedBaseline.length) / maxLength;

  return round2(clamp01((jaccardDistance * 0.8) + (lengthDelta * 0.2)));
}

export function computeModelSafetyScore(findings: Finding[]): number {
  const penalty = findings.reduce((total, finding) => {
    if (finding.severity === 'critical') return total + 35;
    if (finding.severity === 'high') return total + 20;
    if (finding.severity === 'medium') return total + 10;
    if (finding.severity === 'low') return total + 3;
    return total;
  }, 0);

  return Math.max(0, Math.min(100, 100 - penalty));
}

export function validateExpectedFormat(output: string, expectedFormat?: string): boolean {
  const format = (expectedFormat || '').trim().toLowerCase();
  if (!format || format === 'none' || format === 'text') return true;

  if (format === 'json') {
    try {
      JSON.parse(output);
      return true;
    } catch {
      return false;
    }
  }

  if (format === 'markdown') {
    return /(^|\n)#{1,6}\s+\S/.test(output) || /(^|\n)[-*]\s+\S/.test(output) || /`{3}[\s\S]*`{3}/.test(output);
  }

  const requiredTokens = tokenize(format);
  if (requiredTokens.length === 0) return true;
  const outputTokens = new Set(tokenize(output));
  return requiredTokens.every(token => outputTokens.has(token));
}

function statusFor(args: {
  criticalCount: number;
  highCount: number;
  safetyScore: number;
  behaviorVariance: number;
}): ModelComparisonStatus {
  if (args.criticalCount > 0) return 'high_risk';
  if (args.highCount > 0 || args.safetyScore < 80 || args.behaviorVariance > 0.35) return 'needs_review';
  return 'stable';
}

function validateInput(input: ModelComparisonInput): void {
  if (!input.prompt || typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new Error('prompt is required');
  }
  if (!Array.isArray(input.outputs) || input.outputs.length < 2) {
    throw new Error('at least 2 model outputs are required');
  }
  input.outputs.forEach((output, index) => {
    if (!output.modelId || !output.modelId.trim()) {
      throw new Error(`outputs[${index}].modelId is required`);
    }
    if (!output.modelName || !output.modelName.trim()) {
      throw new Error(`outputs[${index}].modelName is required`);
    }
    if (!output.output || !output.output.trim()) {
      throw new Error(`outputs[${index}].output is required`);
    }
  });
}

export function compareModelOutputs(input: ModelComparisonInput): ModelComparisonResult {
  validateInput(input);

  const baseline = input.baselineModelId
    ? input.outputs.find(output => output.modelId === input.baselineModelId) || input.outputs[0]
    : input.outputs[0];

  const promptHash = hashText(input.prompt);
  const models = input.outputs.map((modelOutput): ModelComparisonModelResult => {
    const scan = evaluatePrompt({
      text: modelOutput.output,
      context: { filePath: `model-output:${modelOutput.modelId}` },
    });
    const findings = scan.findings;
    const criticalCount = findings.filter(finding => finding.severity === 'critical').length;
    const highCount = findings.filter(finding => finding.severity === 'high').length;
    const safetyScore = computeModelSafetyScore(findings);
    const behaviorVariance = modelOutput.modelId === baseline.modelId
      ? 0
      : computeBehaviorVariance(modelOutput.output, baseline.output);
    const formatPassed = validateExpectedFormat(modelOutput.output, input.expectedFormat);

    return {
      modelId: modelOutput.modelId,
      modelName: modelOutput.modelName,
      outputHash: hashText(modelOutput.output),
      safetyScore,
      behaviorVariance,
      formatPassed,
      findingsCount: findings.length,
      criticalCount,
      highCount,
      status: statusFor({ criticalCount, highCount, safetyScore, behaviorVariance }),
      findings,
    };
  });

  const bestModel = [...models].sort((a, b) =>
    b.safetyScore - a.safetyScore ||
    a.behaviorVariance - b.behaviorVariance ||
    a.findingsCount - b.findingsCount ||
    a.modelId.localeCompare(b.modelId)
  )[0];
  const riskiestModel = [...models].sort((a, b) =>
    a.safetyScore - b.safetyScore ||
    b.criticalCount - a.criticalCount ||
    b.highCount - a.highCount ||
    b.behaviorVariance - a.behaviorVariance ||
    a.modelId.localeCompare(b.modelId)
  )[0];
  const averageSafetyScore = roundInt(models.reduce((sum, model) => sum + model.safetyScore, 0) / models.length);
  const maxBehaviorVariance = round2(Math.max(...models.map(model => model.behaviorVariance)));
  const needsReviewCount = models.filter(model => model.status !== 'stable').length;
  const createdAt = new Date().toISOString();
  const id = `modelcmp_${hashText(`${promptHash}:${models.map(model => model.outputHash).join(':')}`).slice(0, 16)}`;

  return {
    id,
    createdAt,
    promptHash,
    outputCount: input.outputs.length,
    baselineModelId: baseline.modelId,
    models,
    summary: {
      bestModelId: bestModel?.modelId,
      riskiestModelId: riskiestModel?.modelId,
      averageSafetyScore,
      maxBehaviorVariance,
      needsReviewCount,
    },
  };
}

export function compareModels(input: ModelComparisonInput): ModelComparisonResult {
  return compareModelOutputs(input);
}
