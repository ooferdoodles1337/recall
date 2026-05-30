import { lazy, Suspense, useState } from "react";
import type { TrialResult, UserTestScreen } from "./types";
import { WelcomeScreen } from "./screens/WelcomeScreen";

const ResultsScreen = lazy(() =>
  import("./screens/ResultsScreen").then((m) => ({ default: m.ResultsScreen })),
);
const TaskScreen = lazy(() =>
  import("./screens/TaskScreen").then((m) => ({ default: m.TaskScreen })),
);

export function UserTestingWebUI() {
  const [screen, setScreen] = useState<UserTestScreen>("welcome");
  const [sessionResults, setSessionResults] = useState<TrialResult[]>([]);

  if (screen === "task") {
    return (
      <Suspense fallback={null}>
        <TaskScreen
          onExit={(results) => {
            setSessionResults(results);
            setScreen("results");
          }}
        />
      </Suspense>
    );
  }

  if (screen === "results") {
    return (
      <Suspense fallback={null}>
        <ResultsScreen
          results={sessionResults}
          onRestart={() => {
            setSessionResults([]);
            setScreen("welcome");
          }}
        />
      </Suspense>
    );
  }

  return <WelcomeScreen onStartTrial={() => setScreen("task")} />;
}
