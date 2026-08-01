export type RunsLocation = {
  assign(url: string): void;
  reload(): void;
};

export function navigateRunsPage(location: RunsLocation, url: string) {
  location.assign(url);
}

export function refreshRunsPage(location: RunsLocation) {
  location.reload();
}
