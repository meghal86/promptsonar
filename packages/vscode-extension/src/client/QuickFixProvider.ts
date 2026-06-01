import * as vscode from 'vscode';
import { getQuickFixes } from '../shared/quickfix';

// Deterministic quick fixes (Feature 7). Offers safer-pattern rewrites for any
// PromptSonar diagnostic under the cursor. All edits are pure string rewrites —
// no AI, no LLM, no network.
export class PromptSonarQuickFixProvider implements vscode.CodeActionProvider {
    static readonly providedKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        const text = document.getText();
        const ours = context.diagnostics.filter(
            (d) => typeof d.source === 'string' && d.source.startsWith('PromptSonar') && typeof d.code !== 'undefined',
        );
        const actions: vscode.CodeAction[] = [];
        const seen = new Set<string>();

        for (const diag of ours) {
            const ruleId = typeof diag.code === 'object' && diag.code ? String((diag.code as any).value) : String(diag.code);
            for (const fix of getQuickFixes({ rule_id: ruleId }, text)) {
                const key = fix.title + '::' + fix.search;
                if (seen.has(key)) continue;
                seen.add(key);
                const index = text.indexOf(fix.search);
                if (index < 0) continue;

                const action = new vscode.CodeAction(`PromptSonar Fix: ${fix.title}`, vscode.CodeActionKind.QuickFix);
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(document.positionAt(index), document.positionAt(index + fix.search.length)),
                    fix.replacement,
                );
                action.edit = edit;
                action.diagnostics = [diag];
                actions.push(action);
            }
        }
        return actions;
    }
}
