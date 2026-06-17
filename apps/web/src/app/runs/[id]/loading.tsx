export default function RunDetailLoading() {
  return (
    <main className="min-h-screen bg-[var(--color-canvas)] transition-colors duration-300">
      <header className="border-b border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="h-4 w-28 animate-pulse bg-[var(--color-surface-tertiary)]" />
            <div className="h-8 w-24 animate-pulse bg-[var(--color-surface-tertiary)]" />
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="h-3 w-20 animate-pulse bg-[var(--color-surface-tertiary)]" />
              <div className="mt-1 h-6 w-64 animate-pulse bg-[var(--color-surface-tertiary)]" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="border border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] px-3 py-2"
                >
                  <div className="h-3 w-10 animate-pulse bg-[var(--color-surface-tertiary)]" />
                  <div className="mt-1 h-5 w-8 animate-pulse bg-[var(--color-surface-tertiary)]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] shadow-[var(--shadow-card)]">
          <div className="border-b border-[var(--color-border-primary)] px-4 py-3">
            <div className="h-4 w-28 animate-pulse bg-[var(--color-surface-tertiary)]" />
            <div className="mt-1 h-3 w-64 animate-pulse bg-[var(--color-surface-tertiary)]" />
          </div>
          <div className="px-4 py-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="mb-4 flex gap-4">
                <div className="h-10 w-32 animate-pulse bg-[var(--color-surface-tertiary)]" />
                <div className="flex-1">
                  <div className="h-4 w-48 animate-pulse bg-[var(--color-surface-tertiary)]" />
                  <div className="mt-2 h-3 w-96 animate-pulse bg-[var(--color-surface-tertiary)]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="h-fit border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] px-4 py-4 shadow-[var(--shadow-card)]">
          <div className="h-4 w-20 animate-pulse bg-[var(--color-surface-tertiary)]" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i}>
                <div className="h-3 w-16 animate-pulse bg-[var(--color-surface-tertiary)]" />
                <div className="mt-1 h-4 w-full animate-pulse bg-[var(--color-surface-tertiary)]" />
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
