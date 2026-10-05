import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';

interface Course { id: number; name: string; semester: string }
interface Game { id: number; title: string; course_id: number | null }
interface ActiveSession {
  session_id: string;
  room_code: string;
  status: string;
  game_title: string;
  course_name: string;
  course_semester: string;
}

export default function HomePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<number | ''>('');
  const [gameId, setGameId] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get<Course[]>('/game/my-courses'),
      api.get<Game[]>('/game/my-games'),
      api.get<ActiveSession[]>('/game/my-active-sessions'),
    ]).then(([c, g, s]) => {
      setCourses(c);
      setGames(g);
      setActiveSessions(s);
      if (c.length === 1) setCourseId(c[0].id);
    }).catch(() => setError('Failed to load courses or games. Are you still logged in?'));
  }, []);

  // A course-owned game only runs in its own course (design D1). Course-less
  // legacy games are only returned to admins, who may start them anywhere.
  const courseGames = games.filter(g => g.course_id === courseId || g.course_id === null);

  useEffect(() => {
    if (courseGames.length === 1) setGameId(courseGames[0].id);
    else if (!courseGames.some(g => g.id === gameId)) setGameId('');
  }, [courseId, games]);

  async function deleteSession(sessionId: string) {
    try {
      await api.delete(`/game/sessions/${sessionId}`);
      setActiveSessions(prev => prev.filter(s => s.session_id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setConfirmDelete(null);
    }
  }

  async function createRoom() {
    if (!courseId || !gameId) return;
    setError('');
    setLoading(true);
    try {
      const data = await api.post<{ room_code: string }>('/game/rooms', {
        course_id: courseId,
        game_id: gameId,
      });
      navigate(`/game/${data.room_code}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
      {activeSessions.length > 0 && (
        <Card className="w-full max-w-lg border-warning/40">
          <CardHeader>
            <h2 className="text-lg font-semibold text-warning-fg">Active Sessions</h2>
            <p className="text-fg-subtle text-sm">You have running games — rejoin one or create a new room below.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeSessions.map(s => (
              <div
                key={s.session_id}
                className="flex items-center justify-between rounded-lg bg-surface border border-border px-4 py-3"
              >
                <div>
                  <p className="text-fg font-medium">{s.game_title}</p>
                  <p className="text-fg-subtle text-sm">{s.course_name} · {s.course_semester}</p>
                  <p className="text-fg-subtle text-xs mt-0.5">
                    Room <span className="font-mono text-fg-muted">{s.room_code}</span>
                    {' · '}
                    <span className={s.status === 'IN_PROGRESS' ? 'text-success-fg' : 'text-warning-fg'}>
                      {s.status === 'IN_PROGRESS' ? 'In Progress' : 'Lobby'}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {confirmDelete === s.session_id ? (
                    <>
                      <span className="text-danger-fg text-xs">Delete all data?</span>
                      <Button size="sm" variant="destructive" onClick={() => deleteSession(s.session_id)}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/game/${s.room_code}/lobby`)}>
                        Rejoin
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(s.session_id)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-fg">Create Game Room</h1>
              <p className="text-fg-subtle text-sm mt-1">Select a course and quiz to begin</p>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">Course</label>
            <select
              value={courseId}
              onChange={e => setCourseId(Number(e.target.value))}
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-fg"
            >
              <option value="">Select a course…</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.name} — {c.semester}</option>
              ))}
            </select>
            {courseId && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => navigate(`/manage/${courseId}/games`)}
              >
                Manage this course: games, roster, sessions →
              </Button>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">Quiz</label>
            <select
              value={gameId}
              onChange={e => setGameId(Number(e.target.value))}
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-fg"
            >
              <option value="">Select a quiz…</option>
              {courseGames.map(g => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-danger-fg text-sm">{error}</p>}
          <Button
            className="w-full"
            size="lg"
            onClick={createRoom}
            disabled={!courseId || !gameId || loading}
          >
            {loading ? 'Creating room…' : 'Create Room'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
