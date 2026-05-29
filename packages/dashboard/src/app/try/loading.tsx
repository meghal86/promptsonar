// Minimal route-segment loading state for /try. Mirrors the input screen so the
// first paint matches the real page. No spinner copy, no status text.
export default function Loading() {
  return (
    <main className="min-h-screen w-full bg-[#FAF9F6] antialiased flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-44 rounded-lg bg-[#ECEAE5]" />
          <div className="h-4 w-64 rounded bg-[#ECEAE5]" />
        </div>
        <div className="h-[200px] w-full rounded-xl border border-[#E4E3DE] bg-white" />
        <div className="h-[44px] w-full rounded-xl bg-[#ECEAE5]" />
      </div>
    </main>
  );
}
