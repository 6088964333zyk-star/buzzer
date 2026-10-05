// UI screenshot tour for T9 (docs/ui/). Drives the running stack at BASE_URL:
// admin + host on a desktop viewport, a player on a phone viewport, through a
// real 3-question game (multiple choice, numeric, map_pin). It creates a
// temporary game "UI tour (screenshots)" and deletes it afterwards.
//
// Setup (once):  cd scripts && npm install && npx playwright install chromium
// Needs: the stack running behind nginx (default http://localhost:8080) with
// at least one course; it uses "Demo Course" from seed_demo.py if present.
// Logs in as ADMIN_USERNAME / ADMIN_PASSWORD (defaults as in .env.template).
//
// Usage: node ui_screenshots.mjs <outDir> [theme]
//   theme: omitted = app default (how the "before" shots were taken); "light" |
//   "dark" sets the shared preference (localStorage buzzer-theme) and the OS
//   preference.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const ADMIN_USER = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? 'change_me_admin';
const [outDir, theme] = process.argv.slice(2);
if (!outDir) throw new Error('usage: node ui_screenshots.mjs <outDir> [light|dark]');
mkdirSync(outDir, { recursive: true });

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const QUESTIONS = [
  {
    type: 'multiple_choice', grading_type: 'ACCURACY', prompt: 'Which measure is most affected by outliers?',
    config: { options: ['Median', 'Mean', 'Mode', 'Interquartile range'] },
    answer_data: { answer_points: [0, 1, 0, 0] }, points_value: 1, time_limit_seconds: 120,
  },
  {
    type: 'numeric', grading_type: 'ACCURACY', prompt: 'Estimate the correlation: hours studied vs. exam score',
    config: {}, answer_data: { answer: 0.62, toleranceMode: 'absolute', fullTolerance: 0.05, zeroTolerance: 0.15 },
    points_value: 10, time_limit_seconds: 120,
  },
  {
    type: 'map_pin', grading_type: 'ACCURACY', prompt: 'Where is Madison, Wisconsin?',
    config: { aspectRatio: 2 }, answer_data: { target: { x: 0.256, y: 0.264 }, fullRadius: 0.02, zeroRadius: 0.15 },
    points_value: 10, time_limit_seconds: 120,
  },
];

const { access_token: token } = await api('/auth/login', {
  method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASS },
});
const courses = await api('/admin/courses', { token });
const course = courses.find((c) => c.name.startsWith('Demo Course')) ?? courses[0];
const game = await api('/admin/games', {
  token, method: 'POST', body: { title: 'UI tour (screenshots)', course_id: course.id },
});
for (const q of QUESTIONS) {
  await api(`/admin/games/${game.id}/questions`, { token, method: 'POST', body: q });
}

const browser = await chromium.launch();
const prefs = theme ? { colorScheme: theme } : {};
const seed = (t) => {
  // Runs before any page script: the stored token, plus the shared theme preference.
  return ({ t, theme }) => {
    if (t) localStorage.setItem('token', t);
    if (theme) localStorage.setItem('buzzer-theme', theme);
  };
};
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...prefs });
await desk.addInitScript(seed(), { t: null, theme: theme ?? null });
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...prefs,
});
await phone.addInitScript(seed(), { t: null, theme: theme ?? null });

const shot = async (page, name) => {
  await page.waitForTimeout(400); // let transitions settle
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  console.log('  ', name);
};

