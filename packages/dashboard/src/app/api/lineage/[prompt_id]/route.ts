import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ prompt_id: string }> }
) {
  const { prompt_id: promptId } = await params;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Return mock data for demo
    return NextResponse.json({
      prompt_id: promptId,
      status: 42,
      history: [
        { timestamp: new Date().toISOString(), event: "Scan Blocked (Severity: Critical)", rule: "sec_owasp_llm01_injection", commit: "a1b2c3d4" }
      ]
    });
  }

  // Fetch full historical lineage of a prompt hash
  const { data, error } = await supabase
    .from('prompts')
    .select('*, scans(commit_sha)')
    .eq('id', promptId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const history = data.map(d => ({
    timestamp: d.created_at,
    event: d.status === 'fail' ? "Vulnerability Introduced" : "Scan Blocked",
    rule: d.rule_id,
    commit: d.scans?.commit_sha || "Unknown"
  }));

  return NextResponse.json({
    prompt_id: promptId,
    status: data[0]?.score || 0,
    history
  });
}
