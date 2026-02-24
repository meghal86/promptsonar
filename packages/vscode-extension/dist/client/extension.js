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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
const ReportPanel_1 = require("../webview/ReportPanel");
// @ts-ignore
const core_1 = require("core");
let client;
function activate(context) {
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));
    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions = {
        run: { module: serverModule, transport: node_1.TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: node_1.TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };
    // Options to control the language client
    const clientOptions = {
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
            fileEvents: vscode_1.workspace.createFileSystemWatcher('**/.clientrc')
        }
    };
    // Create the language client and start the client.
    client = new node_1.LanguageClient('promptsonarLSP', 'PromptSonar Language Server', serverOptions, clientOptions);
    // Start the client. This will also launch the server
    client.start();
    // Create Status Bar Item
    const statusBarItem = vscode_1.window.createStatusBarItem(vscode_1.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    // Listen for custom notifications from the server
    client.onNotification('promptsonar/scanResult', (params) => {
        if (params.score !== null) {
            statusBarItem.text = `$(shield) PromptSonar: ${params.score}`;
            // Color formatting
            if (params.score < 70) {
                statusBarItem.color = new vscode_1.ThemeColor('errorForeground');
            }
            else if (params.score < 85) {
                statusBarItem.color = new vscode_1.ThemeColor('issues.warning');
            }
            else {
                statusBarItem.color = undefined; // Reset
            }
            statusBarItem.tooltip = `PromptSonar Scan Score: ${params.score}`;
            statusBarItem.show();
        }
        else {
            statusBarItem.hide();
        }
    });
    // Register Health Check Command (triggered via CodeLens or Editor Title Menu)
    context.subscriptions.push(vscode_1.commands.registerCommand('promptsonar.runScan', async (uriOrStr, startLine, endLine) => {
        let uri;
        if (typeof uriOrStr === 'string' && uriOrStr.startsWith('file://')) {
            uri = vscode_1.Uri.parse(uriOrStr);
        }
        // Handle if it's already a URI object or fallback to active editor
        let finalUri = uriOrStr;
        if (!finalUri || !finalUri.fsPath) {
            if (vscode_1.window.activeTextEditor) {
                finalUri = vscode_1.window.activeTextEditor.document.uri;
            }
            else {
                vscode_1.window.showErrorMessage('No active file to scan.');
                return;
            }
        }
        try {
            const doc = await vscode_1.workspace.openTextDocument(finalUri);
            const text = doc.getText();
            const filePath = finalUri.fsPath;
            const detectedPrompts = await (0, core_1.parseFile)({
                filePath,
                content: text,
                language: ''
            });
            if (detectedPrompts.length === 0) {
                vscode_1.window.showInformationMessage('No prompts detected in this file.');
                return;
            }
            let targetPrompt = detectedPrompts[0];
            if (startLine && endLine) {
                const match = detectedPrompts.find((p) => p.startLine === startLine && p.endLine === endLine);
                if (match)
                    targetPrompt = match;
            }
            const config = { efficiency: { token_budget: 8192 } };
            const result = (0, core_1.evaluatePrompt)({ text: targetPrompt.text, context: { filePath } }, config);
            await ReportPanel_1.PromptSonarReportPanel.createOrShow(context.extensionUri, result, targetPrompt.text);
        }
        catch (e) {
            vscode_1.window.showErrorMessage(`PromptSonar Scan Failed: ${String(e)}`);
        }
    }));
}
function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
//# sourceMappingURL=extension.js.map