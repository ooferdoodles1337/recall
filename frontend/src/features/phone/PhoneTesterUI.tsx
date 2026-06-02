import { useEffect } from "react";
import { PhoneViewportFrame } from "./components/PhoneViewportFrame";

export function PhoneTesterUI() {
  useEffect(() => {
    const className = "recall-phone-scroll-locked";
    document.documentElement.classList.add(className);
    document.body.classList.add(className);

    return () => {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
    };
  }, []);

  return (
    <main className="app-shell--phone">
      <PhoneViewportFrame onExit={() => { window.location.href = '/'; }} />
    </main>
  );
}
