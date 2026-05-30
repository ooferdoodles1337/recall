import React from "react";
import { motion } from "motion/react";
import { SearchIcon, UserIcon, XIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { PhoneScreen } from "../phoneReducer";
import { MOTION_EASE } from "./phoneUtils";

interface PhoneHomeHeaderProps {
  mode: PhoneScreen;
  onExit?: () => void;
}

export function PhoneHomeHeader({ mode, onExit }: PhoneHomeHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{
        height: mode === "compose" ? 0 : "auto",
        opacity: mode === "compose" ? 0 : 1,
        y: mode === "compose" ? -16 : 0,
      }}
      transition={{ duration: 0.26, ease: MOTION_EASE.standard }}
      style={{ overflow: "hidden" }}
    >
      <div className="phone-startpage-header">
        <div className="phone-startpage-brand">
          <div className="phone-startpage-logo" aria-hidden>
            <SearchIcon />
          </div>
          <h1 className="phone-startpage-title">Recall</h1>
        </div>
        <div className="phone-startpage-actions">
          <Avatar className="phone-avatar" aria-label="Profile">
            <AvatarFallback>
              <UserIcon className="size-3.5" />
            </AvatarFallback>
          </Avatar>
          {onExit ? (
            <Button
              className="phone-exit-btn"
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onExit}
              aria-label="Exit phone tester"
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}