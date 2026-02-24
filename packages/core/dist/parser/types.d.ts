export interface DetectedPrompt {
    filePath: string;
    startLine: number;
    endLine: number;
    text: string;
    sourceType: "string_literal" | "framework_call" | "config_file" | "full_file" | "fallback_regex";
}
export interface ParserOptions {
    filePath: string;
    language: string;
    content: string;
}
