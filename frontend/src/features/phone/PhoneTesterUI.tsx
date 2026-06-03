import { useEffect } from "react";
import { PhoneViewportFrame } from "./components/shell/PhoneViewportFrame";
import { navigateTo } from "@/app/routes";

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
      <PhoneViewportFrame onExit={() => navigateTo("test")} />
    </main>
  );
}
