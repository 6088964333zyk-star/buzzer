// Roster CSV helpers for the host app. parseCSV is copied from
// frontend/admin/src/pages/RosterPage.tsx (separate Vite builds can't share files).
// Instead of admin's column-mapping wizard, the host auto-detects two formats:
//   - Canvas gradebook export: "Student" ("Last, First") + "SIS Login ID" ("NETID@WISC.EDU")
//   - Basic roster: "netid" + "name"/"full_name" + "email"

export interface RosterRow {
  netid: string;
  full_name: string;
  email: string;
}

export interface RosterEntry {
  id: number;
  netid: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

export const MAX_ROWS = 1000; // mirrors backend roster_service.MAX_ROWS

// ── Minimal RFC-4180-compliant CSV parser (copied from admin) ────────────────
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else { field += ch; }
    }
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Same normalization the server applies (roster_service.process_roster_rows). */
export function normalizeNetid(netid: string): string {
  return netid.trim().toLowerCase();
}

/** Parse a roster CSV into rows; throws with a readable message if the format is unknown. */
export function toRosterRows(text: string): RosterRow[] {
  const all = parseCSV(text.replace(/^﻿/, ''));
  if (all.length === 0) throw new Error('The CSV file is empty.');
  const headers = all[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const data = all.slice(1);

  const student = col('student');
  const sis = col('sis login id');
  if (student >= 0 && sis >= 0) {
    return data
      .filter((r) => !(r[0] ?? '').trim().toLowerCase().startsWith('points possible'))
      .map((r) => {
        const login = (r[sis] ?? '').trim().toLowerCase();
        const raw = (r[student] ?? '').trim();
        const given = raw.includes(',') ? raw.split(',').slice(1).join(',').trim() : raw;
        return {
          netid: login.split('@')[0],
          full_name: given.replace(/\b\w/g, (c) => c.toUpperCase()),
          email: login,
        };
      })
      .filter((r) => r.netid && r.full_name && r.email);
  }

  const netid = col('netid');
  const name = col('name', 'full_name', 'full name');
  const email = col('email');
  if (netid >= 0 && name >= 0 && email >= 0) {
    return data
      .map((r) => ({
        netid: (r[netid] ?? '').trim(),
        full_name: (r[name] ?? '').trim(),
        email: (r[email] ?? '').trim(),
      }))
      .filter((r) => r.netid && r.full_name && r.email);
  }

  throw new Error(
    'Unrecognized CSV. Use a Canvas gradebook export ("Student", "SIS Login ID") ' +
      'or a file with "netid", "name" and "email" columns.',
  );
}

export interface RosterPreview {
  added: string[];
  updated: string[];
  deactivated: string[];
}

/**
 * What the server's full-replace upload will do (design D4). Must match
 * RosterUploadResult: an existing netid counts as "updated" whether it was
 * active or not (inactive ones get reactivated); only currently-active netids
 * missing from the file are deactivated.
 */
export function previewUpload(current: RosterEntry[], rows: RosterRow[]): RosterPreview {
  const existing = new Set(current.map((e) => normalizeNetid(e.netid)));
  const incoming = new Set(rows.map((r) => normalizeNetid(r.netid)));
  return {
    added: [...incoming].filter((n) => !existing.has(n)),
    updated: [...incoming].filter((n) => existing.has(n)),
    deactivated: current
      .filter((e) => e.is_active && !incoming.has(normalizeNetid(e.netid)))
      .map((e) => e.netid),
  };
}
