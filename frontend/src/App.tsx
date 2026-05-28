import { lazy, Suspense } from "react";

const PhoneTesterUI = lazy(() =>
  import("./phone-tester-ui/PhoneTesterUI").then((m) => ({ default: m.PhoneTesterUI })),
);
const UserTestingWebUI = lazy(() =>
  import("./user-testing-webui/UserTestingWebUI").then((m) => ({ default: m.UserTestingWebUI })),
);

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
    <div className="app-content">
      <Suspense fallback={null}>{screen}</Suspense>
    </div>
  );
}
