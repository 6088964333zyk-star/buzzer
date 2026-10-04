# Design: T9 Look-and-Feel and Theming

**Owner:** Jack Mayerhofer (jmayerhofer). T8 (images) is Bill Zhang's and is in progress at the
same time. See §6, Coordination.
**Status:** Draft, pre-Goldfish.
**Branch:** `feature/t9-theming`, cut from `main` at `a739236` (T4, T7 map_pin and T7 numeric
all merged).
**Evidence already captured:** 31 "before" screenshots in `docs/ui/before/` (commit `b3532b6`).
They were taken by a Playwright tour of the running stack before any T9 change (§4 Step 8).
**Process:** Written after the T3 context docs and committed before any implementation code.

---

## 1. Problem

T9 (`instructions.md`) asks for "a deliberate visual design built on a proper theme system,
offering both a light and a dark theme", across all three apps:

| Requirement | Summary |
|---|---|
| Design tokens | Semantic color tokens (CSS variables mapped into each app's Tailwind theme). Components use tokens; **raw palette utilities are eliminated** outside the token definitions |
| Light and dark | Both themes cover every page of all three apps; no leftover hardcoded colors |
| Toggle and persistence | A visible toggle in each app. The first visit follows `prefers-color-scheme`, and the choice persists across reloads |
| Accessibility | Body text meets WCAG 2.1 AA (4.5:1) in both themes; interactive elements have visible focus states |
| Context fit | The player stays thumb-friendly; the host screen is readable from the back of a classroom; admin stays dense but scannable |
| Evidence | Before/after screenshots of key screens in both themes in `docs/ui/`, referenced in T10 |

T7/T8 surfaces must be themed too: the question editors, the map and numeric screens, and image
management.

### Current state (measured on `a739236`)

- **Tailwind setup.** All three `tailwind.config.ts` files only set a font. Each `index.css`
  hardcodes `body { background: #0f172a; color: #f8fafc }`.
- **Hardcoded color utilities.** About **820** uses in about **47 files**: host 276, player 177,
  admin 370.
  - 46 distinct shades in total. The slate greys dominate (~640 uses), then indigo (accent),
    red / green / amber (status), and the player's answer-button palette.
  - Most frequent: `slate-400` 197, `slate-500` 104, `slate-100` 96, `slate-700` 60,
    `slate-300` 57, `slate-600` 55, `white` 49, `slate-800` 40, `indigo-500` 38, `red-400` 35,
    `green-400` 28.
- **Colors outside Tailwind.** The three `components/MapCanvas.tsx` copies paint with hex and
  `rgba()` strings in canvas code (`#cfe3f2` water, `rgba(250,204,21,0.15)` zero-credit ring,
  `rgba(34,197,94,0.3)` full-credit ring, `rgba(99,102,241,0.75)` guess dots, `#16a34a` target
  pin, `#fff` pin outline). The host lobby's `QRCodeSVG` uses its default black-on-white.
- **Contrast failures today** (WCAG ratio; 4.5 is required):
  - `slate-500` text on the `slate-900` page: **3.75** (104 uses).
  - Player answer buttons with white text: yellow-500 **1.92**, orange-500 **2.80**,
    green-600 **3.30**, teal-600 **3.74**. Red, blue, purple and pink pass.
- **No focus styles** beyond the `ui/button` primitive's `focus:ring` (with a hardcoded
  `ring-offset-slate-900`). Plain `<button>`s, links and selects in pages have none.

---

## 2. Technical Plan (summary)

1. **One token file per app**, `src/theme.css`, byte-identical in all three (CI checks this).
   It defines every color as an RGB triple in a CSS variable, under `:root` (light) and
   `:root.dark` (dark).
2. **Tailwind maps tokens to class names** and **replaces** its palette (`theme.colors`, not
   `extend`), so a raw `bg-slate-800` no longer exists.
3. **Dark theme ≈ today's look**, tokenized, with the contrast failures fixed. **Light theme** is
   new: slate surfaces on white, the same indigo accent.
4. **Theme selection.** An inline script in each `index.html` sets `.dark` before React renders,
   from the shared `localStorage` key `buzzer-theme`, else `prefers-color-scheme`. A
   `ThemeToggle` button in each app flips and saves it.
5. **A codemod sweep** applies the §4 mapping table, followed by a manual pass on what the
   table can't decide.
