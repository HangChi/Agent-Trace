export type DashboardLocale = "zh" | "en";
export type DashboardRouterMode = "browser" | "hash";

export type DashboardAppProps = {
  apiBase: string;
  routerMode?: DashboardRouterMode;
  initialPath?: string;
};

export type DashboardRoute = {
  path: string;
  query: URLSearchParams;
};

export type DashboardNavigate = (path: string) => void;
