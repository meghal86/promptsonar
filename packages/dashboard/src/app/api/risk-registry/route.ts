import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Return mock data if unconfigured so dashboard doesn't crash
    return NextResponse.json({ 
      incidents: [
        { id: "e3b0c44298fc", project: "Payment Service", score: 42, rule: "sec_owasp_llm01_injection", status: "blocked", ts: new Date().toISOString() }
      ] 
    });
  }

  // Fetch highest risk prompts from Database
  const { data, error } = await supabase
    .from('prompts')
    .select('id, scan_id, score, rule_id, status, created_at')
    .lte('score', 70) // Only fetch high risk / failing
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const incidents = data.map(d => ({
    id: d.id,
    project: `Scan ${d.scan_id || 'Global'}`,
    score: d.score,
    rule: d.rule_id,
    status: d.status,
    ts: d.created_at
  }));

  return NextResponse.json({ incidents });
}
