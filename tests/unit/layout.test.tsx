import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { AppFooter } from "../../src/components/layout/AppFooter";
import { AppHeader } from "../../src/components/layout/AppHeader";

function header(variant: "home" | "room" | "admin" | "simple") {
  return <MemoryRouter><AppHeader variant={variant} /></MemoryRouter>;
}

describe("layout congelado", () => {
  test("AppHeader conserva el DOM y las clases de la portada actual con navegación limpia", () => {
    const { container } = render(header("home"));
    const element = container.querySelector("header.site-header");

    expect(element).toBeInTheDocument();
    expect(container.querySelector("a.brand[href='/']")).toHaveAttribute("aria-label", "Hopper — transferencia temporal");
    expect(container.querySelector("img.brand-mark")).toHaveAttribute("src", "/assets/favicon.svg");
    expect(container.querySelector("#public-nav.public-nav")).toBeInTheDocument();
    expect(container.querySelector("#header-session.header-session")).toHaveAttribute("hidden");
    expect(container.querySelector("#logout-button.icon-button.logout-button")).toBeInTheDocument();
  });

  test("AppHeader conserva las variantes actuales y usa rutas semánticas", () => {
    const { container, rerender } = render(header("room"));
    expect(container.querySelector("#room-name.room-header-code")).toHaveTextContent("SALA");
    expect(container.querySelector("#share-room-button.info-icon-button")).toBeInTheDocument();

    rerender(header("admin"));
    expect(screen.getByRole("link", { name: "Mi espacio" })).toHaveAttribute("href", "/space");
    expect(container.querySelector("#admin-refresh-button.refresh-button")).toBeInTheDocument();
    expect(container.querySelector("#admin-logout-button.logout-button")).toBeInTheDocument();

    rerender(header("simple"));
    expect(container.querySelectorAll("header.site-header > *")).toHaveLength(1);
  });

  test("AppFooter conserva exactamente el contenido común actual", () => {
    const { container } = render(<AppFooter />);
    const footer = container.querySelector("footer.project-footer");

    expect(footer).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hopper" })).toHaveAttribute("href", "https://github.com/RenzoFernando/Hopper");
    expect(footer).toHaveTextContent("— Transferencia temporal de texto y archivos");
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} — Renzo Fernando Mosquera Daza`);
  });
});
