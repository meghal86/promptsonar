# Model Behavior Comparison

Model Behavior Comparison compares real outputs that you provide for the same prompt. PromptSonar scans each output locally, scores the risky findings it contains, and reports how different each response is from the baseline response.

## What it does

- Compares two or more user-provided model outputs.
- Scans each output with the existing PromptSonar scanner.
- Computes Safety Score, Behavior Variance, findings count, and status.
- Runs locally without calling model providers.

## What it does not do

- It does not call GPT, Claude, Gemini, or any other provider by default.
- It does not use mock model cards or fabricated scores.
- It does not use embeddings or external similarity services.
- It does not change scanner logic.

## Manual workflow

1. Paste the original prompt.
2. Paste outputs from at least two models.
3. Choose an expected format if the response must be JSON, Markdown, or plain text.
4. Run the comparison.

The first model output is used as the baseline. Its Behavior Variance is always `0`.

## CLI usage

Compare a prompt file with an output directory:

```bash
promptsonar compare-models --prompt prompt.txt --outputs ./outputs
```

The output directory should contain one text file per model:

```text
outputs/
  gpt-4o.txt
  claude.txt
  gemini.txt
```

Compare from a JSON file:

```bash
promptsonar compare-models --input examples/model-comparison/comparison.json --format markdown
```

Supported formats:

- `table`
- `json`
- `markdown`

## Dashboard usage

Open `/models`, select **Start Manual Comparison**, paste the prompt and model outputs, then run the comparison.

The dashboard shows:

- Best model
- Riskiest model
- Average safety score
- Needs review count
- Per-model findings and status

## Metrics

**Safety Score**: out of 100. Higher means fewer risky findings.

**Behavior Variance**: `0 = identical responses`, `1 = very different`.

**Status**:

- `Stable`: no critical or high findings, score is at least 80, and variance is not high.
- `Needs Review`: high findings, score below 80, or variance above 0.35.
- `High Risk`: one or more critical findings.

## Privacy

Model comparison is local-first. PromptSonar does not make LLM calls, send telemetry, or call cloud services by default. Future live comparison should require explicit user-provided API keys and opt-in provider calls.

