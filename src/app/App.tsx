import { AdminPage } from "../pages/AdminPage";
import { HomePage } from "../pages/HomePage";
import { RecoverPage } from "../pages/RecoverPage";
import { RoomPage } from "../pages/RoomPage";

type HopperPage = "home" | "room" | "admin" | "recover";

function currentPage(): HopperPage {
  const value = document.body.dataset.hopperPage;
  if (value === "room" || value === "admin" || value === "recover") return value;
  return "home";
}

export function App() {
  const page = currentPage();
  if (page === "room") return <RoomPage />;
  if (page === "admin") return <AdminPage />;
  if (page === "recover") return <RecoverPage />;
  return <HomePage />;
}
