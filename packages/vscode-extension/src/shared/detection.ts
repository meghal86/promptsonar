// Prompt-file and MCP-config detection (Feature 1).
//
// Pure and dependency-free so it can be unit-tested and shared by both the LSP
// server (diagnostics) and the client (panel / commands). Accepts a path or a
// document URI string.

const PROMPT_SUFFIXES = [
    '.prompt',
    '.prompt.md',
    '.prompt.txt',
    '.prompt.yaml',
    '.prompt.yml',
    '.prompt.json',
];

const PLAIN_PROMPT_EXT = /\.(md|txt)$/i;
const STRUCTURED_EXT = /\.(ya?ml|json)$/i;
const PROMPT_NAME_HINT =
    /(prompt|agent|system|instruction|persona|llm|copilot|claude|cursor|skill|\.ai)/i;
const PROMPT_CONTENT_HINT = /(^|\n)\s*(system|assistant|user|developer)\s*:/i;

const MCP_FILE_PATTERNS: RegExp[] = [
    /(^|[\\/])mcp\.(json|ya?ml)$/i,
    /(^|[\\/])mcp\.config\.json$/i,
    /\.mcp\.(json|ya?ml)$/i,
    /(^|[\\/])[^\\/]*mcp[^\\/]*\.(json|ya?ml)$/i,
];

function baseName(filePath: string): string {
    const cleaned = filePath.replace(/\\/g, '/').replace(/[?#].*$/, '');
    const parts = cleaned.split('/');
    return parts[parts.length - 1] || cleaned;
}

export function isMcpConfigFile(filePath: string): boolean {
    return MCP_FILE_PATTERNS.some((p) => p.test(filePath.toLowerCase()));
}

// Name-based prompt detection (no content needed).
export function isPromptFileName(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    if (PROMPT_SUFFIXES.some((s) => lower.endsWith(s))) return true;
    if (STRUCTURED_EXT.test(lower) && PROMPT_NAME_HINT.test(baseName(lower))) return true;
    return false;
}

// Full prompt detection. `content` is optional so callers can do a cheap name
// check first; for plain .md/.txt with content we require a chat-style hint to
// avoid linting ordinary prose.
export function isPromptFile(filePath: string, content?: string): boolean {
    if (isPromptFileName(filePath)) return true;
    if (PLAIN_PROMPT_EXT.test(filePath.toLowerCase())) {
        return content === undefined ? true : PROMPT_CONTENT_HINT.test(content);
    }
    return false;
}

// True when PromptSonar should react to a file at all.
export function isScannable(filePath: string, content?: string): boolean {
    return isPromptFile(filePath, content) || isMcpConfigFile(filePath);
}
