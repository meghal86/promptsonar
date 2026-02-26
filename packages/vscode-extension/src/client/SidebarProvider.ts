import * as vscode from 'vscode';
import * as path from 'path';

export class PromptSonarSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SidebarItem | undefined | void> = new vscode.EventEmitter<SidebarItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SidebarItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SidebarItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SidebarItem): Thenable<SidebarItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            // Root items
            return Promise.resolve([
                new SidebarItem(
                    'Analyze Current File',
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'promptsonar.runScan',
                        title: 'Run Health Check on Active File',
                        arguments: []
                    },
                    new vscode.ThemeIcon('play')
                ),
                new SidebarItem(
                    'Scan Entire Workspace',
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'promptsonar.scanWorkspace',
                        title: 'Scan Workspace',
                        arguments: []
                    },
                    new vscode.ThemeIcon('shield')
                )
            ]);
        }
    }
}

class SidebarItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly iconPath?: vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | vscode.ThemeIcon
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}`;
        this.description = '';
    }
}
