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

const BATCH_SIZE = 25;

function postProgress(id: string, message: string) {
  self.postMessage({ type: 'progress', id, message } satisfies WorkerProgressMessage);
}

async function postJson<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/repository/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Repository scan failed (${response.status})`);
  }
  return data as T;
}

async function runRepositoryScan({ id, files, repositoryName }: WorkerRequest) {
  const batches: RepositoryPayloadFile[][] = [];
  for (let index = 0; index < files.length; index += BATCH_SIZE) {
    batches.push(files.slice(index, index + BATCH_SIZE));
  }

  const scanResults: unknown[] = [];
  let filesWritten = 0;
  let filesSkipped = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    postProgress(id, `Scanning batch ${index + 1} of ${batches.length} (${batch.length} files)…`);
    const data = await postJson<{
      results: unknown[];
      scan?: { filesWritten?: number; filesSkipped?: number };
    }>({
      action: 'scan',
      files: batch,
    });
    scanResults.push(...(data.results || []));
    filesWritten += data.scan?.filesWritten || 0;
    filesSkipped += data.scan?.filesSkipped || 0;
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
