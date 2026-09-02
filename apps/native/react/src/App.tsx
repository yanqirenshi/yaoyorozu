import { Route, Routes } from "react-router";
import Layout from "./Layout";
import ClaudePage from "./pages/ClaudePage";
import SettingsPage from "./pages/SettingsPage";
import ViewerRoute from "./pages/ViewerRoute";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ViewerRoute />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/claude" element={<ClaudePage />} />
      </Route>
    </Routes>
  );
}

export default App;
