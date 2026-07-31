import {
    evaluateRepositoryWithClosure,
    LocalCheckoutSource,
} from '@promptsonar/core';

export function useClosureScanSetting(config: { get<T>(key: string, defaultValue: T): T }): boolean {
    return config.get<boolean>('useClosureScan', false) === true;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function repositoryCompletenessHtml(report: any): string {
    const completeness = report?.completeness;
    if (!completeness) return '';

    return `<section id="completeness">
        <h2>Scan Completeness</h2>
        <div class="cards">
          <div class="card"><div class="metric">${escapeHtml(completeness.coverageStatus)}</div><div class="label">Coverage Status</div></div>
          <div class="card"><div class="metric">${escapeHtml(completeness.files?.selected ?? 0)}</div><div class="label">Selected</div></div>
          <div class="card"><div class="metric">${escapeHtml(completeness.files?.fetched ?? 0)}</div><div class="label">Fetched</div></div>
          <div class="card"><div class="metric">${escapeHtml(completeness.files?.analyzed ?? 0)}</div><div class="label">Analyzed</div></div>
          <div class="card"><div class="metric">${escapeHtml(completeness.capabilities?.unresolved ?? 0)}</div><div class="label">Unresolved Control Context</div></div>
        </div>
        <p class="muted">${escapeHtml(completeness.coverageReason || '')}</p>
      </section>`;
}

export async function buildClosureRepositoryExecutionReport(
    root: string,
    options: { maxWorkspaceScanFiles: number; maxFileSizeBytes: number; maxDurationMs?: number; maxReferenceDepth?: number },
): Promise<any> {
    const maxFiles = Math.max(1, options.maxWorkspaceScanFiles);
    const maxFileSizeBytes = Math.max(1, options.maxFileSizeBytes);
    const closure = await evaluateRepositoryWithClosure({
        rootPath: root,
        source: new LocalCheckoutSource(root),
        budget: {
            maxFiles,
            maxBytes: maxFiles * maxFileSizeBytes,
            maxCharacters: maxFileSizeBytes,
            maxDurationMs: options.maxDurationMs ?? 30_000,
            maxReferenceDepth: options.maxReferenceDepth ?? 2,
        },
        mode: 'bounded',
        profileEvidence: { signals: [] },
    });
    return closure.report;
}
