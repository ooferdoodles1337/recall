---

## Core iOS Design Principles

Apple-style UI is not only a visual treatment. The interface should feel direct, light, spatial, and content-first.

| Principle   | Practical rule for React UI                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Clarity     | Text should be readable immediately. Avoid low-contrast glass over noisy backgrounds.                                     |
| Deference   | Chrome should support content, not dominate it. Use translucent bars, subtle dividers, and restrained shadows.            |
| Depth       | Use layering, blur, scale, and motion to show hierarchy. Avoid heavy drop shadows that feel Android-like or desktop-like. |
| Consistency | Reuse iOS-like spacing, typography, icon sizing, button heights, and navigation patterns.                                 |
| Adaptivity  | Layout should respond to device width, safe area, orientation, Dynamic Type, and dark mode.                               |

For a React app that mimics iOS, the most important rule is to build a design-token layer first. Do not hand-tune every component. Define spacing, typography, radii, blur, shadows, and colors once, then reuse them.

---

## Points, CSS Pixels, and Scaling

In native iOS design, dimensions are specified in points. In a browser-based mock or React web app, treat **1 iOS pt as 1 CSS px** when designing against an iPhone-sized viewport.

Example: a 390 pt iPhone design should be implemented as a 390 CSS px wide mobile viewport during testing.

| iOS concept        | React/CSS equivalent        |
| ------------------ | --------------------------- |
| 16 pt margin       | `16px` horizontal padding   |
| 44 pt touch target | `44px` minimum width/height |
| 17 pt body text    | `17px` font size            |
| 34 pt large title  | `34px` font size            |
| 12 pt radius       | `12px` border radius        |
| 20 pt card radius  | `20px` border radius        |

Use `rem` only if the app is meant to respond strongly to browser text scaling. For iOS visual fidelity, fixed token sizes in `px` are usually easier to control.

---

## Recommended Design Tokens

```css
:root {
  /* Spacing */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;

  /* iOS content margins */
  --page-margin: 16px;
  --page-margin-tight: 12px;

  /* Typography */
  --font-ios: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif;

  --text-large-title: 34px;
  --text-title-1: 28px;
  --text-title-2: 22px;
  --text-title-3: 20px;
  --text-body: 17px;
  --text-secondary: 15px;
  --text-caption: 13px;
  --text-tab: 11px;

  /* Line heights */
  --lh-large-title: 41px;
  --lh-title-1: 34px;
  --lh-title-2: 28px;
  --lh-title-3: 25px;
  --lh-body: 22px;
  --lh-secondary: 20px;
  --lh-caption: 18px;

  /* Radii */
  --radius-chip: 12px;
  --radius-card-large: 20px;
  --radius-card-small: 10px;
  --radius-button: 16px;
  --radius-full: 999px;

  /* Touch targets */
  --hit-min: 44px;
  --fab-size: 56px;
  --nav-button-size: 44px;

  /* Liquid Glass */
  --glass-bg: rgba(255, 255, 255, 0.68);
  --glass-bg-strong: rgba(255, 255, 255, 0.82);
  --glass-border: rgba(255, 255, 255, 0.42);
  --glass-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  --glass-blur: blur(24px) saturate(180%);

  /* System-like colors */
  --label-primary: rgba(0, 0, 0, 0.92);
  --label-secondary: rgba(60, 60, 67, 0.72);
  --label-tertiary: rgba(60, 60, 67, 0.38);

  --fill-primary: rgba(120, 120, 128, 0.20);
  --fill-secondary: rgba(120, 120, 128, 0.16);
  --fill-tertiary: rgba(120, 120, 128, 0.12);

  --separator: rgba(60, 60, 67, 0.24);
  --system-background: #ffffff;
  --grouped-background: #f2f2f7;
}

@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(28, 28, 30, 0.64);
    --glass-bg-strong: rgba(28, 28, 30, 0.82);
    --glass-border: rgba(255, 255, 255, 0.14);
    --glass-shadow: 0 8px 30px rgba(0, 0, 0, 0.36);

    --label-primary: rgba(255, 255, 255, 0.92);
    --label-secondary: rgba(235, 235, 245, 0.68);
    --label-tertiary: rgba(235, 235, 245, 0.34);

    --fill-primary: rgba(120, 120, 128, 0.36);
    --fill-secondary: rgba(120, 120, 128, 0.28);
    --fill-tertiary: rgba(120, 120, 128, 0.20);

    --separator: rgba(84, 84, 88, 0.65);
    --system-background: #000000;
    --grouped-background: #1c1c1e;
  }
}
```

