import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"
import Dashboard from "./pages/Dashboard"
import Agents from "./pages/Agents"
import AgentEditor from "./pages/AgentEditor"
import Calls from "./pages/Calls"
import Messages from "./pages/Messages"
import Contacts from "./pages/Contacts"
import Settings from "./pages/Settings"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/agents/new" element={<AgentEditor />} />
      <Route path="/agents/:id" element={<AgentEditor />} />
      <Route path="/calls" element={<Calls />} />
      <Route path="/messages" element={<Messages />} />
      <Route path="/contacts" element={<Contacts />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
