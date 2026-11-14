# DESIGN.md: Kitsune Router Control Plane

## Identity and Direction
- **Product:** Kitsune Router (Local BYOK Gateway and Antigravity MCP Control Plane)
- **Visual Direction:** Utilitarian Google Workspace clarity paired with Apple Craft physical precision and MJ Notch hybrid mascot framing.
- **Liveliness Dials:** ENERGY 2 / RHYTHM 2 / MOTION 2
- **Themes:** Working Light mode (default, matching Google AI Studio / Workspace daylight) and Dark mode (Obsidian slate), persisted in `localStorage`.

## Verified WCAG AA Color Tokens

### Light Theme
- `--bg-canvas`: `#F8F9FA`
- `--bg-surface`: `#FFFFFF`
- `--bg-subtle`: `#EEF1F4`
- `--text-primary`: `#1D1D1F` (15.97:1 on `#F8F9FA`)
- `--text-secondary`: `#4A5058` (7.72:1 on `#F8F9FA`)
- `--border-subtle`: `#D8DDE3`
- `--border-control`: `#868D96` (3.35:1 on `#FFFFFF`)
- `--accent-primary`: `#1864D6` (`#FFFFFF` text on accent: 5.48:1)
- `--status-ok`: `#0D7A43` (5.13:1 on `#F8F9FA`)
- `--status-warn`: `#9A3412` (6.93:1 on `#F8F9FA`)
- `--status-err`: `#B91C1C` (6.14:1 on `#F8F9FA`)

### Dark Theme
- `--bg-canvas`: `#111317`
- `--bg-surface`: `#1A1D24`
- `--bg-elevated`: `#232730`
- `--text-primary`: `#F5F5F7` (17.08:1 on `#111317`)
- `--text-secondary`: `#A8B0BA` (8.49:1 on `#111317`)
- `--border-subtle`: `#2E333E`
- `--border-control`: `#747D8C` (4.06:1 on `#1A1D24`)
- `--accent-primary`: `#8AB4F8` (`#111317` text on accent: 8.82:1)
- `--status-ok`: `#34D399` (9.67:1 on `#111317`)
- `--status-warn`: `#FBBF24` (11.14:1 on `#111317`)
- `--status-err`: `#FCA5A5` (9.80:1 on `#111317`)

## Typography
- **UI Sans:** `'Google Sans', 'Segoe UI', system-ui, -apple-system, sans-serif` (clean utilitarian legibility)
- **Technical Mono:** `'JetBrains Mono', 'Cascadia Code', Consolas, ui-monospace, monospace` (strictly for model IDs, endpoints, masked keys, and JSON snippets)
- **Numeric Discipline:** `font-variant-numeric: tabular-nums` on every token count, latency, and USD cost value.

## Concentric Radii and Elevation
- Outer stage containers: `16px` (`--radius-outer`) with `16px` padding -> inner cards/inputs: `8px` (`--radius-inner = max(4px, 16 - 16)` or `10px` when padding is `6px`).
- Most cards sit flat with `1px` hairline border. Shadow reserved exclusively for the Kitsune Notch Companion Island and active popover/modal surfaces.
- Glass (`backdrop-filter`) capped to the sticky top bar only (1 surface).

## Motion and Interaction Rules
- Immediate press feedback (`transform: scale(0.985)` on `:active` / `pointerdown`, `<16ms` response).
- Asymmetric transitions: enter `200ms cubic-bezier(0.22, 1, 0.36, 1)`, exit `130ms ease-in`.
- Kitsune Fox Mascot: exact 1:1 MJ Notch `56x44` vector geometry (`1.9px` `#2B2B2B` contour, double catchlight eyes, `Math.atan2` + `0.22` lerp cursor tracking, 3.5s organic blink, breathing cycle, click celebration, rapid-click dizzy state) with a visible Pause Animation toggle and full `prefers-reduced-motion: reduce` compliance.
