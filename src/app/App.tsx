import { BrowserRouter } from "react-router-dom";
import { PwaProvider } from "../hooks/usePwa";
import { AppRouter } from "./router";

export function App() {
  return (
    <BrowserRouter>
      <PwaProvider>
        <AppRouter />
      </PwaProvider>
    </BrowserRouter>
  );
}
