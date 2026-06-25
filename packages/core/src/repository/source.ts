import * as fs from 'fs';
import * as path from 'path';

export type RepositoryFileMetadata = {
    path: string;
    size?: number;
    objectId?: string;
};

export type RepositoryFileContent = RepositoryFileMetadata & {
    content: string;
};

export type FetchOptions = {
    maxBytes?: number;
    maxFiles?: number;
    requestCost?: number;
};

export type RepositoryAcquisitionUsage = {
    requestsUsed: number;
    requestLimit: number;
    bytesFetched: number;
    filesFetched: number;
    cacheHits: number;
    retries: number;
    rateLimitRemaining?: number;
};

export type RepositorySourceCapabilities = {
    localSearch: boolean;
    archiveDownload: boolean;
    concurrentFetch: boolean;
    blobCache: boolean;
};

export interface RepositorySourceAdapter {
    inventory(): Promise<RepositoryFileMetadata[]>;
    fetchFiles(paths: string[], options?: FetchOptions): Promise<RepositoryFileContent[]>;
    getBudgetUsage(): RepositoryAcquisitionUsage;
    getCapabilities(): RepositorySourceCapabilities;
}

const DEFAULT_REQUEST_LIMIT = Number.MAX_SAFE_INTEGER;
const DEFAULT_IGNORED_DIRECTORIES = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.turbo',
    '.vercel',
    '.cache',
    'tmp',
    'logs',
    'venv',
    '.venv',
    'env',
    'site-packages',
    'dist-packages',
    'vendor',
    'target',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    '.idea',
    '.vscode-test',
]);

function emptyUsage(requestLimit = DEFAULT_REQUEST_LIMIT): RepositoryAcquisitionUsage {
    return {
        requestsUsed: 0,
        requestLimit,
        bytesFetched: 0,
        filesFetched: 0,
        cacheHits: 0,
        retries: 0,
    };
}

function normalizeRepositoryPath(value: string): string {
    return value.replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

function uniqueSortedPaths(paths: string[]): string[] {
    return Array.from(new Set(paths.map(normalizeRepositoryPath).filter(Boolean))).sort();
}

function canUseRequestBudget(usage: RepositoryAcquisitionUsage, requestCost: number): boolean {
    return requestCost <= 0 || usage.requestsUsed + requestCost <= usage.requestLimit;
}

export class LocalCheckoutSource implements RepositorySourceAdapter {
    private usage: RepositoryAcquisitionUsage;

    constructor(
        private readonly rootPath: string,
        private readonly options: { ignoredDirectories?: ReadonlySet<string>; requestLimit?: number } = {},
    ) {
        this.usage = emptyUsage(options.requestLimit);
    }

    async inventory(): Promise<RepositoryFileMetadata[]> {
        const root = path.resolve(this.rootPath);
        const stat = fs.statSync(root);
        if (!stat.isDirectory()) {
            return [{ path: path.basename(root), size: stat.size }];
        }

        const ignoredDirectories = this.options.ignoredDirectories || DEFAULT_IGNORED_DIRECTORIES;
        const files: RepositoryFileMetadata[] = [];
        const visit = (dir: string) => {
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!ignoredDirectories.has(entry.name)) visit(fullPath);
                    continue;
                }
                if (!entry.isFile()) continue;
                try {
                    const relativePath = normalizeRepositoryPath(path.relative(root, fullPath));
                    const fileStat = fs.statSync(fullPath);
                    files.push({ path: relativePath, size: fileStat.size });
                } catch {
                    // Inventory is best-effort per file; unreadable files are omitted.
                }
            }
        };

        visit(root);
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    async fetchFiles(paths: string[], options: FetchOptions = {}): Promise<RepositoryFileContent[]> {
        const root = path.resolve(this.rootPath);
        const files: RepositoryFileContent[] = [];
        let bytesFetched = 0;

        const requestCost = options.requestCost || 0;
        for (const relativePath of uniqueSortedPaths(paths).slice(0, options.maxFiles)) {
            if (!canUseRequestBudget(this.usage, requestCost)) break;
            const fullPath = path.join(root, relativePath);
            const stat = fs.statSync(fullPath);
            const nextBytes = stat.size;
            if (options.maxBytes !== undefined && bytesFetched + nextBytes > options.maxBytes) break;
            const content = fs.readFileSync(fullPath, 'utf-8');
            bytesFetched += Buffer.byteLength(content, 'utf-8');
            this.usage.requestsUsed += requestCost;
            files.push({ path: relativePath, size: stat.size, content });
        }

        this.usage.bytesFetched += bytesFetched;
        this.usage.filesFetched += files.length;
        return files;
    }

    getBudgetUsage(): RepositoryAcquisitionUsage {
        return { ...this.usage };
    }

    getCapabilities() {
        return {
            localSearch: true,
            archiveDownload: false,
            concurrentFetch: false,
            blobCache: false,
        };
    }
}

