import * as path from 'path';
import * as crypto from 'crypto';
import { workspace, ExtensionContext, window, StatusBarAlignment, StatusBarItem, ThemeColor, commands, Uri, languages, CodeLens, Range } from 'vscode';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { PromptSonarWebviewPanel } from './WebviewPanel';
import { PromptSonarCodeLensProvider } from './CodeLensProvider';
import { PromptSonarSidebarProvider } from './SidebarProvider';
import { ExecutionPathProvider } from './ExecutionPathProvider';
import { PromptSonarQuickFixProvider } from './QuickFixProvider';
import { isScannable, isMcpConfigFile } from '../shared/detection';
import { isPromptSonarIgnoredPath, parsePromptSonarIgnore, PromptSonarIgnoreMatcher } from '../shared/ignore';
import { executionPathText, pickWorstWorkflowFinding, reportText } from '../shared/model';
import { applyAllFixes, workflowDiffReport, workflowDiffReportBetween } from '../shared/quickfix';
// @ts-ignore
import { parseFile, evaluatePrompt, compressPromptLLMLingua, auditMcpConfig, formatToSarif, analyzeRepositoryExecution } from '@promptsonar/core';

let client: LanguageClient;

// Incremental scan cache: stores content hash + results per file to skip unchanged files on repeat scans
interface CachedScanEntry {
    contentHash: string;
    findings: any[];
    score: number;
    scores?: number[];
    promptsEvaluated: number;
    combinedText: string;
}
const scanCache = new Map<string, CachedScanEntry>();

function summarizeWorkspaceScore(scores: number[], findings: any[]): { score: number; status: 'pass' | 'warn' | 'fail' } {
    if (scores.length === 0) return { score: 100, status: 'pass' };

    const avgScore = Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
    const worstScore = Math.min(...scores);
    const activeFindings = findings.filter(finding => !finding.waived);

    let score = Math.min(avgScore, worstScore);
    let status: 'pass' | 'warn' | 'fail' = score < 70 ? 'fail' : score < 85 ? 'warn' : 'pass';

    if (activeFindings.some(finding => finding.severity === 'critical')) {
        score = Math.min(score, 49);
        status = 'fail';
    } else if (activeFindings.some(finding => finding.severity === 'high' && (finding.category === 'security' || finding.category === 'ethics'))) {
        score = Math.min(score, 69);
        status = 'fail';
    } else if (activeFindings.some(finding => finding.severity === 'medium' && (finding.category === 'security' || finding.category === 'ethics'))) {
        score = Math.min(score, 84);
        if (status === 'pass') status = 'warn';
    }

    return { score, status };
}

function hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

const SUPPORTED_LANGUAGES = new Set([
    'python', 'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
    'go', 'java', 'rust', 'csharp'
]);

const WORKSPACE_SCAN_GLOB = '**/*.{ts,tsx,js,jsx,py,go,java,rs,cs,prompt,ai,chat,json,yml,yaml}';
const WORKSPACE_SCAN_EXCLUDE_GLOB = '**/{node_modules,dist,out,build,coverage,.next,.turbo,.vercel,.cache,.pytest_cache,.git,.vscode-test,tests,test,__tests__,docs,evidence,benchmarks,results,tmp,logs,scratch,examples}/**';

const PROMPTSONAR_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
    { scheme: 'file', language: 'python' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'javascriptreact' },
    { scheme: 'file', language: 'go' },
    { scheme: 'file', language: 'java' },
    { scheme: 'file', language: 'rust' },
    { scheme: 'file', language: 'csharp' },
    { scheme: 'file', language: 'markdown' },
    { scheme: 'file', language: 'plaintext' },
    { scheme: 'file', language: 'json' },
    { scheme: 'file', language: 'yaml' },
    { scheme: 'file', pattern: '**/*.{prompt,md,txt,json,yml,yaml}' },
];

const SUPPORTED_MARKDOWN_PROMPT_FILES = new Set([
    'skill.md',
    'skills.md',
    'agent.md',
    'agents.md',
]);

const WORKSPACE_EXCLUDE_SEGMENTS = [
    'node_modules',
    'dist',
    'out',
    'build',
    'coverage',
    '.next',
    '.turbo',
    '.vercel',
    '.cache',
    '.pytest_cache',
    '.git',
    '.vscode-test',
    'tests',
    'test',
    '__tests__',
    'docs',
    'evidence',
    'benchmarks',
    'examples',
    'examples/reports',
    'agentsabha-angigravity',
    'custom-writer-skill',
    'my-writer-agent',
    'scratch',
    'results',
    'tmp',
    'logs',
    // PromptSonar's own implementation stores detector strings and simulated
    // model outputs here; they are not application prompts.
    'packages/core/src/rules',
    'packages/core/src/mcp',
    'packages/core/src/evaluation',
    'packages/core/src/parser',
    'packages/core/src/workflow',
    'packages/vscode-extension/src/client',
];

const WORKSPACE_EXCLUDE_PATH_PARTS = [
    '/packages/cli/src/mcpauditor.ts',
    '/action/src/action.ts',
    '/packages/dashboard/src/app/playground/page.tsx',
    '/packages/dashboard/src/app/playground1/page.tsx',
    '/packages/dashboard/src/app/playground3/page.tsx',
    '/packages/dashboard/src/app/try/page.tsx',
];

const WORKSPACE_EXCLUDE_FILE_SUFFIXES = [
    '.min.js',
    '.bundle.js',
    '.chunk.js',
    '.compiled.js',
    '.hot-update.js',
    '.map',
    '.d.ts.map',
    '.min.css',
    '.bundle.css',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.ico',
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
    '.log',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
];

