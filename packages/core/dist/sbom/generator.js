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
exports.generatePromptSBOM = generatePromptSBOM;
const crypto = __importStar(require("crypto"));
/**
 * Generates a CycloneDX v1.4 compatible AI Prompt SBOM from promptsonar scan results.
 */
function generatePromptSBOM(results, projectName = "promptsonar-scan") {
    const components = [];
    for (const result of results) {
        const basename = result.filePath.split('/').pop() || result.filePath;
        // Generate a pseudo-version based on the file content or path
        const versionHash = crypto.createHash('sha1').update(result.filePath).digest('hex').substring(0, 8);
        let mitigated = true;
        if (result.findings && result.findings.length > 0) {
            mitigated = !result.findings.some(f => f.severity === 'critical' || f.severity === 'high');
        }
        const score = result.overall_score ?? result.score ?? 100;
        components.push({
            type: 'prompt',
            name: basename,
            version: versionHash,
            description: `Prompt extracted from ${result.filePath}`,
            properties: [
                { name: 'promptsonar.score', value: score.toString() },
                { name: 'owasp.llm01', value: mitigated ? 'mitigated' : 'vulnerable' }
            ]
        });
    }
    const sbom = {
        $schema: "https://promptsonar.com/sbom-0.2.json",
        bomFormat: "CycloneDX",
        specVersion: "1.4",
        version: 1,
        serialNumber: `urn:uuid:${crypto.randomUUID()}`,
        components,
        dependencies: [] // Future extension for prompt dependency chaining
    };
    return JSON.stringify(sbom, null, 2);
}
