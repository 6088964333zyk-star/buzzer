import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
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
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-2xl font-bold text-slate-100">Admins only</h1>
          <p className="text-slate-400 text-sm mt-1">
            This is the Buzzer admin console. Your account isn&apos;t an admin.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <a
            href="/host/"
            className="block w-full text-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Go to the host app
          </a>
          <a
            href="/player/"
            className="block w-full text-center rounded-lg border border-slate-600 hover:bg-slate-700 text-slate-200 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Go to the player app
          </a>
          <p className="text-slate-400 text-xs pt-2">
            If you were just made an admin, log out and log in again.
          </p>
          <Button variant="ghost" className="w-full" onClick={logout}>
            Log out
          </Button>
          <p className="text-slate-500 text-xs">
            Logging out here also logs you out of the host and player apps.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
