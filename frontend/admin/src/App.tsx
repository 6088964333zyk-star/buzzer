import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate, NavLink } from 'react-router-dom';
import { BookOpen, Users, Gamepad2, UserX, LogOut, History, ExternalLink } from 'lucide-react';
import { getTokenClaims } from './lib/auth';
import ThemeToggle from './components/ThemeToggle';
import LoginPage from './pages/LoginPage';
import CoursesPage from './pages/CoursesPage';
import CourseDetailPage from './pages/CourseDetailPage';
import NotAdminPage from './pages/NotAdminPage';
import RosterPage from './pages/RosterPage';
import UsersPage from './pages/UsersPage';
import UserDetailPage from './pages/UserDetailPage';
import GuestsPage from './pages/GuestsPage';
import GamesPage from './pages/GamesPage';
import QuestionEditorPage from './pages/QuestionEditorPage';
import SessionsPage from './pages/SessionsPage';

/** UX guard only: the backend's require_admin is the real check (docs/design-t4-admin.md A7). */
function RequireAdmin() {
  const claims = getTokenClaims();
  if (!claims || claims.exp * 1000 <= Date.now()) return <Navigate to="/login" replace />;
  if (claims.role !== 'ADMIN') return <NotAdminPage />;
  return <Outlet />;
}

function AdminLayout() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-accent text-on-accent'
        : 'text-fg-muted hover:bg-surface-raised hover:text-fg'
    }`;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-bg border-r border-border flex flex-col">
        <div className="px-6 py-5 border-b border-border">
          <h1 className="text-lg font-bold text-fg">Buzzer Admin</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {/* Admin tasks first; host/player actions are secondary (T4 admin-first layout) */}
          <p className="text-xs uppercase tracking-wide text-fg-subtle px-4 pt-1 pb-1">Administration</p>
          <NavLink to="/courses" className={linkClass}>
            <BookOpen size={16} /> Courses
          </NavLink>
          <NavLink to="/users" className={linkClass}>
            <Users size={16} /> Users
          </NavLink>
          <NavLink to="/guests" className={linkClass}>
            <UserX size={16} /> Guests
          </NavLink>

          <div className="border-t border-border !mt-4" />
          <p className="text-xs uppercase tracking-wide text-fg-subtle px-4 pt-4 pb-1">Host &amp; play</p>
          <NavLink to="/games" className={linkClass}>
            <Gamepad2 size={16} /> Games
          </NavLink>
          <NavLink to="/sessions" className={linkClass}>
            <History size={16} /> Sessions
          </NavLink>
          <a href="/host/" target="_blank" rel="noopener" className={linkClass({ isActive: false })}>
            <ExternalLink size={16} /> Open host app
          </a>
          <a href="/player/" target="_blank" rel="noopener" className={linkClass({ isActive: false })}>
            <ExternalLink size={16} /> Open player app
          </a>
        </nav>
        <div className="p-3 border-t border-border space-y-1">
          <ThemeToggle variant="sidebar" />
          <button
            onClick={logout}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-fg-muted hover:bg-surface-raised hover:text-fg w-full transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAdmin />}>
          <Route element={<AdminLayout />}>
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/courses/:courseId" element={<CourseDetailPage />} />
            <Route path="/courses/:courseId/roster" element={<RosterPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:userId" element={<UserDetailPage />} />
            <Route path="/guests" element={<GuestsPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/games/:gameId/questions" element={<QuestionEditorPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