const WORKSPACE_EXCLUDE_FILE_PREFIXES = [
    'demo_',
    'dummy_test.',
    'generate_test.',
    'generate_tests.',
    'generate_dummies.',
    'debug_',
    'test_',
    'test_parser.',
    'test_parse.',
];

function isIgnoredWorkspaceFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const basename = path.basename(normalized);

    if (WORKSPACE_EXCLUDE_FILE_SUFFIXES.some(suffix => basename.endsWith(suffix))) {
        return true;
    }

    if (WORKSPACE_EXCLUDE_FILE_PREFIXES.some(prefix => basename.startsWith(prefix))) {
        return true;
    }

    if (WORKSPACE_EXCLUDE_PATH_PARTS.some(part => normalized.includes(part))) {
        return true;
    }

    return WORKSPACE_EXCLUDE_SEGMENTS.some(segment => normalized.includes(`/${segment}/`));
}

async function loadWorkspaceIgnoreMatchers(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<PromptSonarIgnoreMatcher[]> {
    const matchers: PromptSonarIgnoreMatcher[] = [];

    for (const folder of workspaceFolders) {
        for (const fileName of ['.gitignore', '.promptsonarignore']) {
            try {
                const ignoreUri = Uri.joinPath(folder.uri, fileName);
                const fileData = await workspace.fs.readFile(ignoreUri);
                const content = Buffer.from(fileData).toString('utf8');
                matchers.push(parsePromptSonarIgnore(content, folder.uri.fsPath));
            } catch {
                // Ignore files are optional.
            }
        }
    }

    return matchers;
}

function isSupportedLanguage(languageId: string, fileName?: string, content?: string): boolean {
    return SUPPORTED_LANGUAGES.has(languageId) || Boolean(fileName && isScannable(fileName, content));
}

export function activate(context: ExtensionContext) {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join('dist', 'server', 'server.js')
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector: PROMPTSONAR_DOCUMENT_SELECTOR as any,
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Explicitly register a CodeLens Provider on the client side just in case the LSP capabilities map fails
    context.subscriptions.push(
        languages.registerCodeLensProvider(
            PROMPTSONAR_DOCUMENT_SELECTOR,
            new PromptSonarCodeLensProvider()
        )
    );

    context.subscriptions.push(
        languages.registerCodeActionsProvider(
            PROMPTSONAR_DOCUMENT_SELECTOR,
            new PromptSonarQuickFixProvider(),
            { providedCodeActionKinds: PromptSonarQuickFixProvider.providedKinds }
        )
    );

    // Create the language client and start the client.
    client = new LanguageClient(
        'promptsonarLSP',
        'PromptSonar Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();

    // Auto-trigger on file OPEN
    context.subscriptions.push(
        workspace.onDidOpenTextDocument(doc => {
            if (isSupportedLanguage(doc.languageId, doc.fileName, doc.getText())) {
                // The server will auto-validate via onDidChangeContent,
                // but we explicitly request validation on open too
                client.sendNotification('promptsonar/requestValidation', { uri: doc.uri.toString() });
            }
        })
    );

    // Auto-refresh on file SAVE (< 2 seconds target)
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(doc => {
            if (isSupportedLanguage(doc.languageId, doc.fileName, doc.getText())) {
                client.sendNotification('promptsonar/requestValidation', { uri: doc.uri.toString() });
            }
        })
    );

    // Create Status Bar Item
    const statusBarItem: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Register Sidebar Tree Provider
    const sidebarProvider = new PromptSonarSidebarProvider(context);
    window.registerTreeDataProvider('promptsonar-explorer', sidebarProvider);
    const executionPathProvider = new ExecutionPathProvider();
    window.registerTreeDataProvider('promptsonar-execution-path', executionPathProvider);

    let executionPathTimer: NodeJS.Timeout | undefined;
    const refreshExecutionPath = (doc?: vscode.TextDocument) => {
        if (executionPathTimer) clearTimeout(executionPathTimer);
        const debounceMs = workspace.getConfiguration('promptsonar').get<number>('debounceMs', 300);
        executionPathTimer = setTimeout(() => executionPathProvider.update(doc), debounceMs);
    };

    if (window.activeTextEditor) {
        refreshExecutionPath(window.activeTextEditor.document);
    }

    context.subscriptions.push(
        window.onDidChangeActiveTextEditor(editor => refreshExecutionPath(editor?.document)),
        workspace.onDidChangeTextDocument(event => {
            if (window.activeTextEditor?.document.uri.toString() === event.document.uri.toString()) {
                refreshExecutionPath(event.document);
            }
        })
    );

    // Listen for custom notifications from the server
    client.onNotification('promptsonar/scanResult', (params: { score: number | null, file: string, tokenEstimate?: number }) => {
        if (params.score !== null) {
            // Enhanced status bar with icon variants per FRD v5.0
            let icon = '$(shield-check)';
            if (params.score < 70) {
                icon = '$(shield-x)';
                statusBarItem.color = new ThemeColor('errorForeground');
            } else if (params.score < 90) {
                icon = '$(shield)';
                statusBarItem.color = new ThemeColor('issues.warning');
            } else {
                statusBarItem.color = undefined;
            }

            const tokenInfo = params.tokenEstimate ? ` | ⚡ ~${params.tokenEstimate} tokens` : '';
            statusBarItem.text = `${icon} Prompt Health: ${params.score}/100${tokenInfo}`;
            statusBarItem.tooltip = `PromptSonar Score: ${params.score}/100${tokenInfo}\nClick to open Problems panel`;
            statusBarItem.command = 'workbench.actions.view.problems';
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    });

    async function scanActiveDocument(): Promise<{ document: vscode.TextDocument; findings: any[]; mcpAudit?: any; result: any; text: string } | undefined> {
        const editor = window.activeTextEditor;
        if (!editor) {
            window.showErrorMessage('No active file.');
            return undefined;
        }

        const document = editor.document;
        const text = document.getText();
        if (!isScannable(document.fileName, text)) {
            window.showInformationMessage('Open a prompt, agent, system prompt, or MCP config file first.');
            return undefined;
        }

        const maxFileSizeBytes = workspace.getConfiguration('promptsonar').get<number>('maxFileSizeBytes', 1048576);
        if (Buffer.byteLength(text, 'utf8') > maxFileSizeBytes) {
            window.showWarningMessage(`PromptSonar skipped ${path.basename(document.fileName)} because it is larger than ${maxFileSizeBytes} bytes.`);
            return undefined;
        }

        let findings: any[] = [];
        let mcpAudit: any | undefined;
        if (isMcpConfigFile(document.fileName)) {
            mcpAudit = auditMcpConfig(document.fileName, text);
            findings = mcpAudit.findings.map((finding: any) => ({
                rule_id: finding.rule_id,
                category: 'security',
                severity: finding.severity,
                explanation: finding.message,
                suggested_fix: finding.fix,
                workflow: finding.workflow,
            }));
        } else {
            const prompts = await parseFile({ filePath: document.fileName, content: text, language: '' });
            for (const prompt of prompts) {
                const evaluation = evaluatePrompt({ text: prompt.text, context: { filePath: document.fileName } });
                findings.push(...evaluation.findings);
            }
        }

        const score = findings.some(f => f.severity === 'critical') ? 40
            : findings.some(f => f.severity === 'high') ? 65
                : findings.length ? 80
                    : 100;
        const status = score < 70 ? 'fail' : score < 85 ? 'warn' : 'pass';
        return { document, findings, mcpAudit, result: { score, status, findings }, text };
    }

    // Register Health Check Command (triggered via CodeLens or Editor Title Menu)
    context.subscriptions.push(
        commands.registerCommand('promptsonar.runScan', async (uriOrStr, startLine, endLine) => {
            let uri: any;
            if (typeof uriOrStr === 'string' && uriOrStr.startsWith('file://')) {
                uri = Uri.parse(uriOrStr);
            }

            // Handle if it's already a URI object or fallback to active editor
            let finalUri = uriOrStr;
            if (!finalUri || !finalUri.fsPath) {
                if (window.activeTextEditor) {
                    finalUri = window.activeTextEditor.document.uri;
                } else {
                    window.showErrorMessage('No active file to scan.');
                    return;
                }
            }

            try {
                const doc = await workspace.openTextDocument(finalUri);
                const text = doc.getText();
                const filePath = finalUri.fsPath;

                const detectedPrompts = await parseFile({
                    filePath,
                    content: text,
                    language: ''
                });

                if (detectedPrompts.length === 0) {
                    window.showInformationMessage('No prompts detected in this file.');
                    return;
                }

                let targetPrompt = detectedPrompts[0];
                if (startLine && endLine) {
                    const match = detectedPrompts.find((p: any) => p.startLine === startLine && p.endLine === endLine);
                    if (match) targetPrompt = match;
                }

                const config = { efficiency: { token_budget: 8192 } };
                const result = evaluatePrompt({ text: targetPrompt.text, context: { filePath } }, config);

                await PromptSonarWebviewPanel.createOrShow(context.extensionUri, result, targetPrompt.text);

            } catch (e) {
                window.showErrorMessage(`PromptSonar Scan Failed: ${String(e)}`);
            }
        })
    );

    context.subscriptions.push(
        commands.registerCommand('promptsonar.scanCurrentFile', async () => {
            const scan = await scanActiveDocument();
            if (!scan) return;
            executionPathProvider.update(scan.document);
            await PromptSonarWebviewPanel.createOrShow(context.extensionUri, scan.result, scan.text);
        }),
        commands.registerCommand('promptsonar.openExecutionPath', async () => {
            if (window.activeTextEditor) executionPathProvider.update(window.activeTextEditor.document);
            await commands.executeCommand('workbench.view.extension.promptsonar-sidebar');
        }),
        commands.registerCommand('promptsonar.copyExecutionPath', async () => {
            const scan = await scanActiveDocument();
            if (!scan) return;
            const workflow = pickWorstWorkflowFinding(scan.findings)?.workflow;
            await vscode.env.clipboard.writeText(executionPathText(workflow));
            window.showInformationMessage('PromptSonar execution path copied.');
        }),
        commands.registerCommand('promptsonar.copyReport', async () => {
            const scan = await scanActiveDocument();
            if (!scan) return;
            await vscode.env.clipboard.writeText(reportText(scan.findings, scan.mcpAudit, scan.document.fileName));
            window.showInformationMessage('PromptSonar report copied.');
        }),
        commands.registerCommand('promptsonar.showWorkflowDiff', async () => {
            const scan = await scanActiveDocument();
            if (!scan) return;
            const workflow = pickWorstWorkflowFinding(scan.findings)?.workflow;
            const doc = await workspace.openTextDocument({
                content: workflowDiffReport(workflow),
                language: 'markdown',
            });
            await window.showTextDocument(doc, vscode.ViewColumn.Beside);
        }),
        commands.registerCommand('promptsonar.applyFixAndShowWorkflowDiff', async () => {
            const before = await scanActiveDocument();
            if (!before) return;
            const beforeWorkflow = pickWorstWorkflowFinding(before.findings)?.workflow;

            const hardened = applyAllFixes(before.text);
            if (hardened === before.text) {
                window.showInformationMessage('PromptSonar: no deterministic fixes matched this file.');
                return;
            }

            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(before.document.positionAt(0), before.document.positionAt(before.text.length));
            edit.replace(before.document.uri, fullRange, hardened);
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                window.showErrorMessage('PromptSonar: failed to apply fix edits.');
                return;
            }

            const after = await scanActiveDocument();
            const afterWorkflow = after ? pickWorstWorkflowFinding(after.findings)?.workflow : undefined;
            const doc = await workspace.openTextDocument({
                content: workflowDiffReportBetween(beforeWorkflow, afterWorkflow),
                language: 'markdown',
            });
            await window.showTextDocument(doc, vscode.ViewColumn.Beside);
        }),
        commands.registerCommand('promptsonar.exportSarif', async () => {
            const scan = await scanActiveDocument();
            if (!scan) return;
            const sarifFindings = scan.findings.map((finding: any) => ({
                ...finding,
                filePath: scan.document.fileName,
                line: 1,
                column: 1,
            }));
            const sarif = formatToSarif(sarifFindings, scan.document.fileName);
            const outputUri = Uri.file(path.join(path.dirname(scan.document.fileName), 'promptsonar-vscode.sarif'));
            await workspace.fs.writeFile(outputUri, Buffer.from(sarif, 'utf8'));
            window.showInformationMessage(`PromptSonar SARIF exported to ${outputUri.fsPath}`);
        }),
        commands.registerCommand('promptsonar.openPlayground', async () => {
            await vscode.env.openExternal(Uri.parse('https://github.com/meghal86/promptsonar#readme'));
        })
    );

    // Register LLMLingua Compression Command
    context.subscriptions.push(
        commands.registerCommand('promptsonar.compress', async (filePath, range) => {
            if (!window.activeTextEditor) {
                window.showErrorMessage('No active file.');
                return;
            }

            try {
                const doc = window.activeTextEditor.document;
                const text = doc.getText(range);

                window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "PromptSonar: Compressing via LLMLingua-2...",
                    cancellable: false
                }, async () => {
                    const compressionResult = await compressPromptLLMLingua(text);
                    if (compressionResult.compressedText) {
                        window.showInformationMessage(`Compression Success! Saved ${compressionResult.originalTokens - compressionResult.compressedTokens} tokens.`);
                    } else {
                        window.showErrorMessage("LLMLingua compression failed or is unavailable locally.");
                    }
                });

            } catch (e) {
                window.showErrorMessage(`Compression Failed: ${String(e)}`);
            }
        })
    );

    // ── Workspace Scan: fast regex scanner with tree-sitter fallback ──
    const scanLog = window.createOutputChannel('PromptSonar Scan');

    // Fast, synchronous prompt extraction — no WASM, no tree-sitter
    function fastExtractPrompts(filePath: string, content: string): Array<{ text: string; startLine: number; endLine: number }> {
        const ext = path.extname(filePath).toLowerCase();
        const prompts: Array<{ text: string; startLine: number; endLine: number }> = [];

        // Full-file prompt types
        if (['.prompt', '.ai', '.chat'].includes(ext)) {
            return [{ text: content, startLine: 1, endLine: content.split('\n').length }];
        }

        // Keywords that indicate LLM prompts
        const promptIndicators = [
            "you are a", "you are an", "you are now", "act as", "pretend you", "roleplay as",
            "ignore previous", "ignore all previous", "ignore your previous",
            "system prompt", "system context", "system message",
            "chat history", "developer mode", "devmode",
            "no restrictions", "without restrictions", "content filters",
            "forget everything", "bypass security", "do anything now",
            "new session", "reset context", "start fresh",
            "no moral", "no ethical", "disregard",
            "jailbreak", "override your",
            "previous instructions", "prior instructions",
            "ignore all instructions", "ignore your instructions",
            "unrestricted mode", "god mode", "dan mode", "you are dan",
        ];

        const containsPromptKeyword = (text: string): boolean => {
            const lowerText = text.toLowerCase();
            const hasIndicator = promptIndicators.some(indicator => lowerText.includes(indicator));
            const hasRoleWord = /\b(user|system|assistant|llm|ai|bot|agent|model)\b/.test(lowerText);
            const hasPromptWord = /\b(prompt|instruction|instructions|query|task|respond|response|answer|generate|analyze|summarize|explain)\b/.test(lowerText);
            return hasIndicator || (hasRoleWord && hasPromptWord);
        };

        // Agent instruction markdown is prompt-bearing, but normal docs are excluded above.
        if (ext === '.md' && SUPPORTED_MARKDOWN_PROMPT_FILES.has(path.basename(filePath).toLowerCase()) && containsPromptKeyword(content)) {
            return [{ text: content, startLine: 1, endLine: content.split('\n').length }];
        }

        // Config prompt fragments can live in JSON/YAML keys without code string syntax.
        if (['.json', '.yml', '.yaml'].includes(ext) && !path.basename(filePath).toLowerCase().endsWith('package.json')) {
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                const trimmed = line.trim();
                if (trimmed.length > 20 && containsPromptKeyword(trimmed)) {
                    prompts.push({
                        text: trimmed,
                        startLine: index + 1,
                        endLine: index + 1,
                    });
                }
            });
        }

        // 1. Extract strings from code: template literals, regular strings, triple-quoted
        const stringPatterns = [
            /`([^`]{20,})`/gs,                              // template literals
            /"""([\s\S]{20,}?)"""/g,                         // triple double-quotes
            /'''([\s\S]{20,}?)'''/g,                         // triple single-quotes
            /"([^"\n]{20,})"/g,                              // regular double-quoted strings
            /'([^'\n]{20,})'/g,                              // regular single-quoted strings
        ];

        for (const pattern of stringPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const text = match[1];
                const lowerText = text.toLowerCase();

                // Check if this string contains prompt indicators
                const isPrompt = promptIndicators.some(indicator => lowerText.includes(indicator));

                // Also check keyword combos. Avoid treating normal UI copy like
                // "Prompt security scan" as an LLM prompt unless role/task terms co-occur.
                const hasRoleWord = /\b(user|system|assistant|llm|ai|bot|agent|model)\b/.test(lowerText);
                const hasPromptWord = /\b(prompt|instruction|instructions|query|task|respond|response|answer|generate|analyze|summarize|explain)\b/.test(lowerText);
                const keywordMatch = hasRoleWord && hasPromptWord;

                if (isPrompt || keywordMatch) {
                    const linesBefore = content.slice(0, match.index).split('\n').length;
                    const lineCount = text.split('\n').length;
                    prompts.push({
                        text,
                        startLine: linesBefore,
                        endLine: linesBefore + lineCount - 1,
                    });
                }
            }
        }

        // 2. Check for named prompt variables (e.g. const systemPrompt = "...")
        const namedVarPattern = /(?:const|let|var|val)\s+(\w*(?:prompt|instruction|message|system_prompt|user_prompt)\w*)\s*=\s*(?:"|'|`)([\s\S]*?)(?:"|'|`)/gi;
        let namedMatch;
        while ((namedMatch = namedVarPattern.exec(content)) !== null) {
            const text = namedMatch[2];
            if (text.length >= 20) {
                const linesBefore = content.slice(0, namedMatch.index).split('\n').length;
                prompts.push({
                    text,
                    startLine: linesBefore,
                    endLine: linesBefore + text.split('\n').length - 1,
                });
            }
        }

        // Deduplicate by startLine
        const seen = new Set<number>();
        return prompts.filter(p => {
            if (seen.has(p.startLine)) return false;
            seen.add(p.startLine);
            return true;
        });
    }

    function escapeHtml(value: unknown): string {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function repositoryPanelHtml(report: any): string {
        const summary = report.summary;
        const nodesById = new Map(report.executionMap.nodes.map((node: any) => [node.id, node]));
        const surfaces = [
            ['AI Surfaces', summary.aiSurfacesFound.prompts + summary.aiSurfacesFound.skills + summary.aiSurfacesFound.mcpServers + summary.aiSurfacesFound.tools + summary.aiSurfacesFound.workflows + summary.aiSurfacesFound.memorySystems],
            ['Execution Nodes', summary.executionGraph.nodes],
            ['Reachable Actions', report.reachablePaths.length],
            ['Issues', report.issueSummary.total],
            ['Trust Status', summary.trustStatus],
        ];
        const artifactsByType = (type: string) => report.artifacts.filter((artifact: any) => artifact.type === type);
        const issues = report.issues || [];

        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .shell { display: grid; grid-template-columns: 190px 1fr; min-height: 100vh; }
    aside { border-right: 1px solid var(--vscode-panel-border); padding: 14px 10px; background: var(--vscode-sideBar-background); }
    aside a { display: block; padding: 7px 8px; color: var(--vscode-sideBar-foreground); text-decoration: none; border-radius: 4px; }
    aside a:hover { background: var(--vscode-list-hoverBackground); }
    main { padding: 18px 22px 42px; overflow: auto; }
    h1 { font-size: 22px; margin: 0 0 14px; }
    h2 { font-size: 16px; margin: 24px 0 10px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .card, section, .node, .path { border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); padding: 12px; }
    .metric { font-size: 24px; font-weight: 700; }
    .label, .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .node { cursor: pointer; text-align: left; color: var(--vscode-foreground); }
    .node:hover { outline: 1px solid var(--vscode-focusBorder); }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px; }
    .risk-critical { color: #ff6b6b; font-weight: 700; }
    .risk-high { color: #f59e0b; font-weight: 700; }
    .risk-medium { color: #eab308; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 7px; text-align: left; vertical-align: top; }
    button.link { color: var(--vscode-textLink-foreground); background: transparent; border: 0; padding: 0; cursor: pointer; font: inherit; }
    code { color: var(--vscode-textPreformat-foreground); }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <a href="#overview">Repository</a>
      <a href="#overview">Overview</a>
      <a href="#map">Execution Map</a>
      <a href="#findings">Findings</a>
      <a href="#skills">Skills</a>
      <a href="#mcp">MCP</a>
      <a href="#workflows">Workflows</a>
    </aside>
    <main>
      <h1>Repository Overview</h1>
      <div class="cards">${surfaces.map(([label, value]) => `<div class="card"><div class="metric">${escapeHtml(value)}</div><div class="label">${escapeHtml(label)}</div></div>`).join('')}</div>
      <section id="overview">
        <h2>Repository Summary</h2>
        <table>
          <tr><th>Prompts</th><th>Skills</th><th>MCP Servers</th><th>Tools</th><th>Workflows</th><th>Memory</th></tr>
          <tr><td>${summary.aiSurfacesFound.prompts}</td><td>${summary.aiSurfacesFound.skills}</td><td>${summary.aiSurfacesFound.mcpServers}</td><td>${summary.aiSurfacesFound.tools}</td><td>${summary.aiSurfacesFound.workflows}</td><td>${summary.aiSurfacesFound.memorySystems}</td></tr>
        </table>
        <h2>Most Critical Paths</h2>
        ${report.reachablePaths.slice(0, 6).map((pathItem: any) => `<div class="path"><div class="risk-${pathItem.risk}">${escapeHtml(pathItem.risk.toUpperCase())} · ${escapeHtml(pathItem.sensitiveActions.join(', ') || 'No sensitive action')}</div><div>${escapeHtml(pathItem.explanation)}</div><div class="muted">Confidence ${pathItem.confidence}%</div></div>`).join('') || '<div class="muted">No reachable sensitive actions found.</div>'}
      </section>
      <section id="map">
        <h2>Execution Map</h2>
        <div class="grid">${report.executionMap.nodes.map((node: any) => `<button class="node" data-file="${escapeHtml(node.filePath || '')}"><span class="badge">${escapeHtml(node.type)}</span><br><strong>${escapeHtml(node.label)}</strong><br><span class="muted">${escapeHtml(node.relativePath || node.description)}</span></button>`).join('')}</div>
        <h2>Edges</h2>
        <table>${report.executionMap.edges.slice(0, 120).map((edge: any) => `<tr><td>${escapeHtml((nodesById.get(edge.from) as any)?.label || edge.from)}</td><td>${escapeHtml(edge.type)}</td><td>${escapeHtml((nodesById.get(edge.to) as any)?.label || edge.to)}</td></tr>`).join('')}</table>
      </section>
      <section id="findings">
        <h2>Canonical Issues (${report.issueSummary.total})</h2>
        <table>
          <tr><th>ID</th><th>Severity</th><th>Issue</th><th>Evidence</th><th>How to Fix</th><th>Confidence</th></tr>
          ${issues.map((issue: any) => `<tr><td><code>${escapeHtml(issue.id)}</code></td><td class="risk-${issue.severity}">${escapeHtml(issue.severity)}</td><td><strong>Issue:</strong> ${escapeHtml(issue.issue)}<br><br><strong>Impact:</strong> ${escapeHtml(issue.impact)}<br><br><strong>Why this matters:</strong> ${escapeHtml(issue.whyThisMatters)}<br><br><strong>Fix:</strong> ${escapeHtml(issue.howToFix)}<details><summary>Technical Details</summary><strong>Execution path:</strong> ${escapeHtml(issue.technicalDetails?.executionPath || 'No connected sensitive action was confirmed for this finding.')}<br><strong>Evidence:</strong> ${escapeHtml((issue.technicalDetails?.evidence || issue.evidence).map((item: any) => `${item.file}:${item.line || 1}`).join(', '))}<br><strong>Confidence:</strong> ${escapeHtml(issue.technicalDetails?.confidence?.label || issue.confidence.label)} ${escapeHtml(issue.technicalDetails?.confidence?.score ?? issue.confidence.score)}%</details></td><td><button class="link" data-file="${escapeHtml(issue.impactedFiles[0] || '')}">${escapeHtml(issue.impactedFiles.join(', '))}</button></td><td>${escapeHtml(issue.howToFix)}</td><td>${escapeHtml(issue.confidence.label)} ${escapeHtml(issue.confidence.score)}%</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No active issues.</td></tr>'}
        </table>
      </section>
      <section id="skills"><h2>Skills</h2>${artifactsByType('SKILL').map((artifact: any) => `<div class="path"><button class="link" data-file="${escapeHtml(artifact.filePath)}">${escapeHtml(artifact.relativePath)}</button><div>${escapeHtml(artifact.description)}</div><div class="muted">${escapeHtml((artifact.metadata?.capabilities || []).join(' · '))}</div></div>`).join('') || '<div class="muted">No SKILL.md files discovered.</div>'}</section>
      <section id="mcp"><h2>MCP Servers</h2>${artifactsByType('MCP_SERVER').map((artifact: any) => `<div class="path"><button class="link" data-file="${escapeHtml(artifact.filePath)}">${escapeHtml(artifact.name)}</button><div>${escapeHtml(artifact.relativePath)}</div><div class="muted">Auto-approve: ${escapeHtml(Boolean(artifact.metadata?.autoApprove))} · Actions: ${escapeHtml((artifact.metadata?.sensitiveActions || []).join(', '))}</div></div>`).join('') || '<div class="muted">No MCP servers discovered.</div>'}</section>
      <section id="workflows"><h2>Workflows</h2>${artifactsByType('WORKFLOW').concat(artifactsByType('ACTION')).map((artifact: any) => `<div class="path"><button class="link" data-file="${escapeHtml(artifact.filePath)}">${escapeHtml(artifact.relativePath)}</button><div>${escapeHtml(artifact.description)}</div></div>`).join('') || '<div class="muted">No workflow artifacts discovered.</div>'}</section>
    </main>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-file]');
      if (target && target.dataset.file) vscode.postMessage({ command: 'openFile', filePath: target.dataset.file });
    });
  </script>
</body>
</html>`;
    }

    async function buildRepositoryExecutionReportFromWorkspace(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<any | undefined> {
        const workspaceFolders = workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            window.showErrorMessage('No workspace open to analyze.');
            return undefined;
        }

        const root = workspaceFolders[0].uri.fsPath;
        const workspaceIgnoreMatchers = await loadWorkspaceIgnoreMatchers(workspaceFolders);
        const sourceFiles = await workspace.findFiles(WORKSPACE_SCAN_GLOB, WORKSPACE_SCAN_EXCLUDE_GLOB);
        const markdownInstructionFiles = await workspace.findFiles('**/{SKILL.md,skills.md,AGENT.md,AGENTS.md,agent.md,agents.md}', WORKSPACE_SCAN_EXCLUDE_GLOB);
        const files = [...sourceFiles, ...markdownInstructionFiles]
            .filter(file =>
                !isIgnoredWorkspaceFile(file.fsPath) &&
                !isPromptSonarIgnoredPath(file.fsPath, workspaceIgnoreMatchers)
            )
            .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
            .slice(0, Math.max(1, workspace.getConfiguration('promptsonar').get<number>('maxWorkspaceScanFiles', 2000)));
        const maxFileSizeBytes = workspace.getConfiguration('promptsonar').get<number>('maxFileSizeBytes', 1048576);
        const scanResults: any[] = [];

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            progress?.report({ message: path.basename(file.fsPath), increment: 100 / Math.max(files.length, 1) });
            const stat = await workspace.fs.stat(file);
            if (stat.size > maxFileSizeBytes) continue;
            const text = Buffer.from(await workspace.fs.readFile(file)).toString('utf8');
            const findings: any[] = [];

            if (isMcpConfigFile(file.fsPath)) {
                const audit = auditMcpConfig(file.fsPath, text);
                findings.push(...audit.findings.map((finding: any) => ({
                    rule_id: finding.rule_id,
                    category: 'security',
                    severity: finding.severity,
                    line: 1,
                    message: finding.message,
                    fix: finding.fix,
                    evidence: finding.evidence || finding.path,
                    workflow: finding.workflow,
                    waived: false,
                })));
            } else {
                for (const prompt of fastExtractPrompts(file.fsPath, text)) {
                    const result = evaluatePrompt({ text: prompt.text, context: { filePath: file.fsPath } });
                    findings.push(...result.findings.map((finding: any) => ({
                        ...finding,
                        message: finding.explanation,
                        fix: finding.suggested_fix,
                        line: prompt.startLine,
                        waived: false,
                    })));
                }
            }

            if (findings.length > 0) {
                scanResults.push({ filePath: file.fsPath, findings });
            }
        }

        return analyzeRepositoryExecution(root, scanResults);
    }

    context.subscriptions.push(
        commands.registerCommand('promptsonar.analyzeRepositoryExecutionMap', async () => {
            await window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'PromptSonar: Analyzing Repository Execution Map...',
                cancellable: false,
            }, async (progress) => {
                const report = await buildRepositoryExecutionReportFromWorkspace(progress);
                if (!report) return;

                const panel = window.createWebviewPanel(
                    'promptsonarRepositoryOverview',
                    'Repository Overview',
                    vscode.ViewColumn.Active,
                    { enableScripts: true }
                );
                panel.webview.onDidReceiveMessage(async message => {
                    if (message.command === 'openFile' && message.filePath) {
                        const doc = await workspace.openTextDocument(Uri.file(message.filePath));
                        await window.showTextDocument(doc, vscode.ViewColumn.Active);
                    }
                });
                panel.webview.html = repositoryPanelHtml(report);
            });
        })
    );

    context.subscriptions.push(
        commands.registerCommand('promptsonar.scanWorkspace', async () => {
            const workspaceFolders = workspace.workspaceFolders;
            if (!workspaceFolders) {
                window.showErrorMessage('No workspace open to scan.');
                return;
            }

            scanLog.clear();
            scanCache.clear();
            scanLog.show(true); // show the output channel so user can see progress
            scanLog.appendLine('═══ PromptSonar Workspace Scan ═══');
            scanLog.appendLine(`Started at ${new Date().toLocaleTimeString()}`);

            window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "PromptSonar: Scanning Workspace...",
                cancellable: true
            }, async (progress, token) => {
                try {
                    const workspaceIgnoreMatchers = await loadWorkspaceIgnoreMatchers(workspaceFolders);
                    const sourceFiles = await workspace.findFiles(WORKSPACE_SCAN_GLOB, WORKSPACE_SCAN_EXCLUDE_GLOB);
                    const markdownInstructionFiles = await workspace.findFiles('**/{SKILL.md,skills.md,AGENT.md,AGENTS.md,agent.md,agents.md}', WORKSPACE_SCAN_EXCLUDE_GLOB);
                    const rawFiles = [...sourceFiles, ...markdownInstructionFiles];
                    const candidateFiles = rawFiles.filter(f =>
                        !isIgnoredWorkspaceFile(f.fsPath) &&
                        !isPromptSonarIgnoredPath(f.fsPath, workspaceIgnoreMatchers)
                    ).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
                    const configScope = workspace.getConfiguration('promptsonar');
                    const maxWorkspaceScanFiles = Math.max(1, configScope.get<number>('maxWorkspaceScanFiles', 2000));
                    const files = candidateFiles.slice(0, maxWorkspaceScanFiles);
                    const excludedCount = rawFiles.length - files.length;
                    const skippedByLimit = Math.max(0, candidateFiles.length - files.length);
                    const maxFileSizeBytes = configScope.get<number>('maxFileSizeBytes', 1048576);
                    let skippedLargeFiles = 0;
                    let cancelled = false;

                    scanLog.appendLine(`Found ${files.length} scannable files (${excludedCount} generated/test/doc files excluded)\n`);
                    if (skippedByLimit > 0) {
                        scanLog.appendLine(`Workspace scan limited to ${files.length} files (${skippedByLimit} additional files skipped by promptsonar.maxWorkspaceScanFiles).`);
                    }

                    if (files.length === 0) {
                        window.showInformationMessage('No scannable files found in the workspace.');
                        return;
                    }

                    const config = { efficiency: { token_budget: 8192 } };

                    let allFindings: any[] = [];
                    let promptScores: number[] = [];
                    let promptsEvaluated = 0;
                    let combinedText = '';
                    let filesWithPrompts = 0;

                    for (let i = 0; i < files.length; i++) {
                        if (token.isCancellationRequested) {
                            cancelled = true;
                            scanLog.appendLine('\nScan cancelled by user.');
                            break;
                        }

                        const file = files[i];
                        const basename = path.basename(file.fsPath);
                        progress.report({ message: `(${i + 1}/${files.length}) ${basename}`, increment: (100 / files.length) });

                        const stat = await workspace.fs.stat(file);
                        if (stat.size > maxFileSizeBytes) {
                            skippedLargeFiles++;
                            scanLog.appendLine(`↷ ${basename} — skipped (${stat.size} bytes exceeds ${maxFileSizeBytes})`);
                            continue;
                        }

                        const fileData = await workspace.fs.readFile(file);
                        const text = Buffer.from(fileData).toString('utf8');
                        const contentHash = hashContent(text);
                        const cached = scanCache.get(file.fsPath);
                        if (cached?.contentHash === contentHash) {
                            allFindings.push(...cached.findings);
                            promptScores.push(...(cached.scores || Array.from({ length: cached.promptsEvaluated }, () => Math.round(cached.score / cached.promptsEvaluated))));
                            promptsEvaluated += cached.promptsEvaluated;
                            combinedText += cached.combinedText;
                            if (cached.promptsEvaluated > 0) filesWithPrompts++;
                            scanLog.appendLine(`↻ ${basename} — reused cached scan`);
                            continue;
                        }

                        // Use fast regex-based extraction (no WASM dependency)
                        const detectedPrompts = fastExtractPrompts(file.fsPath, text);
                        const fileFindings: any[] = [];
                        let fileScore = 0;
                        let filePromptsEvaluated = 0;
                        let fileCombinedText = '';

                        if (detectedPrompts.length > 0) {
                            filesWithPrompts++;
                            scanLog.appendLine(`✓ ${basename} — ${detectedPrompts.length} prompt(s) detected`);
                        }

                        for (const prompt of detectedPrompts) {
                            try {
                                const result = evaluatePrompt({ text: prompt.text, context: { filePath: file.fsPath } }, config);
                                const findings = result.findings.map((f: any) => ({ ...f, file: basename, line: prompt.startLine }));
                                fileFindings.push(...findings);
                                allFindings.push(...findings);
                                promptScores.push(result.score);
                                fileScore += result.score;
                                promptsEvaluated++;
                                filePromptsEvaluated++;
                                const promptText = prompt.text + '\n\n';
                                combinedText += promptText;
                                fileCombinedText += promptText;
                            } catch (err: any) {
                                scanLog.appendLine(`  ⚠ Error evaluating prompt in ${basename}: ${err.message}`);
                            }
                        }

                        scanCache.set(file.fsPath, {
                            contentHash,
                            findings: fileFindings,
                            score: fileScore,
                            scores: promptScores.slice(promptScores.length - filePromptsEvaluated),
                            promptsEvaluated: filePromptsEvaluated,
                            combinedText: fileCombinedText,
                        });
                    }

                    scanLog.appendLine(`\n═══ Scan Complete ═══`);
                    scanLog.appendLine(`Files scanned: ${files.length - skippedLargeFiles}`);
                    scanLog.appendLine(`Files skipped by size: ${skippedLargeFiles}`);
                    scanLog.appendLine(`Files skipped by workspace limit: ${skippedByLimit}`);
                    scanLog.appendLine(`Files with prompts: ${filesWithPrompts}`);
                    scanLog.appendLine(`Total prompts: ${promptsEvaluated}`);
                    scanLog.appendLine(`Total findings: ${allFindings.length}`);
                    scanLog.appendLine(`Finished at ${new Date().toLocaleTimeString()}`);

                    if (promptsEvaluated === 0) {
                        if (cancelled) {
                            window.showInformationMessage(`PromptSonar: Workspace scan cancelled. Scanned ${files.length - skippedLargeFiles} files before cancellation.`);
                            return;
                        }
                        window.showInformationMessage(`PromptSonar: Scanned ${files.length} files — no prompts found.`);
                        return;
                    }

                    const summary = summarizeWorkspaceScore(promptScores, allFindings);

                    const masterResult = {
                        score: summary.score,
                        status: summary.status,
                        findings: allFindings
                    };

                    await PromptSonarWebviewPanel.createOrShow(context.extensionUri, masterResult as any, combinedText || "Workspace Summary");

                } catch (e) {
                    scanLog.appendLine(`\n✘ Scan failed: ${String(e)}`);
                    window.showErrorMessage(`Workspace Scan Failed: ${String(e)}`);
                }
            });
        })
    );
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
