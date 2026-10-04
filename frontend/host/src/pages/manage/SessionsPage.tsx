import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import ManageNav from './ManageNav';

interface SessionItem {
  session_id: string;
  room_code: string;
  status: string;
  game_title: string;
  created_at: string;
  completed_at: string | null;
  player_count: number;
}

/** Every session of the course, for any HOST of it (design D3), with downloads. */
export default function SessionsPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<SessionItem[]>(`/host/courses/${courseId}/sessions`)
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions'))
      .finally(() => setLoading(false));
  }, [courseId]);

  async function download(sessionId: string, kind: 'export' | 'report') {
    setError('');
    try {
      await api.download(`/host/sessions/${sessionId}/${kind}`, `session.${kind === 'export' ? 'csv' : 'html'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto space-y-6">
      <ManageNav courseId={courseId} />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading && <p className="text-slate-400">Loading…</p>}
      {!loading && sessions.length === 0 && <p className="text-slate-400">No sessions yet.</p>}

      <div className="space-y-3">
        {sessions.map((s) => (
          <Card key={s.session_id}>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="font-semibold text-slate-100">{s.game_title}</p>
                <p className="text-slate-400 text-sm">
                  {new Date(s.completed_at ?? s.created_at).toLocaleString()} · room {s.room_code} ·{' '}
                  {s.status.toLowerCase()} · {s.player_count} player{s.player_count === 1 ? '' : 's'}
                </p>
              </div>
              {s.status === 'COMPLETED' && (
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => void download(s.session_id, 'export')}>
                    <Download size={14} className="mr-1" /> Scores CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void download(s.session_id, 'report')}>
                    <Download size={14} className="mr-1" /> Summary
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
