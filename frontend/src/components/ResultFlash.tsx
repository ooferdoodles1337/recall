// TODO: full-screen overlay shown briefly on correct selection.
// Auto-dismissed by App.tsx after RESULT_FLASH_DURATION_MS.
export default function ResultFlash() {
  return (
    <div className="TODO fixed inset-0 z-50 flex items-center justify-center">
      <p>Found it!</p>
    </div>
  )
}
