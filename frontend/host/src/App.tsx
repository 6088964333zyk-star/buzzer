import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import GameLayout from './pages/game/GameLayout';
import LobbyPage from './pages/game/LobbyPage';
import QuestionPage from './pages/game/QuestionPage';
import ResultsPage from './pages/game/ResultsPage';
import GameOverPage from './pages/game/GameOverPage';
import GamesPage from './pages/manage/GamesPage';
import QuestionEditorPage from './pages/manage/QuestionEditorPage';
import RosterPage from './pages/manage/RosterPage';
import SessionsPage from './pages/manage/SessionsPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/home" element={<RequireAuth><HomePage /></RequireAuth>} />
        <Route path="/manage/:courseId" element={<Navigate to="games" replace />} />
        <Route path="/manage/:courseId/games" element={<RequireAuth><GamesPage /></RequireAuth>} />
        <Route path="/manage/:courseId/games/:gameId" element={<RequireAuth><QuestionEditorPage /></RequireAuth>} />
        <Route path="/manage/:courseId/roster" element={<RequireAuth><RosterPage /></RequireAuth>} />
        <Route path="/manage/:courseId/sessions" element={<RequireAuth><SessionsPage /></RequireAuth>} />
        <Route path="/game/:code" element={<RequireAuth><GameLayout /></RequireAuth>}>
          <Route path="lobby" element={<LobbyPage />} />
          <Route path="question" element={<QuestionPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="gameover" element={<GameOverPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
