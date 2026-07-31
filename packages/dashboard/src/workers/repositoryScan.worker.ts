type RepositoryPayloadFile = {
  path: string;
  content: string;
};

type WorkerRequest = {
  id: string;
  files: RepositoryPayloadFile[];
  repositoryName: string;
  useClosure?: boolean;
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

const REPORT_TIMEOUT_MS = 50_000;

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

async function postJson<T>(body: unknown, timeoutMs = REPORT_TIMEOUT_MS): Promise<T> {
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

async function runRepositoryScan({ id, files, repositoryName, useClosure }: WorkerRequest) {
  postProgress(id, `Building hosted preview from ${files.length} prioritized files…`);
  const finalData = await postJson<{ report: unknown; scan: Record<string, unknown> }>({
    action: 'report',
    files,
    repositoryName,
    ...(useClosure ? { useClosure: true } : {}),
  }, REPORT_TIMEOUT_MS);

  self.postMessage({
    type: 'complete',
    id,
    report: finalData.report,
    scan: {
      ...finalData.scan,
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