export class InMemoryRepositorySource implements RepositorySourceAdapter {
    private usage: RepositoryAcquisitionUsage;
    private readonly filesByPath: Map<string, RepositoryFileContent>;

    constructor(files: RepositoryFileContent[], requestLimit = DEFAULT_REQUEST_LIMIT) {
        this.usage = emptyUsage(requestLimit);
        this.filesByPath = new Map(files.map(file => {
            const normalized = normalizeRepositoryPath(file.path);
            const content = String(file.content || '');
            return [normalized, {
                ...file,
                path: normalized,
                size: file.size ?? Buffer.byteLength(content, 'utf-8'),
                content,
            }];
        }));
    }

    async inventory(): Promise<RepositoryFileMetadata[]> {
        return Array.from(this.filesByPath.values())
            .map(({ path: filePath, size, objectId }) => ({ path: filePath, size, objectId }))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    async fetchFiles(paths: string[], options: FetchOptions = {}): Promise<RepositoryFileContent[]> {
        const files: RepositoryFileContent[] = [];
        let bytesFetched = 0;
        const requestCost = options.requestCost || 0;
        for (const relativePath of uniqueSortedPaths(paths).slice(0, options.maxFiles)) {
            if (!canUseRequestBudget(this.usage, requestCost)) break;
            const file = this.filesByPath.get(relativePath);
            if (!file) continue;
            const nextBytes = Buffer.byteLength(file.content, 'utf-8');
            if (options.maxBytes !== undefined && bytesFetched + nextBytes > options.maxBytes) break;
            bytesFetched += nextBytes;
            this.usage.requestsUsed += requestCost;
            files.push({ ...file });
        }
        this.usage.filesFetched += files.length;
        this.usage.bytesFetched += bytesFetched;
        return files;
    }

    getBudgetUsage(): RepositoryAcquisitionUsage {
        return { ...this.usage };
    }

    getCapabilities() {
        return {
            localSearch: true,
            archiveDownload: false,
            concurrentFetch: false,
            blobCache: true,
        };
    }
}

abstract class UnsupportedRepositorySource implements RepositorySourceAdapter {
    protected usage = emptyUsage(0);

    async inventory(): Promise<RepositoryFileMetadata[]> {
        throw new Error(`${this.constructor.name} is a Gate 1 skeleton and is not implemented yet.`);
    }

    async fetchFiles(): Promise<RepositoryFileContent[]> {
        throw new Error(`${this.constructor.name} is a Gate 1 skeleton and is not implemented yet.`);
    }

    getBudgetUsage(): RepositoryAcquisitionUsage {
        return { ...this.usage };
    }

    abstract getCapabilities(): RepositorySourceCapabilities;
}

export class UploadedArchiveSource extends UnsupportedRepositorySource {
    getCapabilities() {
        return { localSearch: true, archiveDownload: true, concurrentFetch: false, blobCache: true };
    }
}

export class GitHubArchiveSource extends UnsupportedRepositorySource {
    getCapabilities() {
        return { localSearch: true, archiveDownload: true, concurrentFetch: false, blobCache: true };
    }
}

export class GitHubTreeSource extends UnsupportedRepositorySource {
    getCapabilities() {
        return { localSearch: false, archiveDownload: false, concurrentFetch: true, blobCache: true };
    }
}

export async function inventoryRepositoryFiles(
    source: RepositorySourceAdapter | string | RepositoryFileContent[],
): Promise<RepositoryFileMetadata[]> {
    if (typeof source === 'string') return new LocalCheckoutSource(source).inventory();
    if (Array.isArray(source)) return new InMemoryRepositorySource(source).inventory();
    return source.inventory();
}
