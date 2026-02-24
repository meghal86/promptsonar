import * as path from 'path';
import { workspace, ExtensionContext, window, StatusBarAlignment, StatusBarItem, ThemeColor } from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

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
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
