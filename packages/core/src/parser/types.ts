export interface DetectedPrompt {
    filePath: string;
    startLine: number;
    endLine: number;
    text: string;
    sourceType: "full_file" | "string_literal" | "named_variable" | "framework_call" | "config_file" | "fallback_regex";
}

export interface ParserOptions {
    filePath: string;
    language: string;
    content: string;
}
