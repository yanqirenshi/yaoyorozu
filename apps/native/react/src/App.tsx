import { Route, Routes } from "react-router";
import Layout from "./Layout";
import ClaudePage from "./pages/ClaudePage";
import HubPage from "./pages/HubPage";
import SettingsPage from "./pages/SettingsPage";
import ViewerPage from "./pages/ViewerPage";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HubPage />} />
        <Route path="/profiles/:profileId?" element={<ViewerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/claude" element={<ClaudePage />} />
      </Route>
    </Routes>
  );
}

export default App;
