import * as vscode from 'vscode';
import { RuleResult, Finding, calculateROI, compressPromptLLMLingua, generateHtmlReport } from 'core';

export class PromptSonarWebviewPanel {
    public static currentPanel: PromptSonarWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static async createOrShow(extensionUri: vscode.Uri, result: RuleResult, promptText: string) {
        const column = vscode.ViewColumn.Beside;

        if (PromptSonarWebviewPanel.currentPanel) {
            PromptSonarWebviewPanel.currentPanel._panel.reveal(column);
            await PromptSonarWebviewPanel.currentPanel.update(result, promptText);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'promptSonarReport',
            'Prompt Health Dashboard',
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'applyFix':
                        vscode.window.showInformationMessage('Applying Fix: ' + message.text);
                        return;
                }
            },
            null
        );

        PromptSonarWebviewPanel.currentPanel = new PromptSonarWebviewPanel(panel);
        await PromptSonarWebviewPanel.currentPanel.update(result, promptText);
    }

    public async update(result: RuleResult, promptText: string) {
        // Run compression to get ROI stats
        let roiHtml = '';
        try {
            const compressionResult = await compressPromptLLMLingua(promptText);
            const roi = calculateROI(compressionResult.originalTokens, compressionResult.compressedTokens);
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
        } catch (e) {
            roiHtml = `
            <div class="bg-slate-800 rounded-xl p-6 border border-slate-700 mt-6">
                <p class="text-slate-400 text-sm">LLMLingua compression unavailable. Run 'pip install llmlingua' to enable ROI calculation.</p>
            </div>`;
        }

        this._panel.title = `Score: ${result.score}`;

        // Use the shared report generator from core
        const html = generateHtmlReport(result, promptText, roiHtml);

        // Inject VS Code specific scripts
        const vscodeScript = `
            <script>
                const vscode = acquireVsCodeApi();
                function applyFix(text) {
                    vscode.postMessage({
                        command: 'applyFix',
                        text: text
                    });
                }
            </script>
        `;

        this._panel.webview.html = html.replace('</body>', `${vscodeScript}</body>`);
    }

    public dispose() {
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
