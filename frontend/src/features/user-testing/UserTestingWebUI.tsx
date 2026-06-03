import { lazy, Suspense, useState } from "react";
import type { UserTestScreen } from "./types";
import { WelcomeScreen } from "./screens/WelcomeScreen";

const TaskScreen = lazy(() =>
  import("./screens/TaskScreen").then((m) => ({ default: m.TaskScreen })),
);

export function UserTestingWebUI() {
  const [screen, setScreen] = useState<UserTestScreen>("welcome");

  if (screen === "task") {
    return (
      <Suspense fallback={null}>
        <TaskScreen onExit={() => setScreen("welcome")} />
      </Suspense>
    );
  }

  return <WelcomeScreen onStartTrial={() => setScreen("task")} />;
}
