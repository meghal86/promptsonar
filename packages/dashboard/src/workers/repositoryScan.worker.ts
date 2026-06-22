type RepositoryPayloadFile = {
  path: string;
  content: string;
};

type WorkerRequest = {
  id: string;
  files: RepositoryPayloadFile[];
  repositoryName: string;
};

type WorkerProgressMessage = {
  type: 'progress';
  id: string;
  message: string;
};

type WorkerCompleteMessage = {
  type: 'complete';
  id: string;
  report: unknown;
  scan: unknown;
};

type WorkerErrorMessage = {
  type: 'error';
  id: string;
  error: string;
};

const INITIAL_BATCH_SIZE = 8;
const REQUEST_TIMEOUT_MS = 45_000;

function postProgress(id: string, message: string) {
  self.postMessage({ type: 'progress', id, message } satisfies WorkerProgressMessage);
}

function timeoutError(): Error {
  return Object.assign(new Error('Repository scan request timed out.'), { timedOut: true });
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(
    (error as { timedOut?: boolean })?.timedOut ||
    ((error as Error)?.name === 'AbortError')
  );
}

async function postJson<T>(body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
  try {
    const response = await fetch('/api/repository/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Repository scan failed (${response.status})`);
    }
    return data as T;
  } catch (error) {
    if (isTimeoutError(error)) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type BatchScanResult = {
  results: unknown[];
  filesWritten: number;
  filesSkipped: number;
};

async function scanBatch(
  id: string,
  batch: RepositoryPayloadFile[],
  progressLabel: string,
): Promise<BatchScanResult> {
  try {
    postProgress(id, `${progressLabel} (${batch.length} file${batch.length === 1 ? '' : 's'})…`);
    const data = await postJson<{
      results: unknown[];
      scan?: { filesWritten?: number; filesSkipped?: number };
    }>({
      action: 'scan',
      files: batch,
    });
    return {
      results: data.results || [],
      filesWritten: data.scan?.filesWritten || 0,
      filesSkipped: data.scan?.filesSkipped || 0,
    };
  } catch (error) {
    if (!isTimeoutError(error)) throw error;
    if (batch.length === 1) {
      postProgress(id, `Skipping slow file: ${batch[0].path}`);
      return { results: [], filesWritten: 0, filesSkipped: 1 };
    }
    const midpoint = Math.ceil(batch.length / 2);
    postProgress(id, `A scan batch was slow; splitting ${batch.length} files into smaller batches…`);
    const left = await scanBatch(id, batch.slice(0, midpoint), `${progressLabel} split A`);
    const right = await scanBatch(id, batch.slice(midpoint), `${progressLabel} split B`);
    return {
      results: [...left.results, ...right.results],
      filesWritten: left.filesWritten + right.filesWritten,
      filesSkipped: left.filesSkipped + right.filesSkipped,
    };
  }
}

async function runRepositoryScan({ id, files, repositoryName }: WorkerRequest) {
  const batches: RepositoryPayloadFile[][] = [];
  for (let index = 0; index < files.length; index += INITIAL_BATCH_SIZE) {
    batches.push(files.slice(index, index + INITIAL_BATCH_SIZE));
  }

  const scanResults: unknown[] = [];
  let filesWritten = 0;
  let filesSkipped = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const data = await scanBatch(id, batch, `Scanning batch ${index + 1} of ${batches.length}`);
    scanResults.push(...data.results);
    filesWritten += data.filesWritten;
    filesSkipped += data.filesSkipped;
  }

  postProgress(id, 'Assembling repository execution report…');
  const finalData = await postJson<{ report: unknown; scan: Record<string, unknown> }>({
    action: 'report',
    files,
    repositoryName,
    scanResults,
  });

  self.postMessage({
    type: 'complete',
    id,
    report: finalData.report,
    scan: {
      ...finalData.scan,
      filesWritten,
      filesSkipped: filesSkipped + Number(finalData.scan?.filesSkipped || 0),
    },
  } satisfies WorkerCompleteMessage);
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  runRepositoryScan(request).catch((error) => {
    self.postMessage({
      type: 'error',
      id: request.id,
      error: error instanceof Error ? error.message : 'Repository scan failed.',
    } satisfies WorkerErrorMessage);
  });
});

export {};
