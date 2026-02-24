import * as path from 'path';
import { workspace, ExtensionContext, window, StatusBarAlignment, StatusBarItem, ThemeColor, commands, Uri, languages, CodeLens, Range } from 'vscode';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { PromptSonarReportPanel } from '../webview/ReportPanel';
// @ts-ignore
import { parseFile, evaluatePrompt } from 'core';

let client: LanguageClient;

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
            {
                provideCodeLenses: async (document, token) => {
                    if (!client) return [];
                    // We can ask the server for lenses through a custom request, or let the LSP client handle it.
                    // The standard way is the LSP client handles it if `codeLensProvider` is true in Init result.
                    // Since it wasn't working, let's manually build the Lenses here on the client side using core parser directly for bulletproof UX.

                    const text = document.getText();
                    const filePath = document.uri.fsPath;

                    try {
                        const detectedPrompts = await parseFile({
                            filePath,
                            content: text,
                            language: ''
                        });

                        const lenses: CodeLens[] = [];
                        for (const prompt of detectedPrompts) {
                            const range = new Range(prompt.startLine - 1, 0, prompt.endLine - 1, 0);
                            lenses.push(new CodeLens(range, {
                                title: '▶ Run PromptSonar Health Check',
                                command: 'promptsonar.runScan',
                                arguments: [document.uri, prompt.startLine, prompt.endLine]
                            }));
                        }
                        return lenses;

                    } catch (e) {
                        return [];
                    }
                }
            }
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

    // Create Status Bar Item
    const statusBarItem: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Listen for custom notifications from the server
    client.onNotification('promptsonar/scanResult', (params: { score: number | null, file: string }) => {
        if (params.score !== null) {
            statusBarItem.text = `$(shield) PromptSonar: ${params.score}`;

            // Color formatting
            if (params.score < 70) {
                statusBarItem.color = new ThemeColor('errorForeground');
            } else if (params.score < 85) {
                statusBarItem.color = new ThemeColor('issues.warning');
            } else {
                statusBarItem.color = undefined; // Reset
            }

            statusBarItem.tooltip = `PromptSonar Scan Score: ${params.score}`;
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

                await PromptSonarReportPanel.createOrShow(context.extensionUri, result, targetPrompt.text);

            } catch (e) {
                window.showErrorMessage(`PromptSonar Scan Failed: ${String(e)}`);
            }
        })
    );

    // Register Workspace Scan Command
    context.subscriptions.push(
        commands.registerCommand('promptsonar.scanWorkspace', async () => {
            const workspaceFolders = workspace.workspaceFolders;
            if (!workspaceFolders) {
                window.showErrorMessage('No workspace open to scan.');
                return;
            }

            window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "PromptSonar: Scanning Workspace...",
                cancellable: false
            }, async (progress) => {
                try {
                    const files = await workspace.findFiles('**/*.{ts,js,py,go,java,rs,cs,prompt,ai,chat}', '**/node_modules/**');
                    const config = { efficiency: { token_budget: 8192 } };

                    let allFindings: any[] = [];
                    let totalScore = 0;
                    let promptsEvaluated = 0;
                    let combinedText = '';

                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        progress.report({ message: `Scanning ${path.basename(file.fsPath)}`, increment: (100 / files.length) });

                        const doc = await workspace.openTextDocument(file);
                        const text = doc.getText();

                        const detectedPrompts = await parseFile({
                            filePath: file.fsPath,
                            content: text,
                            language: ''
                        });

                        for (const prompt of detectedPrompts) {
                            const result = evaluatePrompt({ text: prompt.text, context: { filePath: file.fsPath } }, config);
                            allFindings.push(...result.findings.map((f: any) => ({ ...f, file: path.basename(file.fsPath) })));
                            totalScore += result.score;
                            promptsEvaluated++;
                            combinedText += prompt.text + '\n\n';
                        }
                    }

                    if (promptsEvaluated === 0) {
                        window.showInformationMessage('No prompts found in the entire workspace.');
                        return;
                    }

                    const averageScore = Math.round(totalScore / promptsEvaluated);
                    let status: "pass" | "warn" | "fail" = "pass";
                    if (averageScore < 70) status = "fail";
                    else if (averageScore < 85) status = "warn";

                    const hasCritical = allFindings.some(f => f.severity === 'critical');
                    let finalScore = averageScore;
                    if (hasCritical) {
                        finalScore = Math.min(finalScore, 49);
                        status = "fail";
                    }

                    const masterResult = {
                        score: finalScore,
                        status,
                        findings: allFindings
                    };

                    await PromptSonarReportPanel.createOrShow(context.extensionUri, masterResult as any, combinedText || "Workspace Summary");

                } catch (e) {
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
