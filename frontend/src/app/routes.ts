export type AppRoute = "phone" | "test";

export function currentRoute(): AppRoute {
  return window.location.pathname.startsWith("/phone") ? "phone" : "test";
}

export function navigateTo(route: AppRoute) {
  window.location.href = route === "phone" ? "/phone" : "/";
}
