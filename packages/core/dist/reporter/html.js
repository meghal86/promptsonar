"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateHtmlReport = generateHtmlReport;
/**
 * Generates a standalone HTML report based on the scan results.
 * This matches the visual style of the PromptSonar VS Code Extension dashboard.
 */
function generateHtmlReport(result, promptText, roiHtml = '') {
    const scoreColor = result.score >= 85 ? 'text-emerald-400' : (result.score >= 70 ? 'text-amber-400' : 'text-rose-500');
    const scoreBg = result.score >= 85 ? 'bg-emerald-400/10 border-emerald-400/20' : (result.score >= 70 ? 'bg-amber-400/10 border-amber-400/20' : 'bg-rose-500/10 border-rose-500/20');
    let vulnerabilitiesHtml = '';
    if (result.findings.length > 0) {
        vulnerabilitiesHtml = result.findings.map(f => {
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
                            ${f.file ? `<span class="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-xs font-mono ml-2 border border-indigo-500/30">${f.file}</span>` : ''}
                        </div>
                        <p class="text-slate-300 mb-2">${f.explanation}</p>
                        <p class="text-emerald-400/90 text-sm"><span class="font-semibold text-emerald-500">Fix:</span> ${f.suggested_fix}</p>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
    else {
        vulnerabilitiesHtml = `<div class="p-8 text-center text-slate-400">No vulnerabilities or issues found. This prompt is pristine!</div>`;
    }
    // Tally category hits
    const categories = {
        security: 0, clarity: 0, structure: 0, best_practices: 0, consistency: 0, efficiency: 0, safety: 0
    };
    result.findings.forEach(f => {
        if (categories[f.category] !== undefined) {
            categories[f.category]++;
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
                <h3 class="font-semibold text-slate-200">Identified Findings (${result.findings.length})</h3>
            </div>
            <div class="divide-y divide-slate-700/50">
                ${vulnerabilitiesHtml}
            </div>
        </div>

        <!-- ROI Calculator Section -->
        ${roiHtml}

        <footer class="mt-12 pt-6 border-t border-slate-800 text-center text-slate-500 text-sm">
            Generated by PromptSonar v1.0.23 — ${new Date().toLocaleString()}
        </footer>
    </div>
</body>
</html>`;
}
