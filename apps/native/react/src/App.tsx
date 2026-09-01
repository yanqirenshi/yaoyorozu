import { Route, Routes } from "react-router";
import Layout from "./Layout";
import ClaudePage from "./pages/ClaudePage";
import SessionsPage from "./pages/SessionsPage";
import SettingsPage from "./pages/SettingsPage";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<SessionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/claude" element={<ClaudePage />} />
      </Route>
    </Routes>
  );
}

export default App;
