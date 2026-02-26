const mockVSCode = {
    workspace: { createFileSystemWatcher: () => ({}) },
    ExtensionContext: {},
    window: {
        createStatusBarItem: () => ({ show: () => { }, hide: () => { } }),
        registerTreeDataProvider: () => { }
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: class ThemeColor { },
    commands: { registerCommand: () => ({}) },
    Uri: { parse: () => ({}) },
    languages: { registerCodeLensProvider: () => ({}) },
    CodeLens: class CodeLens { },
    Range: class Range { },
    TreeItem: class TreeItem { },
    ThemeIcon: class ThemeIcon { },
    EventEmitter: class EventEmitter { event = {}; fire() { } }
};

const mockModule = require('module');
const originalRequire = mockModule.prototype.require;
mockModule.prototype.require = function (id) {
    if (id === 'vscode') return mockVSCode;
    return originalRequire.apply(this, arguments);
};

try {
    const ext = require('./dist/client/extension');
    const mockContext = {
        asAbsolutePath: (p) => p,
        subscriptions: { push: () => { } }
    };
    ext.activate(mockContext);
    console.log("ACTIVATION SUCCESS");
} catch (e) {
    console.error("ACTIVATION ERROR:", e);
}
