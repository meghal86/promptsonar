// Minimal functional mock of the VS Code API for vitest (no real editor host).
// Aliased to `vscode` via vitest.config.ts so provider classes can be tested.

export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }

export class Position {
    constructor(public line: number, public character: number) {}
}
export class Range {
    constructor(public a?: unknown, public b?: unknown, public c?: unknown, public d?: unknown) {}
}
export class Selection extends Range {}
export class Diagnostic {
    source?: string;
    code?: string;
    constructor(public range: Range, public message: string, public severity: DiagnosticSeverity) {}
}
export class TreeItem {
    description?: string;
    constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) {}
}
export class CodeAction {
    edit?: WorkspaceEdit;
    diagnostics?: Diagnostic[];
    constructor(public title: string, public kind?: unknown) {}
}
export const CodeActionKind = { QuickFix: 'quickfix' };
export class WorkspaceEdit {
    edits: Array<{ range: Range; newText: string }> = [];
    replace(_uri: unknown, range: Range, newText: string): void {
        this.edits.push({ range, newText });
    }
}
export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (l: (e: T) => void) => { this.listeners.push(l); return { dispose() {} }; };
    fire(e?: T): void { this.listeners.forEach((l) => l(e as T)); }
}

export interface MockDoc {
    fileName: string;
    uri: { toString(): string; fsPath: string };
    getText(): string;
    positionAt(offset: number): Position;
}
export function makeDoc(fileName: string, text: string): MockDoc {
    return {
        fileName,
        uri: { toString: () => `file://${fileName}`, fsPath: fileName },
        getText: () => text,
        positionAt: (offset: number) => new Position(0, offset),
    };
}

export const ViewColumn = { Beside: 2, One: 1 };
export class Uri { static file(p: string) { return { fsPath: p, toString: () => `file://${p}` }; } }

export default {
    DiagnosticSeverity, TreeItemCollapsibleState, Position, Range, Selection,
    Diagnostic, TreeItem, CodeAction, CodeActionKind, WorkspaceEdit, EventEmitter,
    ViewColumn, Uri,
};
