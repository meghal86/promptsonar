// Single source of plain-language copy for the dashboard.
// Goal: anyone — engineer, PM, or non-technical reader — understands what a
// label means without prior PromptSonar vocabulary. Keep terms human and
// consistent; never show raw enum values to users.

export type Tone = "danger" | "warn" | "caution" | "safe" | "neutral";

// Trust verdict in human terms.
export function plainTrust(status?: string): { label: string; sub: string; tone: Tone } {
  switch (status) {
    case "High Risk":
      return { label: "Needs fixing", sub: "We found instructions that can reach a risky action.", tone: "danger" };
    case "Review Required":
      return { label: "Worth a look", sub: "A few things should be reviewed before you rely on this.", tone: "warn" };
    case "Trusted":
      return { label: "Looks safe", sub: "Nothing here can reach a risky action on its own.", tone: "safe" };
    default:
      return { label: status || "Not scanned", sub: "", tone: "neutral" };
  }
}

// Severity → human word + tone.
export function plainSeverity(severity = ""): { label: string; tone: Tone } {
  switch (severity.toLowerCase()) {
    case "critical":
      return { label: "Critical", tone: "danger" };
    case "high":
      return { label: "High", tone: "danger" };
    case "medium":
      return { label: "Medium", tone: "warn" };
    case "low":
      return { label: "Low", tone: "caution" };
    default:
      return { label: severity || "Info", tone: "neutral" };
  }
}

export function plainOverallRisk(risk?: string): { label: string; tone: Tone } {
  if (!risk || risk === "none") return { label: "No risk found", tone: "safe" };
  return plainSeverity(risk);
}

// Confidence: what "Confirmed / Probable / Potential" actually mean.
export function plainConfidence(level = ""): { label: string; meaning: string } {
  switch (level.toLowerCase()) {
    case "confirmed":
      return { label: "Confirmed", meaning: "We traced this all the way to a real action." };
    case "probable":
      return { label: "Likely", meaning: "Strong evidence — one step is inferred from how things connect." };
    case "potential":
      return { label: "Possible", meaning: "A structural possibility worth checking, not yet proven." };
    default:
      return { label: level || "Possible", meaning: "" };
  }
}

// Artifact / graph node types → plain names.
const ARTIFACT_LABELS: Record<string, string> = {
  PROMPT: "Prompt",
  AGENT_CONFIG: "Agent instructions",
  SKILL: "Skill",
  MCP_SERVER: "Connected tool (MCP)",
  TOOL: "Tool",
  WORKFLOW: "Automation",
  ACTION: "Action",
  MEMORY: "Saved memory",
};
export function plainArtifactType(type = ""): string {
  return ARTIFACT_LABELS[type] || type || "File";
}

// Sensitive actions → what the AI could actually do.
const ACTION_LABELS: Record<string, string> = {
  Shell: "Run commands",
  Filesystem: "Read or write files",
  Network: "Make network calls",
  Secrets: "Access secrets",
  "External APIs": "Call outside services",
};
export function plainAction(action = ""): string {
  return ACTION_LABELS[action] || action || "Sensitive action";
}

// Where a finding lives (provenance) → plain context label.
export function plainProvenance(provenance = "production"): { label: string; isProduction: boolean } {
  switch (provenance) {
    case "documentation":
      return { label: "In documentation", isProduction: false };
    case "test":
      return { label: "In tests", isProduction: false };
    case "fixture":
      return { label: "In test fixtures", isProduction: false };
    case "example":
      return { label: "In examples", isProduction: false };
    case "generated":
      return { label: "In generated code", isProduction: false };
    default:
      return { label: "In shipped code", isProduction: true };
  }
}

// Tailwind classes for a tone, used for pills and accents.
export function toneClasses(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "caution":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "safe":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-border bg-secondary text-muted-foreground";
  }
}

export function severityRank(severity = ""): number {
  return ({ critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[severity.toLowerCase()] || 0;
}

// Short human name for a finding's family, shown in the status line
// (e.g. "MCP tool poisoning"). Mirrors the engine's own categorization so the
// label always matches the plain-language issue text the analyzer produced.
const RULE_FAMILY: Array<{ test: RegExp; label: string }> = [
  { test: /poison|mcp|wildcard|auto.?approve|auto.?execute/, label: "MCP tool poisoning" },
  { test: /inject|jailbreak|override|evasion|rag/, label: "Prompt injection" },
  { test: /secret|credential|api.?key|password|token|pii/, label: "Secret exposure" },
  { test: /shell|command|exec/, label: "Command execution" },
  { test: /memory|persist|remember|session/, label: "Memory persistence" },
  { test: /permission|privile|escalation/, label: "Excess permissions" },
  { test: /workflow|autonomous|routing|sink/, label: "Unsafe automation" },
];
export function plainRuleFamily(ruleId = "", issue = ""): string {
  const signal = `${ruleId} ${issue}`.toLowerCase();
  for (const entry of RULE_FAMILY) if (entry.test.test(signal)) return entry.label;
  return "Security finding";
}

// One-line, non-technical headline for a finding. Presentation copy only — the
// canonical issue/impact/fix still come straight from the analyzer. Falls back
// to the analyzer's own plain-language issue text when no family matches.
const FINDING_HEADLINE: Array<{ test: RegExp; headline: string }> = [
  { test: /poison|mcp|wildcard|auto.?approve|auto.?execute/, headline: "This file lets a tool reach your system — and run without asking." },
  { test: /inject|jailbreak|override|evasion|rag/, headline: "Untrusted text can change what this AI does." },
  { test: /secret|credential|api.?key|password|token|pii/, headline: "This file can expose secrets or private data." },
  { test: /memory|persist|remember|session/, headline: "Unsafe instructions here can persist into future runs." },
  { test: /shell|command|exec|privile|escalation|sink|workflow|autonomous|routing/, headline: "Instructions here can trigger a real action on your system." },
];
export function plainFindingHeadline(ruleId = "", issue = ""): string {
  const signal = `${ruleId} ${issue}`.toLowerCase();
  for (const entry of FINDING_HEADLINE) if (entry.test.test(signal)) return entry.headline;
  return issue || "This file needs a security review.";
}
