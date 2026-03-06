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
// @ts-ignore
import { parseFile, evaluatePrompt, compressPromptLLMLingua } from 'core';

let client: LanguageClient;

// Incremental scan cache: stores content hash + results per file to skip unchanged files on repeat scans
interface CachedScanEntry {
    contentHash: string;
    findings: any[];
    score: number;
    promptsEvaluated: number;
    combinedText: string;
}
const scanCache = new Map<string, CachedScanEntry>();

function hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

const SUPPORTED_LANGUAGES = new Set([
    'python', 'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
    'go', 'java', 'rust', 'csharp'
]);

function isSupportedLanguage(languageId: string): boolean {
    return SUPPORTED_LANGUAGES.has(languageId);
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
        documentSelector: [
            { scheme: 'file', language: 'python' },
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'go' },
            { scheme: 'file', language: 'java' },
            { scheme: 'file', language: 'rust' },
            { scheme: 'file', language: 'csharp' }
        ],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Explicitly register a CodeLens Provider on the client side just in case the LSP capabilities map fails
    context.subscriptions.push(
        languages.registerCodeLensProvider(
            clientOptions.documentSelector as any,
            new PromptSonarCodeLensProvider()
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
            if (isSupportedLanguage(doc.languageId)) {
                // The server will auto-validate via onDidChangeContent,
                // but we explicitly request validation on open too
                client.sendNotification('promptsonar/requestValidation', { uri: doc.uri.toString() });
            }
        })
    );

    // Auto-refresh on file SAVE (< 2 seconds target)
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(doc => {
            if (isSupportedLanguage(doc.languageId)) {
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

                // Also check keyword combos
                const hasRoleWord = /\b(user|system|assistant|llm|ai|bot|agent|model)\b/.test(lowerText);
                const hasPromptWord = /\b(prompt|instruction|instructions|query|task|respond|response|answer|generate|analyze|summarize|explain)\b/.test(lowerText);
                const keywordMatch = (hasRoleWord && hasPromptWord) || (text.length > 80 && (hasRoleWord || hasPromptWord));

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

    context.subscriptions.push(
        commands.registerCommand('promptsonar.scanWorkspace', async () => {
            const workspaceFolders = workspace.workspaceFolders;
            if (!workspaceFolders) {
                window.showErrorMessage('No workspace open to scan.');
                return;
            }

            scanLog.clear();
            scanLog.show(true); // show the output channel so user can see progress
            scanLog.appendLine('═══ PromptSonar Workspace Scan ═══');
            scanLog.appendLine(`Started at ${new Date().toLocaleTimeString()}`);

            window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "PromptSonar: Scanning Workspace...",
                cancellable: false
            }, async (progress) => {
                try {
                    const rawFiles = await workspace.findFiles('**/*.{ts,js,py,go,java,rs,cs,prompt,ai,chat}', '**/node_modules/**');

                    const excludeKeywords = [
                        '/node_modules/', '\\node_modules\\',
                        '/dist/', '\\dist\\',
                        '/out/', '\\out\\',
                        '/build/', '\\build\\',
                        '/vendor/', '\\vendor\\',
                        '/.git/', '\\.git\\',
                        '/venv/', '\\venv\\',
                        '/tests/', '\\tests\\',
                        '/coverage/', '\\coverage\\',
                        '/docs/', '\\docs\\',
                        '/.vscode-test/', '\\.vscode-test\\',
                        'dummy_test.', 'generate_test.', 'test_parser.', 'test_regex.', 'debug_scan.', 'test_parse.'
                    ];

                    const files = rawFiles.filter(f => !excludeKeywords.some(kw => f.fsPath.toLowerCase().includes(kw)));

                    scanLog.appendLine(`Found ${files.length} scannable files (excluded node_modules, dist, build, etc.)\n`);

                    if (files.length === 0) {
                        window.showInformationMessage('No scannable files found in the workspace.');
                        return;
                    }

                    const config = { efficiency: { token_budget: 8192 } };

                    let allFindings: any[] = [];
                    let totalScore = 0;
                    let promptsEvaluated = 0;
                    let combinedText = '';
                    let filesWithPrompts = 0;

                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const basename = path.basename(file.fsPath);
                        progress.report({ message: `(${i + 1}/${files.length}) ${basename}`, increment: (100 / files.length) });

                        const fileData = await workspace.fs.readFile(file);
                        const text = Buffer.from(fileData).toString('utf8');

                        // Use fast regex-based extraction (no WASM dependency)
                        const detectedPrompts = fastExtractPrompts(file.fsPath, text);

                        if (detectedPrompts.length > 0) {
                            filesWithPrompts++;
                            scanLog.appendLine(`✓ ${basename} — ${detectedPrompts.length} prompt(s) detected`);
                        }

                        for (const prompt of detectedPrompts) {
                            try {
                                const result = evaluatePrompt({ text: prompt.text, context: { filePath: file.fsPath } }, config);
                                allFindings.push(...result.findings.map((f: any) => ({ ...f, file: basename })));
                                totalScore += result.score;
                                promptsEvaluated++;
                                combinedText += prompt.text + '\n\n';
                            } catch (err: any) {
                                scanLog.appendLine(`  ⚠ Error evaluating prompt in ${basename}: ${err.message}`);
                            }
                        }
                    }

                    scanLog.appendLine(`\n═══ Scan Complete ═══`);
                    scanLog.appendLine(`Files scanned: ${files.length}`);
                    scanLog.appendLine(`Files with prompts: ${filesWithPrompts}`);
                    scanLog.appendLine(`Total prompts: ${promptsEvaluated}`);
                    scanLog.appendLine(`Total findings: ${allFindings.length}`);
                    scanLog.appendLine(`Finished at ${new Date().toLocaleTimeString()}`);

                    if (promptsEvaluated === 0) {
                        window.showInformationMessage(`PromptSonar: Scanned ${files.length} files — no prompts found.`);
                        return;
                    }

                    const averageScore = Math.round(totalScore / promptsEvaluated);
                    let status: "pass" | "warn" | "fail" = "pass";
                    if (averageScore < 70) status = "fail";
                    else if (averageScore < 85) status = "warn";

                    const hasCritical = allFindings.some(f => f.severity === 'critical');
                    let finalScore = averageScore;
                    if (hasCritical) {
                        status = "fail";
                    }

                    const masterResult = {
                        score: finalScore,
                        status,
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
