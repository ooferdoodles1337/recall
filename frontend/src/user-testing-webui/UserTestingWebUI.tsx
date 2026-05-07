import { useState } from "react";
import { InstructionsScreen } from "./screens/InstructionsScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { TaskScreen } from "./screens/TaskScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import type { UserTestScreen } from "./types";

export function UserTestingWebUI() {
  const [screen, setScreen] = useState<UserTestScreen>("welcome");

  if (screen === "instructions") {
    return (
      <InstructionsScreen
        onBack={() => setScreen("welcome")}
        onBegin={() => setScreen("task")}
      />
    );
  }

  if (screen === "task") {
    return <TaskScreen onComplete={() => setScreen("results")} />;
  }

  if (screen === "results") {
    return <ResultsScreen onRestart={() => setScreen("welcome")} />;
  }

  return <WelcomeScreen onStartTrial={() => setScreen("instructions")} />;
}
