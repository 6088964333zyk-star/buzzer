import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface Course { id: number; name: string; semester: string }

/** Header shared by the course-management pages: course name + section tabs. */
export default function ManageNav({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);

  useEffect(() => {
    api.get<Course[]>('/game/my-courses')
      .then((cs) => setCourse(cs.find((c) => String(c.id) === courseId) ?? null))
      .catch(() => setCourse(null));
  }, [courseId]);

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'px-3 py-1.5 rounded-lg text-sm',
      isActive ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface',
    );

  return (
    <div className="space-y-3">
      <button
        onClick={() => navigate('/home')}
        className="flex items-center gap-2 text-fg-subtle hover:text-fg text-sm"
      >
        <ArrowLeft size={14} /> Back to Home
      </button>
      <h1 className="text-2xl font-bold text-fg">
        {course ? `${course.name} — ${course.semester}` : 'Manage course'}
      </h1>
      <nav className="flex gap-2">
        <NavLink to={`/manage/${courseId}/games`} className={tab}>Games</NavLink>
        <NavLink to={`/manage/${courseId}/roster`} className={tab}>Roster</NavLink>
        <NavLink to={`/manage/${courseId}/sessions`} className={tab}>Sessions</NavLink>
      </nav>
    </div>
  );
}
