export default function RunsLoading() {
  return (
    <main className="min-h-screen bg-[var(--color-canvas)] transition-colors duration-300">
      <header className="border-b border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="h-3 w-20 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="mt-2 h-7 w-48 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="mt-2 h-4 w-96 animate-pulse bg-[var(--color-surface-tertiary)]" />
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <div className="h-8 w-24 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="h-12 w-64 animate-pulse bg-[var(--color-surface-tertiary)]" />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] px-4 py-3"
            >
              <div className="h-3 w-16 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="mt-2 h-8 w-12 animate-pulse bg-[var(--color-surface-tertiary)]" />
            </div>
          ))}
        </div>

        <div className="mt-6 border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-primary)] px-4 py-3">
            <div>
              <div className="h-4 w-24 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="mt-1 h-3 w-48 animate-pulse bg-[var(--color-surface-tertiary)]" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-20 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="h-8 w-20 animate-pulse bg-[var(--color-surface-tertiary)]" />
            </div>
          </div>
          <div className="px-4 py-12">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-[var(--color-border-secondary)] py-3"
              >
                <div className="h-4 w-32 animate-pulse bg-[var(--color-surface-tertiary)]" />
                <div className="h-4 w-20 animate-pulse bg-[var(--color-surface-tertiary)]" />
                <div className="h-4 w-16 animate-pulse bg-[var(--color-surface-tertiary)]" />
                <div className="h-4 w-36 animate-pulse bg-[var(--color-surface-tertiary)]" />
                <div className="h-4 w-12 animate-pulse bg-[var(--color-surface-tertiary)]" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
