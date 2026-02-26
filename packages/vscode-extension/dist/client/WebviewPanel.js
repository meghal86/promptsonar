"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptSonarWebviewPanel = void 0;
const vscode = __importStar(require("vscode"));
const core_1 = require("core");
class PromptSonarWebviewPanel {
    static currentPanel;
    _panel;
    _disposables = [];
    constructor(panel) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }
    static async createOrShow(extensionUri, result, promptText) {
        const column = vscode.ViewColumn.Beside;
        if (PromptSonarWebviewPanel.currentPanel) {
            PromptSonarWebviewPanel.currentPanel._panel.reveal(column);
            await PromptSonarWebviewPanel.currentPanel.update(result, promptText);
            return;
        }
        const panel = vscode.window.createWebviewPanel('promptSonarReport', 'Prompt Health Dashboard', column, {
            enableScripts: true,
            localResourceRoots: [extensionUri]
        });
        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'applyFix':
                    vscode.window.showInformationMessage('Applying Fix: ' + message.text);
                    return;
            }
        }, null);
        PromptSonarWebviewPanel.currentPanel = new PromptSonarWebviewPanel(panel);
        await PromptSonarWebviewPanel.currentPanel.update(result, promptText);
    }
    async update(result, promptText) {
        // Run compression to get ROI stats
        let roiHtml = '';
        try {
            const compressionResult = await (0, core_1.compressPromptLLMLingua)(promptText);
            const roi = (0, core_1.calculateROI)(compressionResult.originalTokens, compressionResult.compressedTokens);
            roiHtml = `
            <div class="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg mt-6">
                <h2 class="text-xl font-semibold text-emerald-400 mb-4 flex items-center">
                    <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                    Efficiency & ROI Calculator
                </h2>
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-slate-900/50 p-4 rounded-lg">
                        <div class="text-slate-400 text-sm mb-1">Original Tokens</div>
                        <div class="text-2xl font-mono text-slate-200">${roi.originalTokens}</div>
                    </div>
                    <div class="bg-slate-900/50 p-4 rounded-lg">
                        <div class="text-slate-400 text-sm mb-1">LLMLingua Tokens</div>
                        <div class="text-2xl font-mono text-emerald-400">${roi.newTokens}</div>
                    </div>
                    <div class="bg-slate-900/50 p-4 rounded-lg">
                        <div class="text-slate-400 text-sm mb-1">Compression</div>
                        <div class="text-2xl font-mono text-blue-400">-${roi.compressionRatio}</div>
                    </div>
                    <div class="bg-slate-900/50 p-4 rounded-lg border border-emerald-500/30">
                        <div class="text-emerald-500/80 text-sm mb-1 font-semibold">Savings per 10k Calls</div>
                        <div class="text-2xl font-bold text-emerald-400">$${roi.dollarsSavedPer10kCalls.toFixed(2)}</div>
                    </div>
                </div>
            </div>`;
        }
        catch (e) {
            roiHtml = `
            <div class="bg-slate-800 rounded-xl p-6 border border-slate-700 mt-6">
                <p class="text-slate-400 text-sm">LLMLingua compression unavailable. Run 'pip install llmlingua' to enable ROI calculation.</p>
            </div>`;
        }
        this._panel.title = `Score: ${result.score}`;
        this._panel.webview.html = this._getHtmlForWebview(result, roiHtml);
    }
    _getHtmlForWebview(result, roiHtml) {
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
                        <button onclick="applyFix('${f.suggested_fix?.replace(/'/g, "\\'")}')" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm font-medium transition-colors">
                            Apply Fix
                        </button>
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
        result.findings.forEach(f => { if (categories[f.category] !== undefined)
            categories[f.category]++; });
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
    <title>Prompt Health Dashboard</title>
</head>
<body class="bg-slate-900 text-slate-200 p-6 min-h-screen font-sans antialiased">
    <div class="max-w-5xl mx-auto">
        <!-- Header Section -->
        <div class="flex items-center justify-between mb-8 pb-6 border-b border-slate-700">
            <div>
                <h1 class="text-3xl font-bold text-white tracking-tight flex items-center">
                    Prompt Health Dashboard
                </h1>
                <p class="text-slate-400 mt-2">Comprehensive static analysis and ROI estimation.</p>
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

        <!-- Vulnerabilities List -->
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
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        function applyFix(text) {
            vscode.postMessage({
                command: 'applyFix',
                text: text
            });
        }
    </script>
</body>
</html>`;
    }
    dispose() {
        PromptSonarWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
exports.PromptSonarWebviewPanel = PromptSonarWebviewPanel;
//# sourceMappingURL=WebviewPanel.js.map