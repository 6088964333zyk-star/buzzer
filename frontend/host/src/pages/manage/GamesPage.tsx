import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import ManageNav from './ManageNav';

interface Game { id: number; title: string; description: string; max_players: number }

/** Games owned by one course. New games are always created in this course (design D1). */
export default function GamesPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<Game[]>(`/host/courses/${courseId}/games`)
      .then(setGames)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load games'))
      .finally(() => setLoading(false));
  }, [courseId]);

  async function createGame(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError('');
    try {
      const game = await api.post<Game>(`/host/courses/${courseId}/games`, { title: title.trim() });
      navigate(`/manage/${courseId}/games/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto space-y-6">
      <ManageNav courseId={courseId} />

      <form onSubmit={(e) => void createGame(e)} className="flex gap-2">
        <Input
          placeholder="New game title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={creating || !title.trim()}>
          <Plus size={14} className="mr-1" /> {creating ? 'Creating…' : 'Create game'}
        </Button>
      </form>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading && <p className="text-slate-400">Loading…</p>}
      {!loading && games.length === 0 && (
        <p className="text-slate-400">No games in this course yet.</p>
      )}

      <div className="space-y-3">
        {games.map((g) => (
          <Card key={g.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-semibold text-slate-100">{g.title}</p>
                {g.description && <p className="text-slate-400 text-sm">{g.description}</p>}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/manage/${courseId}/games/${g.id}`)}
              >
                Edit questions
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