try {
  // ── Admin ──────────────────────────────────────────────────────────────
  const admin = await desk.newPage();
  await admin.goto(`${BASE}/admin/login`);
  await shot(admin, 'admin-login');
  await admin.evaluate((t) => localStorage.setItem('token', t), token);
  await admin.goto(`${BASE}/admin/courses`);
  await admin.getByText(course.name).first().waitFor();
  await shot(admin, 'admin-courses');
  await admin.goto(`${BASE}/admin/courses/${course.id}`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, 'admin-course-detail');
  await admin.goto(`${BASE}/admin/games`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, 'admin-games');
  await admin.goto(`${BASE}/admin/games/${game.id}/questions`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, 'admin-question-editor');
  await admin.goto(`${BASE}/admin/users`);
  await admin.waitForLoadState('networkidle');
  await shot(admin, 'admin-users');

  // ── Host management ────────────────────────────────────────────────────
  const host = await desk.newPage();
  await host.goto(`${BASE}/host/login`);
  await shot(host, 'host-login');
  await host.evaluate((t) => localStorage.setItem('token', t), token);
  await host.goto(`${BASE}/host/home`);
  await host.waitForLoadState('networkidle');
  await shot(host, 'host-home');
  await host.goto(`${BASE}/host/manage/${course.id}/games`);
  await host.waitForLoadState('networkidle');
  await shot(host, 'host-manage-games');
  await host.goto(`${BASE}/host/manage/${course.id}/games/${game.id}`);
  await host.waitForLoadState('networkidle');
  await shot(host, 'host-question-editor');
  await host.goto(`${BASE}/host/manage/${course.id}/roster`);
  await host.waitForLoadState('networkidle');
  await shot(host, 'host-roster');

  // ── Live game ──────────────────────────────────────────────────────────
  const { room_code: code } = await api('/game/rooms', {
    token, method: 'POST', body: { course_id: course.id, game_id: game.id },
  });
  await host.goto(`${BASE}/host/game/${code}/lobby`);
  await host.getByRole('button', { name: /Waiting for players/ }).waitFor();

  const player = await phone.newPage();
  await player.goto(`${BASE}/player/join`);
  await shot(player, 'player-join');
  await player.getByPlaceholder('XXXXXX').fill(code);
  await player.getByRole('button', { name: /join/i }).first().click();
  await player.getByPlaceholder('Your name').waitFor();
  await player.getByPlaceholder('Your name').fill('Avery');
  await player.getByPlaceholder('you@example.com').fill('avery@example.com');
  await shot(player, 'player-name');
  await player.getByRole('button', { name: 'Join Game' }).click();
  await player.waitForURL(/\/lobby$/);
  await shot(player, 'player-lobby');

  await host.getByRole('button', { name: 'Start Game' }).waitFor();
  await shot(host, 'host-lobby');

  const advanceToResults = async (label) => {
    await host.getByRole('button', { name: 'Show Results' }).click();
    await host.waitForURL(/\/results$/);
    await player.waitForURL(/\/results$/);
    await shot(host, `host-results-${label}`);
    await shot(player, `player-results-${label}`);
  };

  // Q1: multiple choice
  await host.getByRole('button', { name: 'Start Game' }).click();
  await player.waitForURL(/\/question$/);
  await host.waitForURL(/\/question$/);
  await shot(host, 'host-question-mc');
  await shot(player, 'player-question-mc');
  await player.getByRole('button', { name: /Mean/ }).click();
  await player.waitForURL(/\/feedback$/);
  await shot(player, 'player-feedback');
  await advanceToResults('mc');

  // Q2: numeric
  await host.getByRole('button', { name: /Next Question/ }).click();
  await player.waitForURL(/\/question$/);
  await player.getByLabel('Your estimate').fill('0.58');
  await shot(host, 'host-question-numeric');
  await shot(player, 'player-question-numeric');
  await player.getByRole('button', { name: 'Submit' }).click();
  await player.waitForURL(/\/feedback$/);
  await advanceToResults('numeric');

  // Q3: map_pin
  await host.getByRole('button', { name: /Next Question/ }).click();
  await player.waitForURL(/\/question$/);
  const canvas = player.locator('canvas').first();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.27, y: box.height * 0.28 } });
  await shot(host, 'host-question-map');
  await shot(player, 'player-question-map');
  await player.getByRole('button', { name: 'Submit' }).click();
  await player.waitForURL(/\/feedback$/);
  await advanceToResults('map');

  // Game over
  await host.getByRole('button', { name: /Show Final Results/ }).click();
  await host.waitForURL(/\/gameover$/);
  await player.waitForURL(/\/gameover$/);
  await shot(host, 'host-gameover');
  await shot(player, 'player-gameover');

  await host.goto(`${BASE}/host/manage/${course.id}/sessions`);
  await host.waitForLoadState('networkidle');
  await shot(host, 'host-sessions');
} finally {
  await browser.close();
  await api(`/admin/games/${game.id}`, { token, method: 'DELETE' }).catch((e) => console.warn(e.message));
}
