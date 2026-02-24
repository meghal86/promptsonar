"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
// @ts-ignore
const core_1 = require("core");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
connection.onInitialize((params) => {
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            codeActionProvider: true,
            codeLensProvider: { resolveProvider: false }
        }
    };
    return result;
});
const codeLensMap = new Map();
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});
async function validateTextDocument(textDocument) {
    const text = textDocument.getText();
    const uri = textDocument.uri;
    // Convert URI to simple file path roughly
    const filePath = uri.replace('file://', '');
    try {
        const detectedPrompts = await (0, core_1.parseFile)({
            filePath,
            content: text,
            language: '' // Auto-detect based on extension inside
        });
        // Read workspace config (mocked reading for MVP)
        const config = { efficiency: { token_budget: 8192 } };
        const diagnostics = [];
        const lenses = [];
        for (const prompt of detectedPrompts) {
            const startPos = { line: prompt.startLine - 1, character: 0 };
            const endPos = { line: prompt.endLine - 1, character: Number.MAX_VALUE };
            // Add CodeLens
            lenses.push({
                range: { start: startPos, end: endPos },
                command: {
                    title: '▶ Run PromptSonar Health Check',
                    command: 'promptsonar.runScan',
                    arguments: [uri, prompt.startLine, prompt.endLine]
                }
            });
            const evaluation = (0, core_1.evaluatePrompt)({
                text: prompt.text,
                context: { filePath }
            }, config);
            for (const finding of evaluation.findings) {
                let severity = node_1.DiagnosticSeverity.Information;
                if (finding.severity === "critical" || finding.severity === "high") {
                    severity = node_1.DiagnosticSeverity.Error;
                }
                else if (finding.severity === "medium") {
                    severity = node_1.DiagnosticSeverity.Warning;
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
        codeLensMap.set(uri, lenses);
        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
        // Compute average score for status bar
        if (detectedPrompts.length > 0) {
            let totalScore = 0;
            // Re-evaluate to get scores directly (or we could have saved them above)
            for (const prompt of detectedPrompts) {
                const evaluation = (0, core_1.evaluatePrompt)({ text: prompt.text, context: { filePath } }, config);
                totalScore += evaluation.score;
            }
            const avgScore = Math.round(totalScore / detectedPrompts.length);
            connection.sendNotification('promptsonar/scanResult', { score: avgScore, file: uri });
        }
        else {
            connection.sendNotification('promptsonar/scanResult', { score: null, file: uri });
        }
    }
    catch (err) {
        console.error("PromptSonar LSP error:", err);
    }
}
connection.onCodeAction((params) => {
    const codeActions = [];
    // Provide Quick Fixes based on diagnostics
    for (const diag of params.context.diagnostics) {
        if (diag.code === 'eff_compression_potential') {
            codeActions.push(node_1.CodeAction.create('Compress with LLMLingua (~40% savings estimated)', node_1.Command.create('Compress with LLMLingua (~40% savings estimated)', 'promptsonar.compress', params.textDocument.uri, diag.range), node_1.CodeActionKind.QuickFix));
        }
    }
    return codeActions;
});
connection.onCodeLens((params) => {
    return codeLensMap.get(params.textDocument.uri) || [];
});
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map