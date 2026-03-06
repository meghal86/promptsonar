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
    Command,
    CodeLens
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
            codeActionProvider: true,
            codeLensProvider: { resolveProvider: false }
        }
    };
    return result;
});

// Handle requestValidation from file open/save
connection.onNotification('promptsonar/requestValidation', async (params: { uri: string }) => {
    const doc = documents.get(params.uri);
    if (doc) {
        await validateTextDocument(doc);
    }
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

                // OWASP reference mapping
                let owaspRef = '';
                if (finding.rule_id.startsWith('sec_owasp_llm01') || finding.rule_id.startsWith('sec_unicode') || finding.rule_id === 'sec_unbounded_persona') owaspRef = 'OWASP LLM01 — Prompt Injection';
                else if (finding.rule_id.startsWith('sec_owasp_llm02')) owaspRef = 'OWASP LLM02 — Sensitive Information Disclosure';
                else if (finding.rule_id === 'sec_unbounded_access' || finding.rule_id === 'sec_rag_injection') owaspRef = 'OWASP LLM07 — Insecure Plugin Design';

                const docsUrl = `https://github.com/meghal86/promptsonar/wiki/rules/${finding.rule_id}`;

                // Build 5-field hover message
                let message = `[PromptSonar] ${finding.rule_id}`;
                message += `\n${finding.explanation}`;
                if (owaspRef) message += `\n${owaspRef}`;
                message += `\nFix: ${finding.suggested_fix || 'Review and apply best practices.'}`;
                message += `\nDocs: ${docsUrl}`;

                diagnostics.push({
                    severity,
                    range: {
                        start: { line: prompt.startLine - 1, character: 0 },
                        end: { line: prompt.endLine - 1, character: Number.MAX_VALUE }
                    },
                    message,
                    source: 'PromptSonar',
                    code: finding.rule_id
                });
            }
        }

        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

        // Compute average score for status bar
        if (detectedPrompts.length > 0) {
            let totalScore = 0;
            let totalChars = 0;
            // Re-evaluate to get scores directly (or we could have saved them above)
            for (const prompt of detectedPrompts) {
                const evaluation = evaluatePrompt({ text: prompt.text, context: { filePath } }, config);
                totalScore += evaluation.score;
                totalChars += prompt.text.length;
            }
            const avgScore = Math.round(totalScore / detectedPrompts.length);
            const tokenEstimate = Math.ceil(totalChars / 4);
            connection.sendNotification('promptsonar/scanResult', { score: avgScore, file: uri, tokenEstimate });
        } else {
            connection.sendNotification('promptsonar/scanResult', { score: null, file: uri, tokenEstimate: 0 });
        }
    } catch (err) {
        console.error("PromptSonar LSP error:", err);
    }
}

