import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { currentRoute } from "./routes";

const PhoneTesterUI = lazy(() =>
  import("../features/phone/PhoneTesterUI").then((m) => ({ default: m.PhoneTesterUI })),
);
const UserTestingWebUI = lazy(() =>
  import("../features/user-testing/UserTestingWebUI").then((m) => ({ default: m.UserTestingWebUI })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

export function App() {
  const screen = currentRoute() === "phone" ? <PhoneTesterUI /> : <UserTestingWebUI />;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-content">
        <Suspense fallback={null}>{screen}</Suspense>
      </div>
    </QueryClientProvider>
  );
}
