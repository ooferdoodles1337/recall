import { ResultsScreen } from "./screens/ResultsScreen";
import { TaskScreen } from "./screens/TaskScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import type { UserTestScreen } from "./types";

const initialScreen: UserTestScreen = "welcome";

export function UserTestingWebUI() {
  const screen = initialScreen;

  if (screen === "task") {
    return <TaskScreen />;
  }

  if (screen === "results") {
    return <ResultsScreen />;
  }

  return <WelcomeScreen />;
}

