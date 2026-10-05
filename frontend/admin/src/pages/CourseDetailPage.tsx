import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';

interface Course { id: number; name: string; semester: string }
interface AccessEntry {
  user_id: string;
  username: string | null;
  netid: string | null;
  display_name: string | null;
  user_role: string;
  course_role: 'HOST' | 'PLAYER';
}
interface User {
  id: string;
  username: string | null;
  netid: string | null;
  display_name: string | null;
  role: string;
}
interface Game { id: number; title: string; course_id: number | null }
interface RosterEntry { id: number; is_active: boolean }

const selectClass = 'rounded-lg border border-border-strong bg-surface px-3 py-2 text-fg text-sm';

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function userLabel(u: { display_name: string | null; username: string | null; netid: string | null }): string {
  const label = u.display_name ?? u.username ?? u.netid ?? '(unnamed)';
  return u.netid && u.netid !== label ? `${label} (${u.netid})` : label;
}

/**
 * The admin's access hub for one course: details, who has HOST/PLAYER access, which games
 * belong to it (game access is course-based), and the roster. docs/design-t4-admin.md A2/A4.
 */
export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [courseError, setCourseError] = useState('');
  // null = failed to load: don't show counts or an add form built on missing data
  const [access, setAccess] = useState<AccessEntry[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSemester, setEditSemester] = useState('');

  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<'HOST' | 'PLAYER'>('PLAYER');
  const [assignGameId, setAssignGameId] = useState('');

  async function load() {
    const [c, a, u, g, r] = await Promise.allSettled([
      api.get<Course>(`/admin/courses/${courseId}`),
      api.get<AccessEntry[]>(`/admin/courses/${courseId}/access`),
      api.get<User[]>('/admin/users'),
      api.get<Game[]>('/admin/games'),
      api.get<RosterEntry[]>(`/admin/courses/${courseId}/roster`),
    ]);
    // Without the course there's nothing to show; ignore the other results.
    if (c.status === 'rejected') {
      setCourseError(errorText(c.reason, 'Failed to load course'));
      return;
    }
    setCourseError('');
    setCourse(c.value);
    const failures: string[] = [];
    if (a.status === 'fulfilled') setAccess(a.value);
    else { setAccess(null); failures.push(errorText(a.reason, 'Failed to load access')); }
    if (u.status === 'fulfilled') setUsers(u.value);
    else { setUsers([]); failures.push(errorText(u.reason, 'Failed to load users')); }
    if (g.status === 'fulfilled') setGames(g.value);
    else { setGames([]); failures.push(errorText(g.reason, 'Failed to load games')); }
    if (r.status === 'fulfilled') setRoster(r.value);
    else { setRoster(null); failures.push(errorText(r.reason, 'Failed to load roster')); }
    setError(failures.join('; '));
  }

  useEffect(() => { void load(); }, [courseId]);

  /** Run a mutation, then reload; errors go to the page banner. */
  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (courseError) {
    return (
      <div className="p-8 max-w-3xl space-y-4">
        <BackLink />
        <p className="text-danger-fg text-sm">{courseError}</p>
      </div>
    );
  }
  if (!course) return <div className="p-8 text-fg-subtle">Loading…</div>;

  const id = course.id;

  function startEdit() {
    setEditName(course!.name);
    setEditSemester(course!.semester);
    setEditing(true);
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.put(`/admin/courses/${id}`, { name: editName, semester: editSemester });
      setEditing(false);
    }, 'Failed to update course');
  }

  function grant(userId: string, role: 'HOST' | 'PLAYER') {
    void run(
      () => api.post(`/admin/users/${userId}/course-access`, { course_id: id, role }),
      'Failed to grant access',
    );
  }

  function addPerson() {
    if (!addUserId) return;
    void run(async () => {
      await api.post(`/admin/users/${addUserId}/course-access`, { course_id: id, role: addRole });
      setAddUserId('');
      setAddRole('PLAYER');
    }, 'Failed to grant access');
  }

  function revoke(entry: AccessEntry) {
    if (!confirm(`Remove ${userLabel(entry)}'s access to ${course!.name}?`)) return;
    void run(
      () => api.delete(`/admin/users/${entry.user_id}/course-access/${id}`),
      'Failed to revoke access',
    );
  }

  function assignGame(game: Game) {
    if (!confirm(`Assign '${game.title}' to ${course!.name}? A game's course can't be changed later.`)) return;
    void run(async () => {
      await api.put(`/admin/games/${game.id}`, { course_id: id });
      setAssignGameId('');
    }, 'Failed to assign course');
  }

  // Admins already have full access, so they're shown but not counted or re-roled.
  const counted = (access ?? []).filter((e) => e.user_role !== 'ADMIN');
  const hostCount = counted.filter((e) => e.course_role === 'HOST').length;
  const playerCount = counted.filter((e) => e.course_role === 'PLAYER').length;
  const activeRoster = roster?.filter((r) => r.is_active).length ?? 0;

  const listed = new Set((access ?? []).map((e) => e.user_id));
  const addable = users.filter((u) => u.role === 'USER' && !listed.has(u.id));

  const courseGames = games.filter((g) => g.course_id === id);
  const unassignedGames = games.filter((g) => g.course_id === null);
  const gameToAssign = unassignedGames.find((g) => String(g.id) === assignGameId);

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <BackLink />

      {/* Course details */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-fg">{course.name}</h2>
              <p className="text-fg-subtle text-sm mt-0.5">{course.semester}</p>
            </div>
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil size={14} className="mr-1" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        {editing && (
          <CardContent>
            <form onSubmit={saveEdit} className="flex gap-3 flex-wrap">
              <Input
                placeholder="Course name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 min-w-48"
                required
              />
              <Input
                placeholder="Semester"
                value={editSemester}
                onChange={(e) => setEditSemester(e.target.value)}
                className="flex-1 min-w-48"
                required
              />
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </form>
          </CardContent>
        )}
      </Card>

      {error && <p className="text-danger-fg text-sm">{error}</p>}

      {/* People with access */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-fg">People with access</h3>
          <p className="text-fg-subtle text-xs mt-1">
            Hosts can run and edit this course&apos;s games, manage its roster, and download its session
            results. Players can join this course&apos;s games.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {access === null && <p className="text-fg-subtle text-sm">Couldn&apos;t load who has access.</p>}
          {access?.length === 0 && <p className="text-fg-subtle text-sm">No one has been granted access yet.</p>}
          {access?.map((entry) => (
            <div key={entry.user_id} className="flex items-center justify-between gap-3">
              <Link to={`/users/${entry.user_id}`} className="text-fg text-sm hover:underline flex-1">
                {userLabel(entry)}
                {entry.username && <span className="ml-2 text-xs text-fg-subtle">@{entry.username}</span>}
              </Link>
              {entry.user_role === 'ADMIN' ? (
                <span className="px-2 py-0.5 rounded-full text-xs bg-surface-raised text-fg-muted">Admin</span>
              ) : (
                <select
                  className={selectClass}
                  value={entry.course_role}
                  disabled={busy}
                  onChange={(e) => grant(entry.user_id, e.target.value as 'HOST' | 'PLAYER')}
                  aria-label={`Course role for ${userLabel(entry)}`}
                >
                  <option value="HOST">HOST</option>
                  <option value="PLAYER">PLAYER</option>
                </select>
              )}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => revoke(entry)} aria-label="Revoke access">
                <Trash2 size={12} />
              </Button>
            </div>
          ))}

          <div className="pt-3 border-t border-border space-y-2">
            {access === null ? null : addable.length === 0 ? (
              <p className="text-fg-subtle text-sm">No other users to add.</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <select
                  className={`${selectClass} flex-1 min-w-48`}
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  aria-label="User to add"
                >
                  <option value="">Add a user…</option>
                  {addable.map((u) => (
                    <option key={u.id} value={u.id}>{userLabel(u)}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as 'HOST' | 'PLAYER')}
                  aria-label="Role"
                >
                  <option value="PLAYER">PLAYER</option>
                  <option value="HOST">HOST</option>
                </select>
                <Button size="sm" onClick={addPerson} disabled={!addUserId || busy}>Add</Button>
              </div>
            )}
            <p className="text-fg-subtle text-xs">
              NetID users appear here after their first sign-in. Students on the roster can already join
              without being added.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Game access: course-based (docs/design-t4-admin.md A4) */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-fg">Game access</h3>
          <p className="text-fg-subtle text-xs mt-1">
            A game belongs to one course, set once. Access to a game comes from access to its course.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {access === null || roster === null ? (
            <p className="text-fg-subtle text-sm">Counts unavailable: access or roster failed to load.</p>
          ) : (
          <div className="text-sm text-fg-muted space-y-1">
            <p><span className="font-semibold text-fg">Run and edit:</span> {hostCount} host{hostCount === 1 ? '' : 's'}.</p>
            <p>
              <span className="font-semibold text-fg">Play:</span> {playerCount} user{playerCount === 1 ? '' : 's'} granted
              access, {activeRoster} student{activeRoster === 1 ? '' : 's'} on the active roster (these can overlap);
              hosts can play too.
            </p>
          </div>
          )}

          {courseGames.length === 0 ? (
            <p className="text-fg-subtle text-sm">No games in this course yet.</p>
          ) : (
            <ul className="space-y-1">
              {courseGames.map((g) => (
                <li key={g.id}>
                  <Link to={`/games/${g.id}/questions`} className="text-fg text-sm hover:underline">
                    {g.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {unassignedGames.length > 0 && (
            <div className="pt-3 border-t border-border flex gap-2 flex-wrap items-center">
              <select
                className={`${selectClass} flex-1 min-w-48`}
                value={assignGameId}
                onChange={(e) => setAssignGameId(e.target.value)}
                aria-label="Game without a course"
              >
                <option value="">Assign a game with no course…</option>
                {unassignedGames.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => gameToAssign && assignGame(gameToAssign)}
                disabled={!gameToAssign || busy}
              >
                Assign
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Roster */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-fg">Roster</h3>
              <p className="text-fg-subtle text-sm mt-0.5">
                {roster === null ? "Couldn't load the roster." : `${activeRoster} active / ${roster.length} total roster entries`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate(`/courses/${id}/roster`)}>
              <Users size={14} className="mr-1" /> Manage roster
            </Button>
          </div>
          <p className="text-fg-subtle text-xs mt-2">
            Students on the active roster can sign in with NetID and join this course&apos;s games.
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/courses" className="flex items-center gap-2 text-fg-subtle hover:text-fg text-sm">
      <ArrowLeft size={14} /> Courses
    </Link>
  );
}
