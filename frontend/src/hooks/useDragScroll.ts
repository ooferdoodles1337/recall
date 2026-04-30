import { useRef } from 'react'
import type { PointerEvent } from 'react'

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startScrollTopRef = useRef(0)

  const onPointerDown = (event: PointerEvent<T>) => {
    const el = ref.current
    if (!el) return
    isDraggingRef.current = true
    startYRef.current = event.clientY
    startScrollTopRef.current = el.scrollTop
    el.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<T>) => {
    const el = ref.current
    if (!el || !isDraggingRef.current) return
    el.scrollTop = startScrollTopRef.current - (event.clientY - startYRef.current)
  }

  const stopDragging = (event: PointerEvent<T>) => {
    const el = ref.current
    if (!el || !isDraggingRef.current) return
    isDraggingRef.current = false
    if (el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId)
    }
  }

  return {
    ref,
    dragScrollProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stopDragging,
      onPointerCancel: stopDragging,
      onPointerLeave: stopDragging,
    },
  }
}
