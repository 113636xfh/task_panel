import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Boards from './pages/Boards';
import BoardDetail from './pages/BoardDetail';
import TaskDetail from './pages/TaskDetail';
import Skills from './pages/Skills';
import Settings from './pages/Settings';
import History from './pages/History';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/boards" replace />} />
          <Route path="/boards" element={<Boards />} />
          <Route path="/boards/:id" element={<BoardDetail />} />
          <Route path="/boards/:id/tasks/:taskId" element={<TaskDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