6. **Guardrails in CI:**
   - `scripts/check_theme_tokens.sh`: no raw palette classes or hex/rgb colors outside
     `theme.css`; the three `theme.css` files identical;
   - `scripts/check_contrast.mjs`: every declared text/background pair is ≥ 4.5:1 in both
     themes.
7. **Evidence:** `scripts/ui_screenshots.mjs` (the Playwright tour) produces
   `docs/ui/after-light/` and `docs/ui/after-dark/`, plus `docs/ui/contrast.md` from the contrast
   script and `docs/ui/README.md` as an index.

### Design decisions

**T1 — The token set.** Values are RGB triples (`--bg: 15 23 42`) so Tailwind's opacity
modifiers work (`bg-surface/60`). Names describe roles, not colors.

| Token | Role | Dark (≈ today) | Light |
|---|---|---|---|
| `bg` | page background | slate-900 `15 23 42` | slate-50 `248 250 252` |
| `surface` | cards, panels, sidebar | slate-800 `30 41 59` | white `255 255 255` |
| `surface-raised` | inputs, selected rows, secondary buttons | slate-700 `51 65 85` | slate-100 `241 245 249` |
| `surface-hover` | hover on surfaces | slate-600 `71 85 105` | slate-200 `226 232 240` |
| `border` | default borders, dividers | slate-700 `51 65 85` | slate-200 `226 232 240` |
| `border-strong` | input borders, emphasized dividers | slate-600 `71 85 105` | slate-300 `203 213 225` |
| `fg` | primary text | slate-100 `241 245 249` | slate-900 `15 23 42` |
| `fg-muted` | secondary text | slate-300 `203 213 225` | slate-600 `71 85 105` |
| `fg-subtle` | hints, captions, placeholders | slate-400 `148 163 184` | `85 98 120` (between slate-500 and -600) |
| `accent` | primary buttons, active nav | indigo-600 `79 70 229` | indigo-600 `79 70 229` |
| `accent-hover` | hover on accent | indigo-500 `99 102 241` | indigo-700 `67 56 202` |
| `on-accent` | text/icons on accent | white | white |
| `accent-fg` | accent-colored text and links | indigo-300 `165 180 252` | indigo-700 `67 56 202` |
| `success` | success fills (bars, badges) | green-600 `22 163 74` | green-600 `22 163 74` |
| `success-fg` | success text ("Spot on!", ✓) | green-400 `74 222 128` | green-700 `21 128 61` |
| `danger` | destructive buttons, error fills | red-600 `220 38 38` | red-600 `220 38 38` |
| `danger-fg` | error text, ✗ | red-400 `248 113 113` | red-700 `185 28 28` |
| `warning` | warning fills | amber-500 `245 158 11` | amber-500 `245 158 11` |
| `warning-fg` | warning text ("Answers locked", partial "≈") | amber-400 `251 191 36` | amber-700 `180 83 9` |
| `on-status` | text on `success` / `danger` fills | white | white |
| `on-warning` | text on `warning` fills | slate-900 | slate-900 |
| `focus` | focus ring | indigo-400 `129 140 248` | indigo-600 `79 70 229` |
| `option-1` … `option-8` | player answer buttons | see T5 | same as dark |
| `on-option-1` … `on-option-8` | text on answer buttons | see T5 | same as dark |
| `map-water` | MapCanvas background | `30 58 82` | `207 227 242` (today's `#cfe3f2`) |
| `qr-bg`, `qr-fg` | QR code card | white / black | white / black |

- The **dark** column keeps today's look, except that `fg-subtle` moves from slate-500 to
  slate-400. That's the contrast fix: slate-500 on slate-900 is 3.75.
- The **light `fg-subtle`** is a custom grey, because slate-500 on slate-100 is only 4.34.
- **Every value is final only once `check_contrast.mjs` passes** (T6). If a value fails during
  implementation, adjust it and record the change in §7.
- **Alpha uses** (today `bg-red-900/40`, `bg-green-900/30`, `bg-amber-500/10`) become a token
  with an opacity modifier, e.g. `bg-danger/15`, `bg-success/15`, `bg-warning/10`. There are no
  separate tint tokens.

**T2 — Tailwind replaces its palette.** In each `tailwind.config.ts`:

- `darkMode: 'class'`;
- `theme.colors` (top level, **not** `extend`) =
  `{ transparent: 'transparent', current: 'currentColor', inherit: 'inherit', ...tokens }`;
- each token is `'rgb(var(--<name>) / <alpha-value>)'`.

The token object is identical in the three configs. A leftover raw class such as `bg-slate-800`
then **generates no CSS at all**, so a miss in the sweep shows up as obviously unstyled rather
than silently staying dark. `white` and `black` are deliberately not provided: use `on-accent`,
`qr-bg` and so on.

**T3 — Theme selection and the toggle.**

- **Key:** `localStorage['buzzer-theme']` ∈ {`light`, `dark`}. It is **shared by all three
  apps**, because they share one origin, so the choice carries across them.
- **No flash.** A ~10-line inline `<script>` in each `index.html` `<head>`, before the app bundle:
  - read the key (in a `try`, since storage can throw);
  - if it's missing or invalid, use `matchMedia('(prefers-color-scheme: dark)').matches`;
  - set or remove `class="dark"` on `<html>`, and set `document.documentElement.style.colorScheme`
    so native controls (scrollbars, selects, date pickers) match.
- **`lib/theme.ts`** in each app (identical copies):
  - `getTheme()` reads the current class;
  - `setTheme(t)` sets the class and `colorScheme`, and saves the key;
  - `onThemeChange(cb)` uses a `MutationObserver` on `<html class>` and returns an unsubscribe
    function;
  - while no key is saved, a change of the OS preference re-applies (a `matchMedia` change
    listener).
- **`components/ThemeToggle.tsx`** in each app: one icon button (lucide `Sun` / `Moon`) with
  `aria-label` "Switch to light theme" / "Switch to dark theme" and `aria-pressed`. Placement:
  - **admin:** sidebar footer, above Logout, with the text "Light theme" / "Dark theme";
  - **host:** fixed top-right on every page (the game screens have no header), 44×44px;
  - **player:** fixed top-right on every page, 44×44px. On the question page it sits above the
    timer bar, so it never overlaps an answer button.

**T4 — Things Tailwind can't reach.**

- **MapCanvas** (all three copies): read colors at draw time with
  `getComputedStyle(document.documentElement).getPropertyValue('--map-water')` (and likewise for
  `success`, `warning`, `accent`, `surface`), and build `rgb(r g b / a)` strings. Subscribe with
  `onThemeChange` and redraw. The design's alphas stay the same.
- **QR code:** always rendered on a `bg-qr-bg` card with `fgColor`/`bgColor` taken from the
  `qr-*` tokens, so it scans in both themes.
- **Inline `style={{ height }}`** (the NumericBuckets bars) carries no color, so nothing changes.
- **`index.css`:** `body { background: rgb(var(--bg)); color: rgb(var(--fg)); }`, plus T7's
  global focus rule.

**T5 — Player answer buttons pass AA in both themes.** They keep their game-show identity: the
same order and hue family, but darker shades so white text passes. Yellow keeps its brightness
and switches to dark text.

| Option | Fill (both themes) | Text | Ratio |
|---|---|---|---|
| 1 A | red-700 `185 28 28` | white | 6.47 |
| 2 B | blue-700 `29 78 216` | white | 6.70 |
| 3 C | yellow-400 `250 204 21` | slate-900 | 11.66 |
| 4 D | green-700 `21 128 61` | white | 5.02 |
| 5 E | purple-700 `126 34 206` | white | 6.98 |
| 6 F | orange-700 `194 65 12` | white | 5.18 |
| 7 G | pink-700 `190 24 93` | white | 6.04 |
| 8 H | teal-700 `15 118 110` | white | 5.47 |

- Hover/active: `brightness-110`, a Tailwind filter with no color.
- Border: today each button has a lighter border in its own hue (`border-red-500` etc.). It
  becomes a neutral `border-fg/10`, because `white`/`black` and the raw hues don't exist after
  T2.
- Buttons stay full-width and at least 56px tall (today they're ~64px), so the 48px minimum tap
  target is kept.

**T6 — Contrast is checked by script, not by eye.** `scripts/check_contrast.mjs` (Node, no
dependencies):

- parses `frontend/host/src/theme.css` (the three are identical, T8);
- for each theme, checks a declared list of pairs (foreground token on background token);
- prints a table, exits 1 if any pair is below its threshold, and with `--markdown` writes
  `docs/ui/contrast.md`.

Pairs and thresholds:

- **4.5** (body text): `fg`, `fg-muted` and `fg-subtle` on each of `bg`, `surface` and
  `surface-raised`; `accent-fg` on `bg` and `surface`; `on-accent` on `accent` and
  `accent-hover`; `success-fg`, `danger-fg` and `warning-fg` on `bg` and `surface`; `on-status`
  on `success` and `danger`; `on-warning` on `warning`; each `on-option-N` on `option-N`.
- **3.0** (non-text UI, WCAG 1.4.11): `focus` on `bg` and `surface`; `border-strong` on `bg` and
  `surface`.

**T7 — Focus is always visible.**

- A global rule in `index.css`:
  `:focus-visible { outline: 3px solid rgb(var(--focus)); outline-offset: 2px; }`.
- The `ui/button` primitives drop their own `focus:ring-*` / `ring-offset-slate-900` classes in
  favor of this rule.
- **Never `outline-none`** without a replacement. The sweep removes the bare `focus:outline-none`
  from inputs, which today rely on `focus:ring-2 focus:ring-indigo-500` → `focus:ring-focus`.

**T8 — Guardrails.** `scripts/check_theme_tokens.sh` (POSIX `sh` + `grep`), run in a new CI job
`frontend-theme` (stage `lint`, image `alpine`, merge requests only, like the others):

1. **Raw palette classes:** no matches of
   `\b(bg|text|border|ring|ring-offset|from|to|via|fill|stroke|placeholder|divide|outline|accent|shadow|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b`
   in `frontend/*/src/**/*.{ts,tsx,css}`.
2. **Hex or rgb colors:** no matches of `#[0-9a-fA-F]{3,8}\b` or `rgba?\(` in
   `frontend/*/src/**/*.{ts,tsx}`, or in `.css` files other than `theme.css`. The `rgb(var(--…))`
   form is allowed: the check excludes matches followed by `var(`.
3. **Identical token files:** `cmp` of `frontend/{host,player,admin}/src/theme.css`.
4. Each failure prints file:line, and the script exits 1.

`check_contrast.mjs` runs in the same job (`apk add nodejs`). These checks keep T8's new UI on
tokens too.

**T9 — Context fit, beyond color.**

- **Host (classroom display):**
  - on the game screens (lobby, question, results, game over), no text below 18px (`text-lg`),
    except the QR caption;
  - prompts at least `text-3xl`;
  - in the dark theme, muted text uses `fg-muted`, never `fg-subtle`;
  - checked by reading each game page during the manual pass, and listed in §5.
- **Player:** tap targets at least 48px; answer buttons per T5; the toggle never overlaps
  answers (T3).
- **Admin:** no layout change; tokens only.

---

## 3. Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| 1 | **Extend the palette instead of replacing it** | Leftover raw classes would keep working, silently, in the wrong color for one theme. Replacing makes every miss visible (T2) |
| 2 | **`dark:` variants on every class** (`bg-white dark:bg-slate-800`) | Doubles ~820 class uses, has no semantic layer, and the spec asks for tokens |
| 3 | **A shared `frontend/shared/theme.css`** imported by all three apps | The apps are separate Vite builds with no shared code (T4 host design D6). Three identical copies plus a CI `cmp` check gets the same guarantee without build changes |
| 4 | **Per-app theme keys** | Same origin, so three keys would let the apps disagree within one browser. One shared key was chosen (user decision) |
| 5 | **A new accent color / visual refresh** | Indigo is kept (user decision). The "deliberate design" is the light theme, the contrast fixes, focus states and the host type scale |
| 6 | **Screenshots by hand** | Not repeatable for the "after" set in two themes. A Playwright tour (user decision) re-runs in minutes |
| 7 | **Wait for T8 before sweeping** | Deadline 2026-10-06. Landing T9 fast and having T8 rebase onto tokens is cheaper than T9 rebasing over T8's new UI (§6) |
| 8 | **ESLint plugin for Tailwind classes** | A new dependency and config in three apps; one grep script covers it |

---

## 4. Detailed implementation

### Step 1 — Tokens and Tailwind (all three apps)

- New `src/theme.css` with the T1 table: the light values under `:root`, the dark ones under
  `:root.dark`, plus the T5 option tokens. Imported first in `index.css`.
- `index.css`: the body rule from T4 and the focus rule from T7.
- `tailwind.config.ts`: `darkMode: 'class'` and `theme.colors` replaced per T2.
- `index.html`: the T3 inline script.

### Step 2 — `lib/theme.ts` and `components/ThemeToggle.tsx` (all three apps)

As specified in T3, mounted in each app's root layout:

- **admin:** `AdminLayout` sidebar footer, plus `LoginPage` and `NotAdminPage`, which have no
  sidebar (fixed top-right there);
- **host:** `App.tsx`, so it's fixed on every route;
- **player:** `App.tsx`, the same.

### Step 3 — The codemod sweep

A one-off Node script, **not committed** (its effect is the commit), applies the mapping below
to every `.tsx` in `frontend/*/src`. Prefixes (`bg-`, `text-`, `border-`, `ring-`, `hover:`,
`focus:`, `disabled:`, `placeholder:`, …) are kept, and opacity suffixes (`/60`) are kept.

| Today | Becomes |
|---|---|
| `bg-slate-900` / `bg-slate-950` | `bg-bg` |
| `bg-slate-800` | `bg-surface` |
| `bg-slate-700` | `bg-surface-raised` |
| `bg-slate-600` (mostly `hover:`) | `bg-surface-hover` |
| `text-slate-100` / `-200` / `text-white` on surfaces | `text-fg` |
| `text-slate-300` | `text-fg-muted` |
| `text-slate-400` | `text-fg-muted` |
| `text-slate-500` / `-600` | `text-fg-subtle` |
| `placeholder:text-slate-400` / `-500` | `placeholder:text-fg-subtle` |
| `border-slate-700` / `divide-slate-700` | `border-border` / `divide-border` |
| `border-slate-600` / `-500` | `border-border-strong` |
| `bg-indigo-600` | `bg-accent` |
| `bg-indigo-500` / `hover:bg-indigo-500` | `bg-accent-hover` |
| `text-indigo-300` / `-400` | `text-accent-fg` |
| `ring-indigo-500` / `border-indigo-500` / `-400` | `ring-focus` / `border-accent` |
| `text-green-300` / `-400` | `text-success-fg` |
| `bg-green-500` / `-600` | `bg-success` |
| `bg-green-900/NN` | `bg-success/15` |
| `text-red-300` / `-400` | `text-danger-fg` |
| `bg-red-500` / `-600` / `-700` | `bg-danger` |
| `bg-red-900/NN`, `border-red-500/NN` | `bg-danger/15`, `border-danger/40` |
| `text-amber-300` / `-400`, `text-yellow-400` | `text-warning-fg` |
| `bg-amber-500` / `bg-yellow-500` / `-600` | `bg-warning` |
| `bg-amber-500/10`, `bg-amber-900/NN`, `bg-yellow-100` | `bg-warning/10` |
| `ring-offset-slate-900` | removed (T7) |

**Context decides `text-white`.** On an accent, danger, success or option background it
becomes `on-accent` / `on-status` / `on-option-N`; on a surface it becomes `fg`. The script
flags every `text-white` for the manual pass instead of guessing.

The **manual pass** handles:

- every line the script flagged;
- `OPTION_COLORS` → the eight option tokens (T5);
- `NumericBuckets`' bar colors: the zero bars use `surface-hover`, the partial bars `accent`,
  the full bar `success`;
- `AnswerBarChart` / `WordCloud` (host) and the admin `SessionsPage` badges;
- anything the guardrail script (T8) still reports.

**Done** means `check_theme_tokens.sh` passes and every screenshot in §5 looks intentional in
both themes.

### Step 4 — MapCanvas and QR (T4)

All three `MapCanvas.tsx` copies: a `cssColor(name, alpha?)` helper and a redraw on
`onThemeChange`. The host `LobbyPage` QR card uses the `qr-*` tokens.

### Step 5 — Answer buttons and focus (T5, T7)

`OPTION_COLORS` becomes eight `bg-option-N text-on-option-N` pairs. The `ui/button` primitives
in the three apps drop `focus:ring-*` and `ring-offset-*`.

### Step 6 — Host type scale (T9)

Bring host game-screen text that's below `text-lg` up to `text-lg` (QR caption excepted), and
prompts to at least `text-3xl`.

### Step 7 — Guardrails and CI (T6, T8)

- New `scripts/check_theme_tokens.sh` and `scripts/check_contrast.mjs`.
- New `.gitlab-ci.yml` job `frontend-theme`.
- Both must pass locally before the MR.

### Step 8 — Screenshots and evidence

- `scripts/ui_screenshots.mjs`: the tour used for the "before" set. It takes
  `<outDir> [light|dark]`, seeds `buzzer-theme` and the emulated `colorScheme`, creates a
  temporary 3-question game, and deletes it afterwards.
  - It needs `npm i playwright` and `npx playwright install chromium`, run in a scratch folder,
    or as a `devDependency` of a new `scripts/package.json`. The latter is the choice, so
    `scripts/` stays self-contained.
- Run it twice into `docs/ui/after-light/` and `docs/ui/after-dark/`.
- `docs/ui/README.md`:
  - how to re-run the tour;
  - a table linking the key screens (before / after-light / after-dark side by side): player
    question, player results, host lobby, host question, host results (numeric), admin course
    page and the question editor;
  - a link to `contrast.md`.

### Step 9 — Context docs

Rewrite the **Theming (T9)** gotchas in each `frontend/*/src/CLAUDE.md` and
`components/CLAUDE.md` to describe the token system. Note in `lib/CLAUDE.md` (all three) the
`theme.ts` helpers, and in `scripts/` the new scripts.

### Files touched

| Area | Files |
|---|---|
| Per app ×3 | `src/theme.css` (**new**), `src/index.css`, `tailwind.config.ts`, `index.html`, `src/lib/theme.ts` (**new**), `src/components/ThemeToggle.tsx` (**new**), `src/components/ui/*`, `src/components/MapCanvas.tsx`, every page with palette classes (~47 files) |
| Host only | `pages/game/LobbyPage.tsx` (QR), `components/NumericBuckets.tsx` |
| Player only | `pages/game/QuestionPage.tsx` (`OPTION_COLORS`) |
| Repo | `scripts/check_theme_tokens.sh`, `scripts/check_contrast.mjs`, `scripts/ui_screenshots.mjs`, `scripts/package.json` (**new**), `.gitlab-ci.yml`, `docs/ui/**`, context docs |

**Not touched:** backend, game logic, layout and routing (apart from mounting the toggle).

---

## 5. Verification

- `scripts/check_theme_tokens.sh` passes, and `node scripts/check_contrast.mjs` passes in both
  themes.
- `npx tsc --noEmit` and `npm run build` in all three apps.
- **Screenshot tour in both themes, inspected screen by screen.** Pass criteria:
  - no unstyled element (the sign of a missed raw class under T2);
  - readable text everywhere;
  - a visible focus ring when tabbing on the admin course page, the host home page and the
    player join page (checked by hand with the keyboard);
  - the QR code scans from a phone in both themes;
  - the map canvas repaints when the theme is toggled mid-game.
- **Toggle behavior:**
  - first visit with OS dark → dark, and OS light → light;
  - toggle, reload → the choice persists;
  - toggle in admin, open the host app → same theme (shared key);
  - no flash of the wrong theme on load (a hard reload with throttled CPU in devtools).
- Existing integration tests still pass, since the backend is unchanged.

---

## 6. Coordination and risks

- **T8 is changing the same files** (the editors for image upload, the player question page
  for image options, new image-management UI).
  - Plan: **land T9 fast.** First the tokens, Tailwind, the sweep and the guardrails as one MR,
    then the screenshots/evidence as a follow-up if time is short.
  - T8 rebases onto it, and its new UI uses tokens; the CI guardrail tells it when it doesn't.
  - Tell Bill when the T9 MR opens, with the mapping table (§4 Step 3) so his conflict
    resolution is mechanical.
- **The sweep is large.** ~820 replacements; the codemod makes it mechanical, and the replaced
  palette (T2) makes misses visible. The risk is wrong role choices (e.g. `text-white` on a
  surface vs on accent), which the manual pass and the two-theme screenshots catch.
- **A light theme is a new design, not an inversion.** The light values in T1 are chosen per
  role, not by flipping the scale. Any value that fails `check_contrast` gets adjusted and
  recorded in §7.
- **Canvas redraw on toggle** adds a `MutationObserver` per canvas. It is unsubscribed on
  unmount.
- **Storage can throw** (private mode, blocked storage). The inline script and `theme.ts` wrap
  every access; on failure the OS preference wins and the toggle still works for the session.

---

## 7. Goldfish revision log

*(Filled in after the Goldfish test.)*
