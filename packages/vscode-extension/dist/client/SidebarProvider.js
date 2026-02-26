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
exports.PromptSonarSidebarProvider = void 0;
const vscode = __importStar(require("vscode"));
class PromptSonarSidebarProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(context) {
        this.context = context;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        else {
            // Root items
            return Promise.resolve([
                new SidebarItem('Analyze Current File', vscode.TreeItemCollapsibleState.None, {
                    command: 'promptsonar.runScan',
                    title: 'Run Health Check on Active File',
                    arguments: []
                }, new vscode.ThemeIcon('play')),
                new SidebarItem('Scan Entire Workspace', vscode.TreeItemCollapsibleState.None, {
                    command: 'promptsonar.scanWorkspace',
                    title: 'Scan Workspace',
                    arguments: []
                }, new vscode.ThemeIcon('shield'))
            ]);
        }
    }
}
exports.PromptSonarSidebarProvider = PromptSonarSidebarProvider;
class SidebarItem extends vscode.TreeItem {
    label;
    collapsibleState;
    command;
    iconPath;
    constructor(label, collapsibleState, command, iconPath) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.command = command;
        this.iconPath = iconPath;
        this.tooltip = `${this.label}`;
        this.description = '';
    }
}
//# sourceMappingURL=SidebarProvider.js.map