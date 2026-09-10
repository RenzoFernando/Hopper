import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppFooter } from "../../src/components/layout/AppFooter";
import { AppHeader } from "../../src/components/layout/AppHeader";

describe("layout congelado", () => {
  test("AppHeader conserva el DOM y las clases de la portada actual", () => {
    const { container } = render(<AppHeader variant="home" />);
    const header = container.querySelector("header.site-header");

    expect(header).toBeInTheDocument();
    expect(container.querySelector("a.brand[href='./']")).toHaveAttribute(
      "aria-label",
      "Hopper — transferencia temporal"
    );
    expect(container.querySelector("img.brand-mark")).toHaveAttribute("src", "assets/favicon.svg");
    expect(container.querySelector("#public-nav.public-nav")).toBeInTheDocument();
    expect(container.querySelector("#header-session.header-session")).toHaveAttribute("hidden");
    expect(container.querySelector("#logout-button.icon-button.logout-button")).toBeInTheDocument();
  });

  test("AppHeader conserva las variantes actuales de sala, administración y documento", () => {
    const { container, rerender } = render(<AppHeader variant="room" />);
    expect(container.querySelector("#room-name.room-header-code")).toHaveTextContent("SALA");
    expect(container.querySelector("#share-room-button.info-icon-button")).toBeInTheDocument();

    rerender(<AppHeader variant="admin" />);
    expect(screen.getByRole("link", { name: "Mi espacio" })).toHaveAttribute("href", "./");
    expect(container.querySelector("#admin-refresh-button.refresh-button")).toBeInTheDocument();

    rerender(<AppHeader variant="simple" />);
    expect(container.querySelectorAll("header.site-header > *")).toHaveLength(1);
  });

  test("AppFooter conserva exactamente el contenido común actual", () => {
    const { container } = render(<AppFooter />);
    const footer = container.querySelector("footer.project-footer");

    expect(footer).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hopper" })).toHaveAttribute(
      "href",
      "https://github.com/RenzoFernando/Hopper"
    );
    expect(footer).toHaveTextContent("— Transferencia temporal de texto y archivos");
    expect(footer).toHaveTextContent("© 2026 — Renzo Fernando Mosquera Daza");
  });
});
