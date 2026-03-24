import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { prompt_id: string } }
) {
  const promptId = params.prompt_id;

  // Mock Forensic Lineage Data for Phase 3 Demo
  const history = [
    {
      timestamp: new Date().toISOString(),
      event: "Scan Blocked (Severity: Critical)",
      rule: "sec_owasp_llm01_injection",
      commit: "a1b2c3d4",
      author: "security-bot"
    },
    {
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      event: "Vulnerability Introduced",
      rule: "sec_owasp_llm01_injection",
      commit: "8f9a0b1c",
      author: "dev-team-alpha"
    },
    {
      timestamp: new Date(Date.now() - 172800000).toISOString(),
      event: "Prompt Created (Clean)",
      rule: "none",
      commit: "1a2b3c4d",
      author: "prompt-engineer"
    }
  ];

  return NextResponse.json({
    prompt_id: promptId,
    status: 42,
    history
  });
}
