import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, List, Upload, Trash2, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';

interface Game {
  id: number;
  title: string;
  description: string;
  max_players: number;
  course_id: number | null;
  created_at: string;
}

interface Course { id: number; name: string; semester: string }

const selectClass = 'rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 text-sm';

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('150');
  const [courseId, setCourseId] = useState('');
  const [importCourseId, setImportCourseId] = useState('');
  // Per-row course choice for games that don't have one yet
  const [assignChoice, setAssignChoice] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMaxPlayers, setEditMaxPlayers] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function load() {
    // Load independently: a courses failure shouldn't hide the games list.
    const [gs, cs] = await Promise.allSettled([
      api.get<Game[]>('/admin/games'),
      api.get<Course[]>('/admin/courses'),
    ]);
    const failures: string[] = [];
    if (gs.status === 'fulfilled') setGames(gs.value);
    else failures.push(gs.reason instanceof Error ? gs.reason.message : 'Failed to load games');
    if (cs.status === 'fulfilled') setCourses(cs.value);
    else failures.push(cs.reason instanceof Error ? cs.reason.message : 'Failed to load courses');
    setCoursesLoaded(cs.status === 'fulfilled');
    if (failures.length > 0) setError(failures.join('; '));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/admin/games', {
        title,
        description,
        max_players: Number(maxPlayers),
        course_id: Number(courseId),
      });
      setTitle(''); setDescription(''); setMaxPlayers('150'); setCourseId('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(g: Game) {
    setEditingGame(g);
    setEditTitle(g.title);
    setEditDescription(g.description);
    setEditMaxPlayers(String(g.max_players));
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingGame) return;
    setEditSaving(true);
    setError('');
    try {
      await api.put(`/admin/games/${editingGame.id}`, {
        title: editTitle,
        description: editDescription,
        max_players: Number(editMaxPlayers),
      });
      setEditingGame(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update game');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !importCourseId) return;
    setImporting(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.postForm<{ game_id: number }>('/admin/games/import', form);
      // Import has no course parameter; assign it with the set-once PUT. The chosen
      // course always wins over any course_id inside the file (design A6).
      try {
        await api.put(`/admin/games/${result.game_id}`, { course_id: Number(importCourseId) });
      } catch (err) {
        setError(`Imported, but assigning the course failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        await load();
        return;
      }
      setImportCourseId('');
      await load();
      navigate(`/games/${result.game_id}/questions`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function assignCourse(g: Game) {
    const chosen = courses.find((c) => String(c.id) === assignChoice[g.id]);
    if (!chosen) return;
    if (!confirm(`Assign '${g.title}' to ${chosen.name}? A game's course can't be changed later.`)) return;
    setError('');
    try {
      await api.put(`/admin/games/${g.id}`, { course_id: chosen.id });
      setAssignChoice((prev) => { const next = { ...prev }; delete next[g.id]; return next; });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign course');
    }
  }

  async function deleteGame(id: number) {
    if (!confirm('Delete this game and all its sessions? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/games/${id}`);
      setGames((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete game');
    }
  }

  const courseMap = Object.fromEntries(courses.map((c) => [c.id, c]));
  const noCourses = coursesLoaded && courses.length === 0;
  const courseOptions = courses.map((c) => (
    <option key={c.id} value={c.id}>{`${c.name} \u2014 ${c.semester}`}</option>
  ));

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-100">Games</h2>
        <div className="flex gap-2 items-center">
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <select
            className={selectClass}
            value={importCourseId}
            onChange={(e) => setImportCourseId(e.target.value)}
            disabled={noCourses}
            aria-label="Course for imported game"
          >
            <option value="">Import into course…</option>
            {courseOptions}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing || !importCourseId}
          >
            <Upload size={14} className="mr-1" />
            {importing ? 'Importing\u2026' : 'Import JSON'}
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)} disabled={noCourses}>
            <Plus size={16} className="mr-1" /> New Game
          </Button>
        </div>
      </div>

      {noCourses && (
        <p className="text-slate-400 mb-4 text-sm">
          Every game belongs to a course.{' '}
          <Link to="/courses" className="text-indigo-300 hover:underline">Create a course first</Link>.
        </p>
      )}

      {error && <p className="text-red-400 mb-4 text-sm">{error}</p>}

      {showForm && (
        <Card className="mb-6">
          <CardHeader><h3 className="text-lg font-semibold text-slate-100">Create Game</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Course <span className="text-slate-500">(can&apos;t be changed later)</span>
                </label>
                <select
                  className={`${selectClass} w-full`}
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  required
                >
                  <option value="">Choose a course…</option>
                  {courseOptions}
                </select>
              </div>
              <textarea
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                rows={3}
              />
              <div>
                <label className="block text-xs text-slate-400 mb-1">Max players</label>
                <Input
                  type="number"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(e.target.value)}
                  min="1"
                  max="500"
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={saving}>{saving ? 'Creating\u2026' : 'Create'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {editingGame && (
        <Card className="mb-6">
          <CardHeader><h3 className="text-lg font-semibold text-slate-100">Edit Game</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleEdit} className="space-y-3">
              <Input placeholder="Title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
              <p className="text-slate-400 text-xs">
                Course:{' '}
                {editingGame.course_id === null
                  ? 'none (assign one from the games list)'
                  : courseMap[editingGame.course_id]?.name ?? `Course ${editingGame.course_id}`}
              </p>
              <textarea
                placeholder="Description (optional)"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                rows={3}
              />
              <div>
                <label className="block text-xs text-slate-400 mb-1">Max players</label>
                <Input
                  type="number"
                  value={editMaxPlayers}
                  onChange={(e) => setEditMaxPlayers(e.target.value)}
                  min="1"
                  max="500"
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={editSaving}>{editSaving ? 'Saving\u2026' : 'Save'}</Button>
                <Button type="button" variant="ghost" onClick={() => setEditingGame(null)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-slate-400">Loading\u2026</p>
      ) : games.length === 0 ? (
        <p className="text-slate-400">No games yet.</p>
      ) : (
        <div className="space-y-3">
          {games.map((g) => (
            <Card key={g.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-semibold text-slate-100">{g.title}</p>
                {g.description && <p className="text-slate-400 text-sm mt-0.5 line-clamp-1">{g.description}</p>}
                <p className="text-slate-500 text-xs mt-0.5">Max {g.max_players} players</p>
                {g.course_id !== null ? (
                  <p className="text-xs mt-1">
                    <Link to={`/courses/${g.course_id}`} className="text-indigo-300 hover:underline">
                      {courseMap[g.course_id]?.name ?? `Course ${g.course_id}`}
                    </Link>
                  </p>
                ) : (
                  <div className="flex gap-2 items-center mt-2">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-900/50 text-amber-300">No course</span>
                    {courses.length > 0 && (
                      <>
                        <select
                          className={`${selectClass} py-1 text-xs`}
                          value={assignChoice[g.id] ?? ''}
                          onChange={(e) => setAssignChoice((prev) => ({ ...prev, [g.id]: e.target.value }))}
                          aria-label={`Course for ${g.title}`}
                        >
                          <option value="">Assign to…</option>
                          {courseOptions}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void assignCourse(g)}
                          disabled={!assignChoice[g.id]}
                        >
                          Assign
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(g)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/games/${g.id}/questions`)}
                >
                  <List size={14} className="mr-1" /> Questions
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void deleteGame(g.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
