import { BrowserRouter } from "react-router-dom";
import { PwaProvider } from "../hooks/usePwa";
import { ExclusiveGate } from "../components/layout/ExclusiveGate";
import { AppRouter } from "./router";

export function App() {
  return (
    <BrowserRouter>
      <PwaProvider>
        <AppRouter /><ExclusiveGate />
      </PwaProvider>
    </BrowserRouter>
  );
}
