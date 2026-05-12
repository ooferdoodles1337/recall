import { useEffect, useState } from "react";
import type { RecallMediaItem } from "../../shared/types/recall";
import { fetchTrials } from "../api/trialsApi";
import { PhoneViewportFrame } from "../components/PhoneViewportFrame";
import { TargetPhotoPanel } from "../components/TargetPhotoPanel";

interface TaskScreenProps {
  onComplete: () => void;
}

type TrialState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "active"; targets: RecallMediaItem[]; index: number };

export function TaskScreen({ onComplete }: TaskScreenProps) {
  const [trial, setTrial] = useState<TrialState>({ status: "loading" });

  useEffect(() => {
    fetchTrials(10)
      .then(({ targets }) => {
        if (targets.length === 0) {
          setTrial({ status: "error", message: "No trial targets returned from server." });
        } else {
          setTrial({ status: "active", targets, index: 0 });
        }
      })
      .catch((err: unknown) => {
        setTrial({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  function advance() {
    if (trial.status !== "active") return;
    if (trial.index + 1 >= trial.targets.length) {
      onComplete();
    } else {
      setTrial({ ...trial, index: trial.index + 1 });
    }
  }

  if (trial.status === "loading") {
    return (
      <div className="task-loading">
        <div className="task-loading-spinner" aria-hidden="true" />
        <p>Loading tasks…</p>
      </div>
    );
  }

  if (trial.status === "error") {
    return (
      <div className="task-loading">
        <p className="task-error-msg">Could not load tasks: {trial.message}</p>
      </div>
    );
  }

  const { targets, index } = trial;

  return (
    <div className="task-shell">
      <div className="task-target-col">
        <TargetPhotoPanel
          item={targets[index]}
          taskNumber={index + 1}
          totalTasks={targets.length}
          onNext={advance}
        />
      </div>
      <div className="task-divider" aria-hidden="true" />
      <div className="task-phone-col">
        <PhoneViewportFrame />
      </div>
    </div>
  );
}
