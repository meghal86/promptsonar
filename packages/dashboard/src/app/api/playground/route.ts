import { NextResponse } from 'next/server';
import { 
  evaluatePrompt, 
  validatePromptAgainstContract
} from '@promptsonar/core';
import { supabase } from '@/lib/supabase';
import { checkUsageLimit, incrementScanUsage } from '@/lib/billing';

const MAX_PLAYGROUND_PROMPT_CHARS = 100_000;
const LARGE_SCAN_MESSAGE = 'This scan is too large for the web playground. Use the CLI for full repository scans: npx @promptsonar/cli scan .';
const RATE_LIMIT_MESSAGE = 'Rate limit reached. Please wait a moment and try again.';

function isRateLimitError(err: any): boolean {
  const status = err?.status || err?.code || err?.cause?.status;
  const message = String(err?.message || err || '').toLowerCase();
  return status === 429 || message.includes('429') || message.includes('too many requests') || message.includes('rate limit');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { promptText, contractYaml, variables } = body;
    let orgId = body.orgId;
    const localSandbox = !orgId;

    if (!promptText || typeof promptText !== 'string') {
      return NextResponse.json({ error: 'promptText must be a valid string' }, { status: 400 });
    }
    if (promptText.length > MAX_PLAYGROUND_PROMPT_CHARS) {
      return NextResponse.json({
        error: LARGE_SCAN_MESSAGE,
        code: 'PLAYGROUND_SCAN_TOO_LARGE',
        cli: 'npx @promptsonar/cli scan .',
      }, { status: 413 });
    }

    // 1. Resolve active Org ID
    if (!localSandbox && !orgId) {
      // Fetch or insert a default organization to guarantee smooth operation
      const { data: firstOrg, error: fetchError } = await supabase
        .from('orgs')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (firstOrg) {
        orgId = firstOrg.id;
      } else {
        const { data: newOrg, error: insertError } = await supabase
          .from('orgs')
          .insert({ name: 'Default Sandbox Org' })
          .select('id')
          .single();

        if (newOrg) {
          orgId = newOrg.id;
        } else {
          console.error('[Playground API] Failed to resolve org:', insertError);
          orgId = 'e3b0c442-98fc-4c14-b251-1234567890ab'; // Fallback uuid
        }
      }
    }

    // 2. Enforce Scan limit check (Free limit: 50 scans/mo max)
    if (!localSandbox) {
      const scanLimit = await checkUsageLimit(orgId, 'scan');
      if (!scanLimit.allowed) {
        return NextResponse.json({ error: scanLimit.reason }, { status: 403 });
      }
    }

    // 3. Optional: Enforce Policy/Contract limits (Disabled on Free plan)
    if (!localSandbox && contractYaml && contractYaml.trim().length > 0) {
      const policyLimit = await checkUsageLimit(orgId, 'policy');
      if (!policyLimit.allowed) {
        return NextResponse.json({ error: policyLimit.reason }, { status: 403 });
      }
    }

    // 4. Static Evaluation
    const evaluation = evaluatePrompt({
      text: promptText,
      context: { filePath: 'playground.ts' }
    });

    // 5. Optional: Prompt Rules validation
    let contractResult = null;
    if (contractYaml && typeof contractYaml === 'string' && contractYaml.trim().length > 0) {
      try {
        contractResult = validatePromptAgainstContract(promptText, contractYaml, variables || {});
      } catch (err: any) {
        contractResult = {
          passed: false,
          violations: [`Contract execution error: ${err.message}`],
          contractId: 'error'
        };
      }
    }

    // 6. Model comparison is manual-only. No provider calls or synthetic results are run here.
    const crossModelResult = null;

    // 7. Prompt optimization is not executed in this API. Do not return a fake rewrite.
    const estimatedTokens = Math.ceil(promptText.length / 4);
    const compression = {
      available: false,
      status: 'coming_soon',
      originalText: promptText,
      compressedText: '',
      originalTokens: estimatedTokens,
      compressedTokens: null,
      compressionRatio: null,
      message: 'Prompt Optimization is coming soon.'
    };
    const roi = {
      originalTokens: estimatedTokens,
      newTokens: estimatedTokens,
      compressionRatio: '0%',
      dollarsSavedPer10kCalls: 0
    };

    // 8. Increment monthly scan usage count in DB
    if (!localSandbox) {
      await incrementScanUsage(orgId);
    }

    return NextResponse.json({
      score: evaluation.score,
      status: evaluation.status,
      findings: evaluation.findings,
      contractResult,
      crossModelResult,
      compression,
      roi,
      mode: localSandbox ? 'local-sandbox' : 'tracked'
    });
  } catch (err: any) {
    console.error("Playground API error:", err);
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE, code: 'RATE_LIMITED' }, { status: 429 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
