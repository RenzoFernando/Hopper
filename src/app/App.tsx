import { AppFooter } from "../components/layout/AppFooter";
import { AppHeader } from "../components/layout/AppHeader";
import { PhaseOnePreviewPage } from "../pages/PhaseOnePreviewPage";

export function App() {
  return (
    <>
      <div className="document-shell">
        <AppHeader variant="home" />
        <PhaseOnePreviewPage />
      </div>
      <AppFooter />
    </>
  );
}
