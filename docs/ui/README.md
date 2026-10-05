# UI screenshots (T9 theming)

Evidence for T9 ([design](../design-t9-theming.md)). Every screen was captured by the same
Playwright tour, which plays a real three-question game (multiple choice, numeric, map pin):

| Folder | What |
|---|---|
| [`before/`](before/) | The starter UI before any T9 change (one hardcoded dark palette) |
| [`after-light/`](after-light/) | The light theme |
| [`after-dark/`](after-dark/) | The dark theme |

Token contrast in both themes: [contrast.md](contrast.md) (39 pairs, all pass WCAG 2.1 AA).

## Key screens

| Screen | Before | After, light | After, dark |
|---|---|---|---|
| Player question (multiple choice) | ![](before/player-question-mc.png) | ![](after-light/player-question-mc.png) | ![](after-dark/player-question-mc.png) |
| Player question (numeric) | ![](before/player-question-numeric.png) | ![](after-light/player-question-numeric.png) | ![](after-dark/player-question-numeric.png) |
| Player results (map pin) | ![](before/player-results-map.png) | ![](after-light/player-results-map.png) | ![](after-dark/player-results-map.png) |
| Host lobby | ![](before/host-lobby.png) | ![](after-light/host-lobby.png) | ![](after-dark/host-lobby.png) |
| Host question | ![](before/host-question-mc.png) | ![](after-light/host-question-mc.png) | ![](after-dark/host-question-mc.png) |
| Host results (numeric) | ![](before/host-results-numeric.png) | ![](after-light/host-results-numeric.png) | ![](after-dark/host-results-numeric.png) |
| Host game over | ![](before/host-gameover.png) | ![](after-light/host-gameover.png) | ![](after-dark/host-gameover.png) |
| Admin course page | ![](before/admin-course-detail.png) | ![](after-light/admin-course-detail.png) | ![](after-dark/admin-course-detail.png) |
| Admin question editor | ![](before/admin-question-editor.png) | ![](after-light/admin-question-editor.png) | ![](after-dark/admin-question-editor.png) |

All 31 screens exist in each folder under the same file names.

## Re-running the tour

```bash
# once
cd scripts && npm install && npx playwright install chromium

# with the stack running behind nginx (npm run build in each app, then localhost:8080)
node ui_screenshots.mjs ../docs/ui/after-light light
node ui_screenshots.mjs ../docs/ui/after-dark dark
node check_contrast.mjs --markdown        # regenerates contrast.md
```

The tour logs in as `ADMIN_USERNAME` / `ADMIN_PASSWORD` (source `.env` first), creates a
temporary game "UI tour (screenshots)" in the first course, and deletes it at the end.
