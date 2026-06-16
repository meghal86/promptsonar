import type { RepositoryExecutionReport } from "@promptsonar/core";

const globalReportCache = globalThis as typeof globalThis & {
  __promptsonarRepositoryReports?: Map<string, RepositoryExecutionReport>;
};

export const repositoryReportCache = globalReportCache.__promptsonarRepositoryReports
  || (globalReportCache.__promptsonarRepositoryReports = new Map<string, RepositoryExecutionReport>());

export function cacheRepositoryReport(report: RepositoryExecutionReport) {
  if (!report.id) return;
  repositoryReportCache.set(report.id, report);
  while (repositoryReportCache.size > 10) {
    const oldestKey = repositoryReportCache.keys().next().value;
    if (!oldestKey) break;
    repositoryReportCache.delete(oldestKey);
  }
}
