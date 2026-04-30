import type { ReactNode } from 'react'
import { useDragScroll } from '../hooks/useDragScroll'

interface Props {
  children: ReactNode
}

// TODO: CSS-only phone frame (fixed 390×780 aspect ratio, rounded corners, status bar notch).
// Clips overflow so the app UI scrolls inside the frame without bleeding out.
// Mouse events are used as-is — no touch simulation needed.
export default function PhoneFrame({ children }: Props) {
  const { ref, dragScrollProps } = useDragScroll<HTMLDivElement>()

  return (
    <div className="TODO relative overflow-hidden rounded-[2.5rem]">
      {/* TODO: status bar */}
      <div ref={ref} className="TODO overflow-y-auto" {...dragScrollProps}>{children}</div>
    </div>
  )
}
