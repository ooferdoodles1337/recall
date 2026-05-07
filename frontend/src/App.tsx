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

  if (route === "phone") {
    return <PhoneTesterUI />;
  }

  return <UserTestingWebUI />;
}

