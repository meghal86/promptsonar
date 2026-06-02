import * as path from 'path';
import * as vscode from 'vscode';
import {
  CURSOR_COMMANDS,
  analyzeCursorDocument,
  applyCursorFixAndDiff,
  cursorDiagnosticsForFindings,
  cursorSarif,
  isCursorSupportedFile,
  type CursorAnalysisResult,
} from './analysis';
import {
  buildPanelRows,
  executionPathText,
  getQuickFixes,
  pickWorstWorkflowFinding,
  workflowDiffReport,
} from './shared';

class CursorExecutionPathItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: any,
    readonly children: CursorExecutionPathItem[] = [],
  ) {
    super(label, collapsibleState);
  }
}

class CursorExecutionPathProvider implements vscode.TreeDataProvider<CursorExecutionPathItem> {
  private readonly onDidChange = new vscode.EventEmitter<CursorExecutionPathItem | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChange.event;
  private items: CursorExecutionPathItem[] = [
    new CursorExecutionPathItem('Open a prompt, agent config, or MCP file.', vscode.TreeItemCollapsibleState.None),
  ];

  update(result?: CursorAnalysisResult): void {
    if (!result) {
      this.items = [new CursorExecutionPathItem('Open a prompt, agent config, or MCP file.', vscode.TreeItemCollapsibleState.None)];
    } else if (result.skipped) {
      this.items = [new CursorExecutionPathItem(`Skipped: ${result.skipped}`, vscode.TreeItemCollapsibleState.None)];
    } else {
      const rows = buildPanelRows(result.findings, result.mcpAudit);
      this.items = rows.length
        ? rows.map((row: any) => this.rowToItem(row))
        : [new CursorExecutionPathItem('No execution path detected.', vscode.TreeItemCollapsibleState.None)];
    }
    this.onDidChange.fire();
  }

  getTreeItem(element: CursorExecutionPathItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CursorExecutionPathItem): CursorExecutionPathItem[] {
    return element?.children || this.items;
  }

  private rowToItem(row: any): CursorExecutionPathItem {
    const children = row.children?.map((child: any) => this.rowToItem(child)) || [];
    const item = new CursorExecutionPathItem(
      row.label,
      children.length
        ? row.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      children,
    );
    item.description = row.description;
    return item;
  }
}

class CursorQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const text = document.getText();
    const actions: vscode.CodeAction[] = [];
    const seen = new Set<string>();
    for (const diagnostic of context.diagnostics.filter((item) => item.source === 'PromptSonar Cursor')) {
      const ruleId = typeof diagnostic.code === 'object' ? String((diagnostic.code as any).value) : String(diagnostic.code);
      for (const fix of getQuickFixes({ rule_id: ruleId }, text)) {
        const key = `${fix.title}:${fix.search}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const index = text.indexOf(fix.search);
        if (index < 0) continue;
        const action = new vscode.CodeAction(`PromptSonar: ${fix.title}`, vscode.CodeActionKind.QuickFix);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(index), document.positionAt(index + fix.search.length)), fix.replacement);
        action.edit = edit;
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    }
    return actions;
  }
}

const DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', language: 'markdown' },
  { scheme: 'file', language: 'plaintext' },
  { scheme: 'file', language: 'json' },
  { scheme: 'file', language: 'yaml' },
  { scheme: 'file', pattern: '**/*.{prompt,md,txt,json,yml,yaml}' },
];

function configNumber(key: string, fallback: number): number {
  return vscode.workspace.getConfiguration('promptsonar.cursor').get<number>(key, fallback);
}

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection('PromptSonar Cursor');
  const provider = new CursorExecutionPathProvider();
  let timer: NodeJS.Timeout | undefined;
  let lastResult: CursorAnalysisResult | undefined;
  let lastDocument: vscode.TextDocument | undefined;

  context.subscriptions.push(
    diagnostics,
    vscode.window.registerTreeDataProvider('promptsonar-cursor-execution-path', provider),
    vscode.languages.registerCodeActionsProvider(
      DOCUMENT_SELECTOR,
      new CursorQuickFixProvider(),
      { providedCodeActionKinds: CursorQuickFixProvider.providedKinds },
    ),
  );

  const scanDocument = (document?: vscode.TextDocument): CursorAnalysisResult | undefined => {
    if (!document || !isCursorSupportedFile(document.fileName, document.getText())) {
      diagnostics.clear();
      provider.update(undefined);
      return undefined;
    }

    const result = analyzeCursorDocument(document.fileName, document.getText(), {
      maxFileSizeBytes: configNumber('maxFileSizeBytes', 1048576),
    });
    lastResult = result;
    lastDocument = document;
    diagnostics.set(document.uri, cursorDiagnosticsForFindings(result.findings, document.getText().length).map((item) => {
      const severity = item.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : item.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(document.positionAt(item.start), document.positionAt(item.end)),
        item.message,
        severity,
      );
      diagnostic.source = 'PromptSonar Cursor';
      diagnostic.code = item.ruleId;
      return diagnostic;
    }));
    provider.update(result);
    return result;
  };

  const scheduleScan = (document?: vscode.TextDocument) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => scanDocument(document), configNumber('debounceMs', 300));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleScan),
    vscode.workspace.onDidSaveTextDocument(scheduleScan),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleScan(event.document)),
    vscode.window.onDidChangeActiveTextEditor((editor) => scheduleScan(editor?.document)),
  );

  if (vscode.window.activeTextEditor) scheduleScan(vscode.window.activeTextEditor.document);

  const activeScan = async (): Promise<CursorAnalysisResult | undefined> => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      vscode.window.showErrorMessage('PromptSonar: no active file.');
      return undefined;
    }
    const result = scanDocument(document);
    if (result?.skipped === 'unsupported_file') {
      vscode.window.showInformationMessage('PromptSonar: open a prompt, agent config, or MCP file first.');
      return undefined;
    }
    return result;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(CURSOR_COMMANDS[0], activeScan),
    vscode.commands.registerCommand(CURSOR_COMMANDS[1], async () => {
      await activeScan();
      await vscode.commands.executeCommand('workbench.view.extension.promptsonar-cursor-sidebar');
    }),
    vscode.commands.registerCommand(CURSOR_COMMANDS[2], async () => {
      const result = await activeScan();
      const workflow = result ? pickWorstWorkflowFinding(result.findings)?.workflow : undefined;
      const replay = workflow?.workflow_replay
        ? workflow.workflow_replay.events.map((event: any) => `${event.index}. ${event.type}: ${event.riskTransition || event.risk_transition}`).join('\n')
        : 'No workflow replay emitted.';
      const doc = await vscode.workspace.openTextDocument({ content: `PromptSonar Workflow Replay\n\n${replay}`, language: 'markdown' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand(CURSOR_COMMANDS[3], async () => {
      const result = await activeScan();
      const workflow = result ? pickWorstWorkflowFinding(result.findings)?.workflow : undefined;
      const doc = await vscode.workspace.openTextDocument({ content: workflowDiffReport(workflow), language: 'markdown' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand(CURSOR_COMMANDS[4], async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) return;
      const fix = applyCursorFixAndDiff(document.fileName, document.getText());
      if (!fix.changed) {
        vscode.window.showInformationMessage('PromptSonar: no deterministic fixes matched this file.');
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), fix.fixed);
      await vscode.workspace.applyEdit(edit);
      const doc = await vscode.workspace.openTextDocument({ content: fix.diffReport, language: 'markdown' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand(CURSOR_COMMANDS[5], async () => {
      const result = await activeScan();
      const document = vscode.window.activeTextEditor?.document;
      if (!result || !document) return;
      const output = vscode.Uri.file(path.join(path.dirname(document.fileName), 'promptsonar-cursor.sarif'));
      await vscode.workspace.fs.writeFile(output, Buffer.from(cursorSarif(document.fileName, result), 'utf8'));
      vscode.window.showInformationMessage(`PromptSonar SARIF exported to ${output.fsPath}`);
    }),
    vscode.commands.registerCommand(CURSOR_COMMANDS[6], async () => {
      const result = lastResult || await activeScan();
      if (!result || !lastDocument) return;
      await vscode.env.clipboard.writeText(result.report || executionPathText(pickWorstWorkflowFinding(result.findings)?.workflow));
      vscode.window.showInformationMessage('PromptSonar report copied.');
    }),
    vscode.commands.registerCommand(CURSOR_COMMANDS[7], async () => {
      await vscode.env.openExternal(vscode.Uri.parse('https://github.com/meghal86/promptsonar#runtime-execution-path-review'));
    }),
  );
}

export function deactivate() {
  // Cursor unload hook.
}
