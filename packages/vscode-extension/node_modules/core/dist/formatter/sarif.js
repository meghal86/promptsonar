"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatToSarif = formatToSarif;
function formatToSarif(findings, filePath) {
    const sarifOutput = {
        version: "2.1.0",
        $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        runs: [
            {
                tool: {
                    driver: {
                        name: "PromptSonar",
                        informationUri: "https://github.com/meghal86/promptsonar",
                        rules: []
                    }
                },
                results: []
            }
        ]
    };
    const rulesSet = new Set();
    findings.forEach(f => {
        // Map rules to the driver
        if (!rulesSet.has(f.rule_id)) {
            rulesSet.add(f.rule_id);
            sarifOutput.runs[0].tool.driver.rules.push({
                id: f.rule_id,
                shortDescription: {
                    text: f.category.replace('_', ' ').toUpperCase() + " Violation"
                },
                fullDescription: {
                    text: f.explanation
                },
                help: {
                    text: f.suggested_fix || "Review prompt and apply best practices."
                },
                properties: {
                    category: f.category,
                    precision: "very-high"
                }
            });
        }
        // Map findings to results
        // SARIF severity levels: error, warning, note
        let level = "note";
        if (f.severity === "critical" || f.severity === "high")
            level = "error";
        else if (f.severity === "medium")
            level = "warning";
        sarifOutput.runs[0].results.push({
            ruleId: f.rule_id,
            level: level,
            message: {
                text: f.explanation + " - Fix: " + (f.suggested_fix || "None")
            },
            locations: [
                {
                    physicalLocation: {
                        artifactLocation: {
                            uri: filePath,
                            uriBaseId: "%SRCROOT%"
                        },
                        region: {
                            // Without explicit line numbers passed into Finding, we default to line 1.
                            // Assuming we just map to the file level if lines aren't precise in Finding.
                            startLine: 1,
                            startColumn: 1
                        }
                    }
                }
            ]
        });
    });
    return JSON.stringify(sarifOutput, null, 2);
}
