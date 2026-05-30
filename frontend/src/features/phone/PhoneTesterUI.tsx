import { PhoneViewportFrame } from "./components/PhoneViewportFrame";

export function PhoneTesterUI() {
  return (
    <main className="app-shell--phone">
      <PhoneViewportFrame onExit={() => { window.location.href = '/'; }} />
    </main>
  );
}
