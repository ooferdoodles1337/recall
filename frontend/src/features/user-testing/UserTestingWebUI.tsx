import { lazy, Suspense, useState } from "react";
import type { TrialResult, UserTestScreen } from "./types";

const InstructionsScreen = lazy(() =>
  import("./screens/InstructionsScreen").then((m) => ({ default: m.InstructionsScreen })),
);
const ResultsScreen = lazy(() =>
  import("./screens/ResultsScreen").then((m) => ({ default: m.ResultsScreen })),
);
const TaskScreen = lazy(() =>
  import("./screens/TaskScreen").then((m) => ({ default: m.TaskScreen })),
);
const WelcomeScreen = lazy(() =>
  import("./screens/WelcomeScreen").then((m) => ({ default: m.WelcomeScreen })),
);

export function UserTestingWebUI() {
  const [screen, setScreen] = useState<UserTestScreen>("welcome");
  const [sessionResults, setSessionResults] = useState<TrialResult[]>([]);

  if (screen === "instructions") {
    return (
      <Suspense fallback={null}>
        <InstructionsScreen
          onBack={() => setScreen("welcome")}
          onBegin={() => setScreen("task")}
        />
      </Suspense>
    );
  }

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

  return (
    <Suspense fallback={null}>
      <WelcomeScreen onStartTrial={() => setScreen("instructions")} />
    </Suspense>
  );
}
