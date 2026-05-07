import { PhoneViewportFrame } from "../components/PhoneViewportFrame";
import { TargetPhotoPanel } from "../components/TargetPhotoPanel";

export function TaskScreen() {
  return (
    <main className="app-shell">
      <div className="user-test-task-grid">
        <TargetPhotoPanel />
        <PhoneViewportFrame />
      </div>
    </main>
  );
}

