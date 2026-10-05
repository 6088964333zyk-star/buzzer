import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import ThemeToggle from '../components/ThemeToggle';
import { Card, CardContent, CardHeader } from '../components/ui/card';

/** Shown by RequireAdmin when a valid token belongs to a non-admin (USER or GUEST). */
export default function NotAdminPage() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <ThemeToggle variant="floating" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-2xl font-bold text-fg">Admins only</h1>
          <p className="text-fg-subtle text-sm mt-1">
            This is the Buzzer admin console. Your account isn&apos;t an admin.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <a
            href="/host/"
            className="block w-full text-center rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Go to the host app
          </a>
          <a
            href="/player/"
            className="block w-full text-center rounded-lg border border-border-strong hover:bg-surface-raised text-fg text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Go to the player app
          </a>
          <p className="text-fg-subtle text-xs pt-2">
            If you were just made an admin, log out and log in again.
          </p>
          <Button variant="ghost" className="w-full" onClick={logout}>
            Log out
          </Button>
          <p className="text-fg-subtle text-xs">
            Logging out here also logs you out of the host and player apps.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
