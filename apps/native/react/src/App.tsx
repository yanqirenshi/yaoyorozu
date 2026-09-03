import { Route, Routes } from "react-router";
import Layout from "./Layout";
import ClaudePage from "./pages/ClaudePage";
import HubPage from "./pages/HubPage";
import SettingsPage from "./pages/SettingsPage";
import TabbedSessionsPage from "./pages/TabbedSessionsPage";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TabbedSessionsPage />} />
        <Route path="/hub" element={<HubPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/claude" element={<ClaudePage />} />
      </Route>
    </Routes>
  );
}

export default App;
