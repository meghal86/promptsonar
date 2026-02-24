const Parser = require('web-tree-sitter');
import * as fs from 'fs';
import * as path from 'path';
import { DetectedPrompt, ParserOptions } from './types';

// Export types
export * from './types';

const KEYWORDS = ["system", "user", "assistant", "prompt", "instruction", "You are", "Ignore previous"];
const FULL_FILE_EXTENSIONS = ['.prompt', '.ai', '.chat'];
const CONFIG_FILE_EXTENSIONS = ['.json', '.yml', '.yaml'];

// Module-level cache for WASM languages
const LANGUAGE_CACHE: Record<string, any> = {};
let parserInitialized = false;

async function initParser() {
    if (!parserInitialized) {
        await Parser.init();
        parserInitialized = true;
    }
}

function getWasmPath(langName: string): string {
    // Try to find the tree-sitter-wasms module path
    try {
        const wasmsDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
        return path.join(wasmsDir, 'out', `tree-sitter-${langName}.wasm`);
    } catch (e) {
        // Fallback if not found (e.g. tests running in weird environments)
        return path.join(__dirname, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${langName}.wasm`);
    }
}

async function getLanguage(langName: string): Promise<any> {
    await initParser();
    if (!LANGUAGE_CACHE[langName]) {
        const wasmPath = getWasmPath(langName);
        LANGUAGE_CACHE[langName] = await Parser.Language.load(wasmPath);
    }
    return LANGUAGE_CACHE[langName];
}

function getLanguageName(extension: string): string | null {
    switch (extension) {
        case '.py': return 'python';
        case '.ts':
        case '.js':
        case '.tsx':
        case '.jsx': return 'typescript'; // Use typescript for both JS and TS
        case '.go': return 'go';
        case '.java': return 'java';
        case '.rs': return 'rust';
        case '.cs': return 'c_sharp';
        default: return null;
    }
}

function containsPromptKeyword(text: string): boolean {
    const lowerText = text.toLowerCase();
    return KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

export async function parseFile(options: ParserOptions): Promise<DetectedPrompt[]> {
    const { filePath, content, language } = options;
    const ext = path.extname(filePath).toLowerCase();
    const results: DetectedPrompt[] = [];

    // Rule 4: Full file extensions
    if (FULL_FILE_EXTENSIONS.includes(ext)) {
        return [{
            filePath,
            startLine: 1,
            endLine: content.split('\n').length,
            text: content,
            sourceType: "full_file"
        }];
    }

    // Rule 5 & 6: Config files (JSON, YAML, MCP, Github Actions)
    if (CONFIG_FILE_EXTENSIONS.includes(ext) || filePath.includes('.github/workflows')) {
        // Simple regex for configs containing prompt keywords or fields
        const lines = content.split('\n');
        let inBlock = false;
        let blockStart = 0;
        let blockText = [];

        // Simple heuristic: just find any line with prompt keywords and grab it, or multiline strings in yaml
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (containsPromptKeyword(line)) {
                // Include a small context around it or just the line if it's long enough
                if (line.length > 20) {
                    results.push({
                        filePath,
                        startLine: i + 1,
                        endLine: i + 1,
                        text: line.trim(),
                        sourceType: "config_file"
                    });
                }
            }
        }

        // Also try generic string scanning since configs can have multiline strings
        const jsonMatches = [...content.matchAll(/"(system|user|messages|prompt|instruction)"\s*:\s*"([^"]+)"/gi)];
        for (const match of jsonMatches) {
            const text = match[2];
            const linesUntilMatch = content.slice(0, match.index).split('\n');
            results.push({
                filePath,
                startLine: linesUntilMatch.length,
                endLine: linesUntilMatch.length + text.split('\n').length - 1,
                text,
                sourceType: "config_file"
            });
        }
    }

    // Tree-sitter parsing for supported languages
    const tsLangName = language || getLanguageName(ext);

    if (tsLangName) {
        try {
            const lang = await getLanguage(tsLangName);
            const parser = new Parser();
            parser.setLanguage(lang);
            const tree = parser.parse(content);

            // Load query from queries directory
            // We look up from core/dist/parser/index.js -> /queries
            // Use process.cwd() or find root
            const rootDir = path.resolve(__dirname, '..', '..', '..', '..');
            const queryPath = path.join(rootDir, 'queries', `${tsLangName}.scm`);

            if (fs.existsSync(queryPath)) {
                const queryString = fs.readFileSync(queryPath, 'utf8');
                const query = lang.query(queryString);
                const matches = query.matches(tree.rootNode);

                for (const match of matches) {
                    for (const capture of match.captures) {
                        const nodeInfo = {
                            filePath,
                            startLine: capture.node.startPosition.row + 1,
                            endLine: capture.node.endPosition.row + 1,
                            text: capture.node.text
                        };

                        if (capture.name.includes("prompt.string") && containsPromptKeyword(capture.node.text)) {
                            // It's a string, ensure we strip quotes
                            let cleanedText = capture.node.text;
                            if (cleanedText.startsWith('"""') || cleanedText.startsWith("'''")) {
                                cleanedText = cleanedText.slice(3, -3);
                            } else if (cleanedText.startsWith('"') || cleanedText.startsWith("'") || cleanedText.startsWith("`")) {
                                cleanedText = cleanedText.slice(1, -1);
                            }
                            results.push({ ...nodeInfo, text: cleanedText, sourceType: "string_literal" });
                        } else if (capture.name.includes("prompt.framework")) {
                            results.push({ ...nodeInfo, sourceType: "framework_call" });
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(`[PromptSonar] Error parsing ${filePath} with tree-sitter:`, err);
        }
    }

    // Fallback: regex for triple-quoted strings + keyword search
    if (results.length === 0 && !tsLangName) {
        const tripleQuoteRegex = /("""|'''|`)([\s\S]*?)\1/g;
        let match;
        while ((match = tripleQuoteRegex.exec(content)) !== null) {
            const matchText = match[2];
            if (containsPromptKeyword(matchText)) {
                const linesBefore = content.slice(0, match.index).split('\n').length;
                const lineCount = matchText.split('\n').length;
                results.push({
                    filePath,
                    startLine: linesBefore,
                    endLine: linesBefore + lineCount - 1,
                    text: matchText,
                    sourceType: "fallback_regex"
                });
            }
        }
    }

    // Deduplicate by line range
    const uniqueResults = [];
    const seen = new Set();
    for (const r of results) {
        const key = `${r.startLine}-${r.endLine}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueResults.push(r);
        }
    }

    return uniqueResults;
}
