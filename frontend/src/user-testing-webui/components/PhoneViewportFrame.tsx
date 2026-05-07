export function PhoneViewportFrame() {
  return (
    <div className="phone-stage">
      <div className="phone-stage-header" aria-hidden="true">
        <span>Participant viewport</span>
        <span className="phone-stage-size">390 x 844</span>
      </div>
      <div className="phone-rect" aria-label="Phone interface viewport">
        <div className="phone-rect-content">
          <p className="placeholder-kicker">Recall Viewport</p>
          <p className="placeholder-copy" style={{ fontSize: "0.8rem" }}>
            TODO: recall UI needs to be implemented here.
          </p>
        </div>
      </div>
    </div>
  );
}
