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
exports.PromptSonarCodeLensProvider = void 0;
const vscode = __importStar(require("vscode"));
// @ts-ignore
const core_1 = require("core");
class PromptSonarCodeLensProvider {
    async provideCodeLenses(document, token) {
        const text = document.getText();
        const filePath = document.uri.fsPath;
        try {
            const detectedPrompts = await (0, core_1.parseFile)({
                filePath,
                content: text,
                language: ''
            });
            const lenses = [];
            for (const prompt of detectedPrompts) {
                const range = new vscode.Range(prompt.startLine - 1, 0, prompt.endLine - 1, 0);
                lenses.push(new vscode.CodeLens(range, {
                    title: '▶ Run PromptSonar Health Check',
                    command: 'promptsonar.runScan',
                    arguments: [document.uri, prompt.startLine, prompt.endLine]
                }));
            }
            return lenses;
        }
        catch (e) {
            return [];
        }
    }
}
exports.PromptSonarCodeLensProvider = PromptSonarCodeLensProvider;
//# sourceMappingURL=CodeLensProvider.js.map