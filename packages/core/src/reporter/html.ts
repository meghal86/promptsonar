import { RuleResult } from '../rules';

/**
 * Generates a standalone HTML report based on the scan results.
 * This matches the visual style of the PromptSonar VS Code Extension dashboard.
 */
export function generateHtmlReport(result: RuleResult, promptText: string, roiHtml: string = ''): string {
    const scoreColor = result.score >= 85 ? 'text-emerald-400' : (result.score >= 70 ? 'text-amber-400' : 'text-rose-500');
    const scoreBg = result.score >= 85 ? 'bg-emerald-400/10 border-emerald-400/20' : (result.score >= 70 ? 'bg-amber-400/10 border-amber-400/20' : 'bg-rose-500/10 border-rose-500/20');
    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const displayLimit = 200;
    const sortedFindings = [...result.findings].sort((a, b) => {
        const severityDelta = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
        if (severityDelta !== 0) return severityDelta;
        return a.rule_id.localeCompare(b.rule_id);
    });
    const displayedFindings = sortedFindings.slice(0, displayLimit);
    const omittedCount = Math.max(0, result.findings.length - displayedFindings.length);
    const scanSummary = (result as any).scan_summary;
    const summarizedCount = Number(scanSummary?.findings_summarized || 0);
    const uniqueFindingCount = Number(scanSummary?.findings_unique || result.findings.length);
    const repeatedFindingCount = Number(scanSummary?.findings_repeated || 0);

    let vulnerabilitiesHtml = '';
    if (displayedFindings.length > 0) {
        vulnerabilitiesHtml = displayedFindings.map(f => {
            const badgeColor = f.severity === 'critical' ? 'bg-rose-500 text-white' :
                f.severity === 'high' ? 'bg-orange-500 text-white' :
                    f.severity === 'medium' ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white';

            return `
            <div class="border-b border-slate-700/50 p-4 hover:bg-slate-800/50 transition-colors">
                <div class="flex items-start justify-between">
                    <div>
                        <div class="flex items-center gap-3 mb-2">
                            <span class="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${badgeColor}">${f.severity}</span>
                            <span class="text-slate-300 font-medium">${f.category.replace('_', ' ').toUpperCase()}</span>
                            <span class="text-slate-500 text-sm font-mono">${f.rule_id}</span>
                            ${(f as any).file ? `<span class="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-xs font-mono ml-2 border border-indigo-500/30">${(f as any).file}${(f as any).line ? `:${(f as any).line}` : ''}</span>` : ''}
                        </div>
                        <p class="text-slate-300 mb-2">${f.explanation}</p>
                        <p class="text-emerald-400/90 text-sm"><span class="font-semibold text-emerald-500">Fix:</span> ${f.suggested_fix}</p>
                    </div>
                </div>
            </div>`;
        }).join('');
        if (omittedCount > 0) {
            vulnerabilitiesHtml += `
            <div class="p-4 bg-slate-900/70 text-slate-400 text-sm">
                Showing the top ${displayLimit} findings by severity. ${omittedCount} lower-priority findings were omitted from this visual report; use JSON or SARIF output for the full machine-readable result.
            </div>`;
        }
        if (summarizedCount > 0) {
            vulnerabilitiesHtml += `
            <div class="p-4 bg-slate-900/70 text-slate-400 text-sm">
                Showing top findings. ${summarizedCount} additional lower-priority findings were summarized by file-level caps.
            </div>`;
        }
    } else {
        vulnerabilitiesHtml = `<div class="p-8 text-center text-slate-400">No vulnerabilities or issues found. This prompt is pristine!</div>`;
    }

    // Tally category hits
    const categories = {
        security: 0, clarity: 0, structure: 0, best_practices: 0, consistency: 0, efficiency: 0, safety: 0
    };
    result.findings.forEach(f => {
        if (categories[f.category as keyof typeof categories] !== undefined) {
            categories[f.category as keyof typeof categories]++;
        }
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
    </style>
    <title>PromptSonar Health Dashboard</title>
</head>
<body class="bg-slate-900 text-slate-200 p-6 min-h-screen antialiased">
    <div class="max-w-5xl mx-auto">
        <!-- Header Section -->
        <div class="flex items-center justify-between mb-8 pb-6 border-b border-slate-700">
            <div>
                <h1 class="text-3xl font-bold text-white tracking-tight flex items-center">
                    <svg class="w-8 h-8 mr-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                    Prompt Health Dashboard
                </h1>
                <p class="text-slate-400 mt-2">Comprehensive static analysis and ROI estimation provided by PromptSonar.</p>
            </div>
            <div class="text-center">
                <div class="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-1">Total Score</div>
                <div class="w-32 h-32 rounded-full flex items-center justify-center border-4 ${scoreBg} ${scoreColor}">
                    <span class="text-5xl font-bold">${result.score}</span>
                </div>
            </div>
        </div>

        <!-- 7-Pillar Grid -->
        ${scanSummary ? `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <div class="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div class="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">Files scanned</div>
                <div class="text-2xl font-mono text-slate-100">${scanSummary.files_scanned}</div>
            </div>
            <div class="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div class="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">Files skipped</div>
                <div class="text-2xl font-mono text-slate-100">${scanSummary.files_skipped}</div>
            </div>
            <div class="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div class="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">Unique findings</div>
                <div class="text-2xl font-mono text-amber-400">${uniqueFindingCount}</div>
            </div>
            <div class="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div class="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">Repeated collapsed</div>
                <div class="text-2xl font-mono text-slate-100">${repeatedFindingCount}</div>
            </div>
        </div>` : ''}

        <!-- 7-Pillar Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
            ${Object.entries(categories).map(([cat, count]) => `
            <div class="bg-slate-800 rounded-lg p-3 border border-slate-700 text-center">
                <div class="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 truncate">${cat.replace('_', ' ')}</div>
                <div class="text-xl font-mono ${count > 0 ? 'text-amber-400' : 'text-emerald-400'}">
                    ${count > 0 ? count + ' issues' : 'Pass'}
                </div>
            </div>`).join('')}
        </div>

        <!-- Findigns List -->
        <div class="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-xl">
            <div class="bg-slate-800/80 px-4 py-3 border-b border-slate-700">
                <h3 class="font-semibold text-slate-200">Identified Findings (${result.findings.length}${omittedCount > 0 ? `, showing top ${displayLimit}` : ''})</h3>
            </div>
            <div class="divide-y divide-slate-700/50">
                ${vulnerabilitiesHtml}
            </div>
        </div>

        <!-- ROI Calculator Section -->
        ${roiHtml}

        <footer class="mt-12 pt-6 border-t border-slate-800 text-center text-slate-500 text-sm">
            Generated by PromptSonar v1.4.3 - ${new Date().toLocaleString()}
        </footer>
    </div>
</body>
</html>`;
}
