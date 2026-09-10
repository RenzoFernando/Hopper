import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { AppFooter } from "../../src/components/layout/AppFooter";
import { AppHeader } from "../../src/components/layout/AppHeader";

function canonicalizeNode(node: Node, ignoreNavigation = false): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as Element;
  const attributes = Array.from(element.attributes)
    .filter(({ name }) => !ignoreNavigation || !["href", "src", "data-discover"].includes(name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, value }) => `${name}=${JSON.stringify(value)}`)
    .join(" ");
  const children = Array.from(element.childNodes)
    .map((child) => canonicalizeNode(child, ignoreNavigation))
    .filter(Boolean)
    .join("");
  const opening = attributes ? `<${element.localName} ${attributes}>` : `<${element.localName}>`;

  return `${opening}${children}</${element.localName}>`;
}

function legacyElement(path: string, selector: string, ignoreNavigation = false) {
  const source = readFileSync(path, "utf8");
  const document = new DOMParser().parseFromString(source, "text/html");
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No se encontró ${selector} en ${path}.`);
  return canonicalizeNode(element, ignoreNavigation);
}

describe("paridad estructural del layout", () => {
  test.each([
    ["home", "index.html"],
    ["room", "room.html"],
    ["admin", "admin.html"],
    ["simple", "recover.html"],
    ["simple", "share-target.html"]
  ] as const)("AppHeader %s conserva el DOM de %s salvo URLs migradas", (variant, path) => {
    const { container } = render(<MemoryRouter><AppHeader variant={variant} /></MemoryRouter>);
    const rendered = container.querySelector("header.site-header");

    expect(rendered).not.toBeNull();
    expect(canonicalizeNode(rendered as Element, true)).toBe(legacyElement(path, "header.site-header", true));
  });

  test.each(["index.html", "room.html", "admin.html", "recover.html", "share-target.html"])(
    "AppFooter conserva el DOM de %s",
    (path) => {
      const { container } = render(<AppFooter />);
      const rendered = container.querySelector("footer.project-footer");

      expect(rendered).not.toBeNull();
      expect(canonicalizeNode(rendered as Element)).toBe(legacyElement(path, "footer.project-footer"));
    }
  );
});
