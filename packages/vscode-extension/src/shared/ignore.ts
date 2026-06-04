import ignore, { Ignore } from 'ignore';
import * as path from 'path';

export interface PromptSonarIgnoreMatcher {
    rootPath: string;
    matcher: Ignore;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

export function parsePromptSonarIgnore(content: string, rootPath: string): PromptSonarIgnoreMatcher {
    return {
        rootPath: normalizePath(rootPath),
        matcher: ignore().add(content),
    };
}

export function isPromptSonarIgnoredPath(filePath: string, matchers: PromptSonarIgnoreMatcher[]): boolean {
    const normalizedFilePath = normalizePath(filePath);

    return matchers.some(({ rootPath, matcher }) => {
        const relativePath = normalizePath(path.relative(rootPath, normalizedFilePath));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath === '') {
            return false;
        }

        return matcher.ignores(relativePath);
    });
}
