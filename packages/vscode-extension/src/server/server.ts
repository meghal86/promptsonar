import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    CodeAction,
    CodeActionKind,
    Command
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
// @ts-ignore
import { parseFile, evaluatePrompt } from 'core';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            codeActionProvider: true
        }
    };
    return result;
});

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const uri = textDocument.uri;
    // Convert URI to simple file path roughly
    const filePath = uri.replace('file://', '');

    try {
        const detectedPrompts = await parseFile({
            filePath,
            content: text,
            language: '' // Auto-detect based on extension inside
        });

        // Read workspace config (mocked reading for MVP)
        const config = { efficiency: { token_budget: 8192 } };

        const diagnostics: Diagnostic[] = [];

        for (const prompt of detectedPrompts) {
            const evaluation = evaluatePrompt({
                text: prompt.text,
                context: { filePath }
            }, config);

            for (const finding of evaluation.findings) {
                let severity: DiagnosticSeverity = DiagnosticSeverity.Information;
                if (finding.severity === "critical" || finding.severity === "high") {
                    severity = DiagnosticSeverity.Error;
                } else if (finding.severity === "medium") {
                    severity = DiagnosticSeverity.Warning;
                }

                diagnostics.push({
                    severity,
                    range: {
                        start: { line: prompt.startLine - 1, character: 0 },
                        end: { line: prompt.endLine - 1, character: Number.MAX_VALUE }
                    },
                    message: `[PromptSonar] ${finding.explanation}\nSuggestion: ${finding.suggested_fix}`,
                    source: 'PromptSonar',
                    code: finding.rule_id
                });
            }
        }

        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

        // Compute average score for status bar
        if (detectedPrompts.length > 0) {
            let totalScore = 0;
            // Re-evaluate to get scores directly (or we could have saved them above)
            for (const prompt of detectedPrompts) {
                const evaluation = evaluatePrompt({ text: prompt.text, context: { filePath } }, config);
                totalScore += evaluation.score;
            }
            const avgScore = Math.round(totalScore / detectedPrompts.length);
            connection.sendNotification('promptsonar/scanResult', { score: avgScore, file: uri });
        } else {
            connection.sendNotification('promptsonar/scanResult', { score: null, file: uri });
        }
    } catch (err) {
        console.error("PromptSonar LSP error:", err);
    }
}

connection.onCodeAction((params) => {
    const codeActions: CodeAction[] = [];

    // Provide Quick Fixes based on diagnostics
    for (const diag of params.context.diagnostics) {
        if (diag.code === 'eff_compression_potential') {
            codeActions.push(
                CodeAction.create(
                    'Compress with LLMLingua (~40% savings estimated)',
                    Command.create('Compress with LLMLingua (~40% savings estimated)', 'promptsonar.compress', params.textDocument.uri, diag.range),
                    CodeActionKind.QuickFix
                )
            );
        }
    }
    return codeActions;
});

documents.listen(connection);
connection.listen();
