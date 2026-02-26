import * as vscode from 'vscode';
// @ts-ignore
import { parseFile } from 'core';

export class PromptSonarCodeLensProvider implements vscode.CodeLensProvider {
    public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        const text = document.getText();
        const filePath = document.uri.fsPath;

        try {
            const detectedPrompts = await parseFile({
                filePath,
                content: text,
                language: ''
            });

            const lenses: vscode.CodeLens[] = [];
            for (const prompt of detectedPrompts) {
                const range = new vscode.Range(prompt.startLine - 1, 0, prompt.endLine - 1, 0);
                lenses.push(new vscode.CodeLens(range, {
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
