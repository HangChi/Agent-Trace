import { Skeleton } from "~/components/ui/skeleton";
import { Card, CardContent } from "~/components/ui/card";

export default function RunDetailLoading() {
  return (
    <main id="main-content" className="min-h-dvh bg-background">
      <header className="border-b border-border/70 bg-background/80">
        <div className="mx-auto flex min-h-14 w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8 2xl:px-10">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
        <Skeleton className="h-9 w-36 rounded-lg" />
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-80 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl sm:w-24" />
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden py-0">
          <div className="space-y-2 border-b border-border/70 bg-surface-raised px-5 py-3.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <div className="space-y-5 px-5 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]">
                <Skeleton className="h-9 w-32" />
                <div className="space-y-2 border-l border-border/80 pl-5">
                  <Skeleton className="h-5 w-56" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="py-0">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="space-y-1 border-t border-border/80 pt-3 first:border-t-0 first:pt-0">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        </aside>
        </div>
      </section>
    </main>
  );
}
