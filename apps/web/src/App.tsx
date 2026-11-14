import { Route, Routes } from "react-router-dom";
import { Landing } from "./routes/Landing";
import { NotFound } from "./routes/NotFound";
import { SpaceRoute } from "./routes/SpaceRoute";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/s/:spaceId" element={<SpaceRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
