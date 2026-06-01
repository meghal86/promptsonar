import { ImageResponse } from 'next/og';
import { decodeReportPayload, type ExecutionPathReport } from '@/lib/reports/executionPathReport';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function readReport(payload?: string): ExecutionPathReport | null {
  if (!payload) return null;
  try {
    return decodeReportPayload(payload);
  } catch {
    try {
      return JSON.parse(payload) as ExecutionPathReport;
    } catch {
      return null;
    }
  }
}

export default async function Image({ searchParams }: { searchParams?: Promise<{ payload?: string }> }) {
  const params = await searchParams;
  const report = readReport(params?.payload);
  const path = report?.workflow?.summary || 'No execution path inferred';
  const risk = report?.workflow?.risk || 'none';
  const confidence = report ? `${report.confidence.score}% ${report.confidence.level}` : 'No report';
  const root = report?.root_cause?.rule_id || 'none';

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0f172a',
          color: 'white',
          padding: '62px',
          fontFamily: 'Arial',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '24px', letterSpacing: '5px', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 800 }}>
              PromptSonar
            </div>
            <div style={{ marginTop: '24px', fontSize: '68px', lineHeight: 1, fontWeight: 900 }}>
              Execution Path Review
            </div>
          </div>
          <div style={{ border: '2px solid #fb7185', borderRadius: '18px', padding: '18px 24px', color: '#fecdd3', fontSize: '28px', fontWeight: 900, textTransform: 'uppercase' }}>
            {risk}
          </div>
        </div>

        <div style={{ border: '1px solid #334155', borderRadius: '20px', background: '#111827', padding: '26px', fontSize: '34px', lineHeight: 1.25, fontWeight: 800 }}>
          {path}
        </div>

        <div style={{ display: 'flex', gap: '18px' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #334155', borderRadius: '18px', padding: '18px' }}>
            <div style={{ fontSize: '18px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 900 }}>Confidence</div>
            <div style={{ marginTop: '8px', fontSize: '34px', fontWeight: 900 }}>{confidence}</div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #334155', borderRadius: '18px', padding: '18px' }}>
            <div style={{ fontSize: '18px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 900 }}>Root Cause</div>
            <div style={{ marginTop: '8px', fontSize: '34px', fontWeight: 900 }}>{root}</div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
