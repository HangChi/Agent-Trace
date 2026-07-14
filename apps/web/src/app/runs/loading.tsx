import { Skeleton } from "~/components/ui/skeleton";
import { Card, CardContent } from "~/components/ui/card";

export default function RunsLoading() {
  return (
    <main id="main-content" className="min-h-dvh bg-background">
      <header className="border-b border-border/70 bg-background/80">
        <div className="mx-auto flex min-h-14 w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8 2xl:px-10">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
          <Skeleton className="h-9 w-72 max-w-full rounded-lg" />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="py-0">
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-14" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-5 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b border-border/70 bg-surface-raised px-5 py-3.5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="space-y-3 px-5 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[260px_150px_130px_1fr] items-center gap-4 py-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
