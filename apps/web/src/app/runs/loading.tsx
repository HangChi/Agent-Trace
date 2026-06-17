import { Skeleton } from "~/components/ui/skeleton";
import { Card, CardContent } from "~/components/ui/card";

export default function RunsLoading() {
  return (
    <main className="min-h-screen bg-background transition-colors duration-300">
      <header className="border-b border-border bg-card transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-96" />
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-12 w-64" />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="rounded-none">
              <CardContent className="px-4 py-3 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-6 rounded-none shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
          <div className="px-4 py-3 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
