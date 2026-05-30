import * as vscode from 'vscode';
import { evaluatePrompt, auditMcpConfig, type Finding, type McpAuditResult } from '@promptsonar/core';
import { isPromptFile, isMcpConfigFile, isScannable } from '../shared/detection';
import { buildPanelRows, type PanelRow } from '../shared/model';

// Live Execution Path side panel (Features 3, 4, 5, 6, 11).
//
// A TreeDataProvider that re-renders whenever the active prompt/MCP document
// changes. It reuses the bundled @promptsonar/core engine, so the panel shows
// the real execution path, confidence, evidence, root cause, and MCP summary —
// no synthetic data.

export class ExecutionPathItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly children?: ExecutionPathItem[],
    ) {
        super(label, collapsibleState);
    }
}

export class ExecutionPathProvider implements vscode.TreeDataProvider<ExecutionPathItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ExecutionPathItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: ExecutionPathItem[] = [];

    getTreeItem(element: ExecutionPathItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ExecutionPathItem): ExecutionPathItem[] {
        if (element) return element.children ?? [];
        return this.items;
    }

    // Re-scan the given document (if scannable) and refresh the tree.
    update(document?: vscode.TextDocument): void {
        if (!document || !isScannable(document.fileName, document.getText())) {
            this.items = [new ExecutionPathItem('Open a prompt or MCP file to trace its execution path.', vscode.TreeItemCollapsibleState.None)];
            this._onDidChangeTreeData.fire();
            return;
        }

        const text = document.getText();
        let findings: Finding[] = [];
        let mcpAudit: McpAuditResult | undefined;

        if (isMcpConfigFile(document.fileName)) {
            try {
                mcpAudit = auditMcpConfig(document.fileName, text);
            } catch {
                mcpAudit = undefined;
            }
        }
        if (isPromptFile(document.fileName, text)) {
            try {
                findings = evaluatePrompt({ text, context: { filePath: document.fileName } }).findings;
            } catch {
                findings = [];
            }
        }

        const rows = buildPanelRows(findings, mcpAudit);
        this.items = rows.length
            ? this.rowsToItems(rows)
            : [new ExecutionPathItem('No execution path detected.', vscode.TreeItemCollapsibleState.None)];
        this._onDidChangeTreeData.fire();
    }

    private rowsToItems(rows: PanelRow[]): ExecutionPathItem[] {
        return rows.map((row) => {
            const children = row.children ? this.rowsToItems(row.children) : undefined;
            const state = children && children.length
                ? row.expanded
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            const item = new ExecutionPathItem(row.label, state, children);
            if (row.description) item.description = row.description;
            return item;
        });
    }
}