---

## Typography Implementation Notes

Use the system font stack instead of importing SF Pro font files.

```css
body {
  font-family: var(--font-ios);
  font-size: var(--text-body);
  line-height: var(--lh-body);
  color: var(--label-primary);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

Recommended text classes:

```css
.text-large-title {
  font-size: var(--text-large-title);
  line-height: var(--lh-large-title);
  font-weight: 700;
  letter-spacing: -0.4px;
}

.text-title-1 {
  font-size: var(--text-title-1);
  line-height: var(--lh-title-1);
  font-weight: 400;
  letter-spacing: -0.3px;
}

.text-title-2 {
  font-size: var(--text-title-2);
  line-height: var(--lh-title-2);
  font-weight: 400;
  letter-spacing: -0.2px;
}

.text-title-3 {
  font-size: var(--text-title-3);
  line-height: var(--lh-title-3);
  font-weight: 400;
}

.text-body {
  font-size: var(--text-body);
  line-height: var(--lh-body);
  font-weight: 400;
}

.text-section {
  font-size: var(--text-body);
  line-height: var(--lh-body);
  font-weight: 600;
}

.text-secondary {
  font-size: var(--text-secondary);
  line-height: var(--lh-secondary);
  font-weight: 400;
  color: var(--label-secondary);
}

.text-caption {
  font-size: var(--text-caption);
  line-height: var(--lh-caption);
  font-weight: 400;
  color: var(--label-secondary);
}
```

Avoid using many font weights. Most iOS UI can be built with Regular, Semibold, and Bold.

---

## Dynamic Type Approximation for Web

Native iOS supports Dynamic Type. A React web app cannot directly read the user’s iOS Dynamic Type setting, but it can approximate the behavior with browser zoom, responsive typography, and accessibility modes.

Recommended approach:

```css
html {
  font-size: 100%;
}

