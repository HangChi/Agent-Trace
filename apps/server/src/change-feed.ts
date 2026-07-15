export type ChangeFeedEvent = {
  revision: number;
  kind: "run" | "event" | "usage" | "maintenance" | "evaluation" | "budget";
  at: string;
};

type Listener = (event: ChangeFeedEvent) => void;

let revision = 0;
const listeners = new Set<Listener>();

export function publishChange(kind: ChangeFeedEvent["kind"]): ChangeFeedEvent {
  const event = { revision: ++revision, kind, at: new Date().toISOString() };

  for (const listener of listeners) {
    listener(event);
  }

  return event;
}

export function subscribeToChanges(listener: Listener) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function getCurrentRevision() {
  return revision;
}