connection.onCodeAction((params) => {
    const codeActions: CodeAction[] = [];
    const textDocument = documents.get(params.textDocument.uri);
    if (!textDocument) return codeActions;

    for (const diag of params.context.diagnostics) {
        const ruleId = diag.code as string;

        // QF-1: "Enforce JSON output" → struct_missing_format_enforcer
        if (ruleId === 'struct_missing_format_enforcer') {
            const insertText = '\nRespond ONLY in valid JSON. No preamble.\nFormat: {[DEFINE_SCHEMA_HERE]}';
            const fix = CodeAction.create(
                'Enforce JSON output',
                {
                    changes: {
                        [params.textDocument.uri]: [{
                            range: { start: diag.range.end, end: diag.range.end },
                            newText: insertText
                        }]
                    }
                },
                CodeActionKind.QuickFix
            );
            fix.diagnostics = [diag];
            codeActions.push(fix);

            // QF-5: "Wrap in delimiters" → struct_missing_format_enforcer
            const wrapFix = CodeAction.create(
                'Wrap in delimiters',
                {
                    changes: {
                        [params.textDocument.uri]: [
                            {
                                range: { start: diag.range.start, end: diag.range.start },
                                newText: '<instructions>'
                            },
                            {
                                range: { start: diag.range.end, end: diag.range.end },
                                newText: '</instructions>'
                            }
                        ]
                    }
                },
                CodeActionKind.QuickFix
            );
            wrapFix.diagnostics = [diag];
            codeActions.push(wrapFix);
        }

        // QF-2: "Add precise persona" → bp_missing_persona + sec_unbounded_persona
        if (ruleId === 'bp_missing_persona' || ruleId === 'sec_unbounded_persona') {
            const personaText = 'You are a [ROLE] who ONLY does [X].\nYou NEVER [Y].\n\n';
            const fix = CodeAction.create(
                'Add precise persona',
                {
                    changes: {
                        [params.textDocument.uri]: [{
                            range: { start: diag.range.start, end: diag.range.start },
                            newText: personaText
                        }]
                    }
                },
                CodeActionKind.QuickFix
            );
            fix.diagnostics = [diag];
            codeActions.push(fix);
        }

        // QF-3: "Add reasoning chain" → bp_missing_cot
        if (ruleId === 'bp_missing_cot') {
            const cotText = '\n\nThink step-by-step:\n1) Analyze the input\n2) Identify relevant info\n3) Apply the rules\n4) Verify before responding';
            const fix = CodeAction.create(
                'Add reasoning chain',
                {
                    changes: {
                        [params.textDocument.uri]: [{
                            range: { start: diag.range.end, end: diag.range.end },
                            newText: cotText
                        }]
                    }
                },
                CodeActionKind.QuickFix
            );
            fix.diagnostics = [diag];
            codeActions.push(fix);
        }

        // QF-4 (skipped — LLMLingua license pending): show info instead
        if (ruleId === 'eff_compression_potential') {
            codeActions.push(
                CodeAction.create(
                    '⚡ Compression available when licensed',
                    Command.create('⚡ Compression available when licensed', 'promptsonar.compress', params.textDocument.uri, diag.range),
                    CodeActionKind.QuickFix
                )
            );
        }

        // QF-5: "Wrap in delimiters" → consist_contradiction
        if (ruleId === 'consist_contradiction') {
            const wrapFix = CodeAction.create(
                'Wrap in delimiters',
                {
                    changes: {
                        [params.textDocument.uri]: [
                            {
                                range: { start: diag.range.start, end: diag.range.start },
                                newText: '<instructions>'
                            },
                            {
                                range: { start: diag.range.end, end: diag.range.end },
                                newText: '</instructions>'
                            }
                        ]
                    }
                },
                CodeActionKind.QuickFix
            );
            wrapFix.diagnostics = [diag];
            codeActions.push(wrapFix);
        }
    }
    return codeActions;
});

connection.onCodeLens(async (params): Promise<CodeLens[]> => {
    try {
        // Fetch configuration state to see if CodeLenses are enabled globally
        const settings = await connection.workspace.getConfiguration('promptsonar');
        if (settings && settings.enableCodeLens === false) {
            return [];
        }
    } catch (e) {
        // Configuration fetching might fail gracefully, proceed with default behavior
    }

    const textDocument = documents.get(params.textDocument.uri);
    if (!textDocument) return [];

    const text = textDocument.getText();
    const filePath = params.textDocument.uri.replace('file://', '');

    try {
        const detectedPrompts = await parseFile({
            filePath,
            content: text,
            language: ''
        });

        const lenses: CodeLens[] = [];
        for (const prompt of detectedPrompts) {
            const startPos = { line: prompt.startLine - 1, character: 0 };
            const endPos = { line: prompt.endLine - 1, character: Number.MAX_VALUE };
            lenses.push({
                range: { start: startPos, end: endPos },
                command: {
                    title: '▶ Run PromptSonar Health Check',
                    command: 'promptsonar.runScan',
                    arguments: [params.textDocument.uri, prompt.startLine, prompt.endLine]
                }
            });
        }
        return lenses;
    } catch (e) {
        return [];
    }
});

documents.listen(connection);
connection.listen();
