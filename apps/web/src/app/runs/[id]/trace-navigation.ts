import { localizedHref, type Locale } from "~/lib/i18n";

export type TraceDetailView = "timeline" | "tree";

export function traceEventTargetId(eventId: string) {
  const encodedId = Array.from(eventId, (character) =>
    character.codePointAt(0)?.toString(36)
  ).join("-");

  return `trace-event-${encodedId}`;
}

export function traceInsightLocationHref({
  runId,
  eventId,
  locale,
  view
}: {
  runId: string;
  eventId: string;
  locale: Locale;
  view: TraceDetailView;
}) {
  const params = new URLSearchParams({
    q: eventId,
    visibility: "all",
    focus: eventId
  });

  if (view === "tree") {
    params.set("view", "tree");
  }

  const path = localizedHref(
    `/runs/${encodeURIComponent(runId)}?${params.toString()}`,
    locale
  );

  return `${path}#${traceEventTargetId(eventId)}` as ReturnType<typeof localizedHref>;
}
