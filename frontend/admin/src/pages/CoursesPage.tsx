import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';

interface Course {
  id: number;
  name: string;
  semester: string;
  created_at: string;
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const data = await api.get<Course[]>('/admin/courses');
      setCourses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/admin/courses', { name, semester });
      setName('');
      setSemester('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create course');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-100">Courses</h2>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus size={16} className="mr-1" /> New Course
        </Button>
      </div>

      {error && <p className="text-red-400 mb-4 text-sm">{error}</p>}

      {showForm && (
        <Card className="mb-6">
          <CardHeader><h3 className="text-lg font-semibold text-slate-100">Create Course</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex gap-3 flex-wrap">
              <Input
                placeholder="Course name (e.g. CS 537)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 min-w-48"
                required
              />
              <Input
                placeholder="Semester (e.g. Fall 2026)"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className="flex-1 min-w-48"
                required
              />
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-slate-400">No courses yet. Create one above.</p>
      ) : (
        <div className="space-y-3">
          {courses.map((c) => (
            <Card key={c.id} className="px-6 py-4">
              {/* Editing, access, games and roster live on the course page */}
              <Link
                to={`/courses/${c.id}`}
                className="font-semibold text-slate-100 hover:text-indigo-300 hover:underline"
              >
                {c.name}
              </Link>
              <p className="text-slate-400 text-sm">{c.semester}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
