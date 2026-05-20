import { NextResponse } from 'next/server';
import { 
  evaluatePrompt, 
  compressPromptLLMLingua, 
  calculateROI,
  validatePromptAgainstContract,
  runCrossModelEvaluation
} from '@promptsonar/core';
import { supabase } from '@/lib/supabase';
import { checkUsageLimit, incrementScanUsage } from '@/lib/billing';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { promptText, contractYaml, variables, runCrossModel, models } = body;
    let orgId = body.orgId;

    if (!promptText || typeof promptText !== 'string') {
      return NextResponse.json({ error: 'promptText must be a valid string' }, { status: 400 });
    }

    // 1. Resolve active Org ID
    if (!orgId) {
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
    const scanLimit = await checkUsageLimit(orgId, 'scan');
    if (!scanLimit.allowed) {
      return NextResponse.json({ error: scanLimit.reason }, { status: 403 });
    }

    // 3. Optional: Enforce Policy/Contract limits (Disabled on Free plan)
    if (contractYaml && contractYaml.trim().length > 0) {
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

    // 5. Optional: Contract Validation
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

    // 6. Optional: Cross-Model Evaluation
    let crossModelResult = null;
    if (runCrossModel) {
      try {
        const modelList = Array.isArray(models) ? models : ['gpt-4o', 'claude-3.5'];
        crossModelResult = await runCrossModelEvaluation(promptText, 'playground.ts', modelList);
      } catch (err: any) {
        console.error("Cross-model eval failed:", err);
      }
    }

    // 7. Enforce Rule QF-4: Token estimate only, compression pending license
    const estimatedTokens = Math.ceil(promptText.length / 4);
    const compression = {
      originalText: promptText,
      compressedText: `Token estimate: ~${estimatedTokens} tokens (compression pending license)`,
      originalTokens: estimatedTokens,
      compressedTokens: estimatedTokens,
      compressionRatio: "0%"
    };
    const roi = calculateROI(compression.originalTokens, compression.compressedTokens);

    // 8. Increment monthly scan usage count in DB
    await incrementScanUsage(orgId);

    return NextResponse.json({
      score: evaluation.score,
      status: evaluation.status,
      findings: evaluation.findings,
      contractResult,
      crossModelResult,
      compression,
      roi
    });
  } catch (err: any) {
    console.error("Playground API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
