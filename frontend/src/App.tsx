import { PhoneTesterUI } from "./phone-tester-ui/PhoneTesterUI";
import { UserTestingWebUI } from "./user-testing-webui/UserTestingWebUI";

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
    <>
      <div className="app-content">{screen}</div>
      <aside className="viewport-size-warning" role="alert" aria-live="polite">
        <div className="viewport-size-warning-panel">
          <span className="viewport-size-warning-kicker">Window size check</span>
          <h1 className="viewport-size-warning-title">Use fullscreen desktop mode</h1>
          <p className="viewport-size-warning-copy">
            Recall user testing needs a window at least 1280 x 720 px. Enlarge
            this window or switch to fullscreen, then continue the session.
          </p>
        </div>
      </aside>
    </>
  );
}