@media (max-width: 375px) {
  :root {
    --text-large-title: 32px;
    --text-title-1: 26px;
    --text-body: 17px;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

For accessibility testing, manually verify the app at:

| Test case                  | Requirement                                   |
| -------------------------- | --------------------------------------------- |
| Browser zoom 125%          | Layout still usable                           |
| Browser zoom 150%          | Main task still possible                      |
| 320 px width               | No clipped primary controls                   |
| Large text mode simulation | Cards and buttons grow vertically             |
| Reduced motion             | No essential information depends on animation |

---

## Safe Area CSS

Use CSS environment variables for iPhone safe areas. Do not fake safe areas with fixed padding unless building a static mock.

```css
.app-shell {
  min-height: 100dvh;
  background: var(--system-background);
  color: var(--label-primary);
}

.scroll-page {
  min-height: 100dvh;
  overflow-y: auto;

  padding-left: max(var(--page-margin), env(safe-area-inset-left));
  padding-right: max(var(--page-margin), env(safe-area-inset-right));
  padding-top: env(safe-area-inset-top);
  padding-bottom: calc(env(safe-area-inset-bottom) + 96px);
}
```

Use `100dvh` instead of `100vh` for mobile browsers because the visible viewport changes when browser chrome expands or collapses.

---

## Page Structure

A typical iOS-like screen should use this structure:

```tsx
<main className="ios-screen">
  <header className="ios-nav-bar">
    <button className="ios-nav-button">...</button>
    <h1 className="ios-nav-title">Title</h1>
    <button className="ios-nav-button">...</button>
  </header>

  <section className="ios-content">
    ...
  </section>

  <nav className="ios-tab-bar">
    ...
  </nav>
</main>
```

Recommended layout rules:

| Area         | Rule                                              |
| ------------ | ------------------------------------------------- |
| Nav bar      | Fixed or sticky at top, 44–52 pt high             |
| Content      | Scrolls underneath translucent bars               |
| Tab bar      | Floating capsule, inset from screen edges         |
| Main content | Uses 16 pt margin, or 12 pt for dense layouts     |
| Cards        | Full width within content margin                  |
| Lists        | Use grouped background with rounded section cards |

---

## Navigation Bar

iOS navigation bars are compact, balanced, and touch-friendly. Icon buttons should have a 44 × 44 pt hit region even when the icon itself is only 20–24 pt.

```css
.ios-nav-bar {
  position: sticky;
  top: 0;
  z-index: 20;

  height: calc(52px + env(safe-area-inset-top));
  padding-top: env(safe-area-inset-top);
  padding-left: var(--page-margin);
  padding-right: var(--page-margin);

  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;

  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 0.5px solid var(--separator);
}

.ios-nav-title {
  margin: 0;
  text-align: center;
  font-size: 17px;
  line-height: 22px;
  font-weight: 600;
}

.ios-nav-button {
  width: var(--nav-button-size);
  height: var(--nav-button-size);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--label-primary);
  display: grid;
  place-items: center;
}
```

For large-title pages, place the large title inside the scroll content rather than inside the fixed nav bar.

---

## Search Bar

Search bars should feel like rounded islands. They are usually 36–44 pt tall, with 12 pt radius and a subtle fill.

```css
.ios-search {
  min-height: 40px;
  border-radius: var(--radius-chip);
  background: var(--fill-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.ios-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  color: var(--label-primary);
}

.ios-search input::placeholder {
  color: var(--label-tertiary);
}
```

For iOS 26-style search, use a stronger glass treatment only when the search bar floats above content.

```css
.ios-search--glass {
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 0.5px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
}
```

---

## Floating Tab Bar

The iOS 26 tab bar should feel like a floating capsule rather than a full-width bottom strip.

```css
.ios-tab-bar {
  position: fixed;
  left: max(21px, env(safe-area-inset-left));
  right: max(21px, env(safe-area-inset-right));
  bottom: calc(21px + env(safe-area-inset-bottom));
  z-index: 30;

  height: 64px;
  border-radius: 999px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 0.5px solid var(--glass-border);
  box-shadow: var(--glass-shadow);

  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: center;
}

.ios-tab-item {
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--label-secondary);

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;

  font-size: var(--text-tab);
  line-height: 13px;
}

.ios-tab-item[aria-current="page"] {
  color: var(--label-primary);
  font-weight: 600;
}
```

Keep tab labels short. Use one or two words at most. Avoid more than five tabs on iPhone.

---

## Cards and Grouped Lists

Use grouped backgrounds for settings-style pages, lists, profile pages, and dashboards.

```css
.grouped-page {
  background: var(--grouped-background);
}

.ios-card {
  border-radius: var(--radius-card-large);
  background: var(--system-background);
  overflow: hidden;
  border: 0.5px solid rgba(0, 0, 0, 0.04);
}

.ios-list-section {
  border-radius: var(--radius-card-large);
  background: var(--system-background);
  overflow: hidden;
}

.ios-list-row {
  min-height: 44px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ios-list-row + .ios-list-row {
  border-top: 0.5px solid var(--separator);
}
```

For concentric corner radii:

```css
.outer-card {
  border-radius: 24px;
  padding: 8px;
}

.inner-card {
  border-radius: calc(24px - 8px);
}
```

This makes nested rounded rectangles feel more like iOS and less like unrelated boxes.

---

## Buttons

Use simple button hierarchy.

| Type         | Use case               | Style                          |
| ------------ | ---------------------- | ------------------------------ |
| Filled       | Primary action         | Accent fill, white text        |
| Tinted       | Secondary action       | Light accent fill, accent text |
| Plain        | Navigation/action text | No fill                        |
| Glass circle | Navigation icon        | 44 × 44 pt circular material   |
| Destructive  | Delete/remove          | Red text or red fill           |

```css
.ios-button {
  min-height: 44px;
  min-width: 44px;
  border: 0;
  border-radius: var(--radius-button);
  padding: 0 16px;

  font-size: 17px;
  line-height: 22px;
  font-weight: 600;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.ios-button--filled {
  background: #007aff;
  color: white;
}

.ios-button--tinted {
  background: rgba(0, 122, 255, 0.12);
  color: #007aff;
}

.ios-button--plain {
  background: transparent;
  color: #007aff;
  padding-left: 8px;
  padding-right: 8px;
}

.ios-button:active {
  transform: scale(0.97);
}
```

Avoid rectangular desktop buttons. Rounded, compact, touch-sized buttons feel closer to iOS.

---

## Icons and SF Symbols Approximation

On native iOS, SF Symbols are the default icon language. In React, use an icon library with similar stroke weight and optical balance.

Recommended rules:

| Context                | Icon size |
| ---------------------- | --------- |
| Nav bar                | 20–24 px  |
| Tab bar                | 22–26 px  |
| List row leading icon  | 24–28 px  |
| Empty state            | 48–64 px  |
| Floating action button | 24–28 px  |

For Lucide React, use:

```tsx
<Search size={22} strokeWidth={2.25} />
```

Avoid mixing multiple icon families. Use one family across the entire app.

---

## Motion and Interaction

iOS motion is usually quick, soft, and functional. Do not over-animate.

Recommended timings:

| Interaction  | Duration   | Easing       |
| ------------ | ---------- | ------------ |
| Button press | 80–120 ms  | ease-out     |
| Sheet enter  | 250–350 ms | cubic-bezier |
| Card open    | 250–400 ms | cubic-bezier |
| Tab switch   | 180–250 ms | ease-out     |
| Toast enter  | 200–300 ms | ease-out     |

```css
.ios-pressable {
  transition:
    transform 120ms ease-out,
    opacity 120ms ease-out,
    background-color 160ms ease-out;
}

.ios-pressable:active {
  transform: scale(0.97);
  opacity: 0.82;
}
```

Use motion to show continuity. For example, opening a card should feel like the card expands into a detail view, not like a random page swap.

---

## Sheets and Modals

Bottom sheets are common on iOS. They should be rounded at the top, respect the safe area, and use a grabber.

```css
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.24);
}

.ios-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;

  max-height: min(86dvh, 720px);
  padding-bottom: env(safe-area-inset-bottom);

  border-radius: 24px 24px 0 0;
  background: var(--system-background);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.sheet-grabber {
  width: 36px;
  height: 5px;
  border-radius: 999px;
  background: var(--fill-primary);
  margin: 8px auto;
}
```

Use sheets for filters, contextual actions, edit forms, and secondary flows. Use full-screen pages for primary tasks.

---

## Forms

iOS forms are usually grouped lists, not desktop-style input grids.

```css
.form-section {
  border-radius: 20px;
  background: var(--system-background);
  overflow: hidden;
}

.form-row {
  min-height: 48px;
  padding: 8px 16px;
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 12px;
}

.form-label {
  color: var(--label-primary);
  font-size: 17px;
}

.form-input {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--label-primary);
  font-size: 17px;
  text-align: right;
}
```

For mobile, avoid long horizontal forms. Stack labels above inputs when the screen is narrow or when text scaling is large.

---

## Empty States

A good iOS-style empty state is simple and centered, with one clear next action.

Recommended structure:

1. Symbol or illustration
2. Short title
3. One-sentence explanation
4. Optional primary action

```css
.empty-state {
  min-height: 55dvh;
  padding: 32px 24px;
  display: grid;
  place-items: center;
  text-align: center;
}

.empty-state-content {
  max-width: 300px;
}

.empty-state-title {
  margin-top: 16px;
  font-size: 22px;
  line-height: 28px;
  font-weight: 600;
}

.empty-state-copy {
  margin-top: 8px;
  font-size: 15px;
  line-height: 20px;
  color: var(--label-secondary);
}
```

Avoid long explanations. Empty states should help the user act, not teach the whole app.

---

## Loading States

For Apple-style UI, prefer quiet loading states.

| Loading situation | Recommended treatment                             |
| ----------------- | ------------------------------------------------- |
| Initial page load | Skeleton content                                  |
| Button action     | Inline spinner or disabled button                 |
| Search results    | Keep old results visible until new results arrive |
| Media loading     | Rounded skeleton matching final media shape       |
| Long operation    | Progress row with cancel option if possible       |

```css
.skeleton {
  border-radius: 12px;
  background:
    linear-gradient(
      90deg,
      var(--fill-secondary),
      var(--fill-primary),
      var(--fill-secondary)
    );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.2s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
```

Disable shimmer under reduced motion.

---

## Dark Mode

Do not invert colors manually. Use semantic tokens.

Good pattern:

```css
.card {
  background: var(--system-background);
  color: var(--label-primary);
  border-color: var(--separator);
}
```

Bad pattern:

```css
.card {
  background: white;
  color: black;
}
```

Check glass components especially carefully in dark mode. Translucency can easily reduce contrast.

---

## Responsive Breakpoints

For iPhone-first design:

| Width      | Treatment                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| 320 px     | Compact legacy layout. Reduce margins to 12 px. Hide nonessential labels. |
| 375 px     | Small modern iPhone. Main layout must fully work.                         |
| 390–402 px | Primary design target.                                                    |
| 420–440 px | Larger iPhone. Add breathing room, not extra complexity.                  |
| 768 px+    | iPad/tablet. Consider sidebars, two-column layouts, or wider cards.       |

```css
@media (max-width: 360px) {
  :root {
    --page-margin: 12px;
  }

  .ios-tab-bar {
    left: 12px;
    right: 12px;
  }
}

@media (min-width: 768px) {
  .ios-content {
    max-width: 720px;
    margin: 0 auto;
  }
}
```

---

## React Component Rules

Use components that encode iOS constraints directly.

Example:

```tsx
type IconButtonProps = {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
};

export function IOSIconButton({ label, children, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      className="ios-nav-button"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
```

This prevents common mistakes:

* icons without accessible labels
* tap targets smaller than 44 px
* inconsistent nav button sizing
* one-off styling across screens

---

## Web-Specific iOS Mimicry Checklist

Use this checklist before considering the screen done.

| Category      | Check                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Typography    | Body text is 17 px, secondary text is 15 px, captions are not below 11 px |
| Touch         | All interactive controls have at least 44 × 44 px hit areas               |
| Margins       | Main content uses 16 px margin, or 12 px only for compact layouts         |
| Safe area     | Bottom content is not hidden behind tab bar or home indicator             |
| Dark mode     | All semantic colors work in light and dark mode                           |
| Glass         | Text remains readable over translucent surfaces                           |
| Motion        | Reduced-motion mode disables nonessential animation                       |
| Width         | Layout works at 390, 375, and 320 px                                      |
| Icons         | Icon family is consistent across the app                                  |
| Navigation    | Primary actions are reachable by thumb                                    |
| States        | Loading, empty, error, and offline states are designed                    |
| Accessibility | Buttons have labels, focus states exist, contrast is acceptable           |

---

## Common Mistakes to Avoid

| Mistake                  | Why it feels wrong                                                              |
| ------------------------ | ------------------------------------------------------------------------------- |
| Too much blur everywhere | Real iOS uses material to support hierarchy, not as decoration on every surface |
| Small icon-only buttons  | iOS requires large hit regions even for small icons                             |
| Desktop-like cards       | Heavy shadows and square cards feel non-native                                  |
| Fixed bottom padding     | Safe area must come from device/browser environment variables                   |
| Overusing borders        | iOS often uses fills, translucency, spacing, and subtle separators              |
| Tiny text                | Anything below 11 pt feels unlike iOS and hurts accessibility                   |
| No pressed state         | iOS controls should respond immediately to touch                                |
| Ignoring 320 px          | Small-width failures are common in mobile web apps                              |
| No dark mode check       | Glass and semantic colors often break in dark mode                              |
| Mixing icon styles       | Different stroke widths make the UI feel assembled rather than designed         |
