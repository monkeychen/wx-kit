import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import UrlDownload from './pages/UrlDownload'
import Library from './pages/Library'
import Reader from './pages/Reader'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<UrlDownload />} />
        <Route path="library" element={<Library />} />
        <Route path="reader/:id" element={<Reader />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
