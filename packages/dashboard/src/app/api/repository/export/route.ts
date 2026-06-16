import {
  formatRepositoryReportHtml,
  formatRepositoryReportSarif,
  type RepositoryExecutionReport,
} from "@promptsonar/core";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const report = body?.report as RepositoryExecutionReport | undefined;
    const format = body?.format;
    if (!report || !["sarif", "html"].includes(format)) {
      return new Response("A repository report and supported format are required.", { status: 400 });
    }
    if (format === "sarif") {
      return new Response(formatRepositoryReportSarif(report), {
        headers: { "Content-Type": "application/sarif+json; charset=utf-8" },
      });
    }
    return new Response(formatRepositoryReportHtml(report), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Export failed.", { status: 500 });
  }
}
