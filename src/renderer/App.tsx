import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Download from './pages/Download'
import Library from './pages/Library'
import Reader from './pages/Reader'
import Settings from './pages/Settings'
import Subscriptions from './pages/Subscriptions'

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Download />} />
        <Route path="batch" element={<Navigate to="/" replace />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="library" element={<Library />} />
        <Route path="reader/:id" element={<Reader />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
