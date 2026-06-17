import { Skeleton } from "~/components/ui/skeleton";
import { Card, CardContent } from "~/components/ui/card";

export default function RunDetailLoading() {
  return (
    <main className="min-h-screen bg-background transition-colors duration-300">
      <header className="border-b border-border bg-card transition-colors duration-300">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-64" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="rounded-none">
                  <CardContent className="px-3 py-2 space-y-1">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="h-5 w-8" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="rounded-none shadow-sm">
          <div className="border-b border-border px-4 py-3 space-y-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="px-4 py-4 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-10 w-32 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <aside className="space-y-4">
          <Card className="rounded-none shadow-sm">
            <CardContent className="px-4 py-4 space-y-3">
              <Skeleton className="h-4 w-20" />
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-none shadow-sm">
            <CardContent className="px-4 py-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}
