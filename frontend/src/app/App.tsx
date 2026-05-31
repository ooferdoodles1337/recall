import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PhoneTesterUI = lazy(() =>
  import("../features/phone/PhoneTesterUI").then((m) => ({ default: m.PhoneTesterUI })),
);
const UserTestingWebUI = lazy(() =>
  import("../features/user-testing/UserTestingWebUI").then((m) => ({ default: m.UserTestingWebUI })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

function getCurrentRoute(pathname: string) {
  if (pathname.startsWith("/phone")) {
    return "phone";
  }

  return "test";
}

export function App() {
  const route = getCurrentRoute(window.location.pathname);
  const screen = route === "phone" ? <PhoneTesterUI /> : <UserTestingWebUI />;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-content">
        <Suspense fallback={null}>{screen}</Suspense>
      </div>
    </QueryClientProvider>
  );
}
