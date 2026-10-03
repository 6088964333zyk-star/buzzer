import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import ManageNav from './ManageNav';
import {
  MAX_ROWS,
  previewUpload,
  toRosterRows,
  type RosterEntry,
  type RosterPreview,
  type RosterRow,
} from './rosterCsv';

interface UploadResult { imported: number; updated: number; deactivated: number; errors: string[] }

/**
 * Roster view + CSV upload. Upload is a full replace (design D4): anyone active
 * who is missing from the file is deactivated, so the host sees a preview and
 * must confirm before anything is sent.
 */
export default function RosterPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ file: string; rows: RosterRow[]; preview: RosterPreview } | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setEntries(await api.get<RosterEntry[]>(`/host/courses/${courseId}/roster`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roster');
    }
  }

  useEffect(() => { void load(); }, [courseId]);

  function onFile(file: File) {
    setError('');
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = toRosterRows(String(reader.result ?? ''));
        if (rows.length === 0) throw new Error('No usable rows (each needs a netid, name and email).');
        if (rows.length > MAX_ROWS) throw new Error(`The file has ${rows.length} rows; the limit is ${MAX_ROWS}.`);
        setPending({ file: file.name, rows, preview: previewUpload(entries, rows) });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read the CSV');
      }
    };
    reader.readAsText(file);
  }

  async function confirmUpload() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      setResult(await api.post<UploadResult>(`/host/courses/${courseId}/roster/import`, { rows: pending.rows }));
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(entry: RosterEntry) {
    try {
      const updated = await api.patch<RosterEntry>(
        `/host/courses/${courseId}/roster/${entry.id}`,
        { is_active: !entry.is_active },
      );
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  const active = entries.filter((e) => e.is_active).length;

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto space-y-6">
      <ManageNav courseId={courseId} />

      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">{active} active · {entries.length - active} inactive</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload size={14} className="mr-1" /> Upload roster CSV
        </Button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {pending && (
        <Card>
          <CardHeader><h3 className="font-semibold text-slate-100">Replace roster from {pending.file}?</h3></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-slate-300 text-sm">
              {pending.preview.added.length} new · {pending.preview.updated.length} updated ·{' '}
              <span className={pending.preview.deactivated.length ? 'text-red-400 font-semibold' : ''}>
                {pending.preview.deactivated.length} will be deactivated
              </span>
            </p>
            {pending.preview.deactivated.length > 0 && (
              <p className="text-red-300 text-xs">
                This upload replaces the roster. Students not in the file can no longer join:{' '}
                {pending.preview.deactivated.slice(0, 10).join(', ')}
                {pending.preview.deactivated.length > 10 ? ` and ${pending.preview.deactivated.length - 10} more` : ''}
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void confirmUpload()} disabled={busy}>
                {busy ? 'Uploading…' : 'Confirm upload'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <p className="text-green-400 text-sm">
          Uploaded: {result.imported} new, {result.updated} updated, {result.deactivated} deactivated.
          {result.errors.length > 0 && ` ${result.errors.length} row(s) skipped.`}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr>
                <th className="px-4 py-2">NetID</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-700">
                  <td className="px-4 py-2 font-mono text-slate-200">{e.netid}</td>
                  <td className="px-4 py-2 text-slate-200">{e.full_name}</td>
                  <td className="px-4 py-2 text-slate-400">{e.email}</td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant={e.is_active ? 'outline' : 'ghost'} onClick={() => void toggle(e)}>
                      {e.is_active ? 'Active' : 'Inactive'}
                    </Button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No students yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
