import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppFooter } from "../../src/components/layout/AppFooter";
import { AppHeader } from "../../src/components/layout/AppHeader";

function canonicalizeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const attributes = Array.from(element.attributes)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, value }) => `${name}=${JSON.stringify(value)}`)
    .join(" ");
  const children = Array.from(element.childNodes)
    .map(canonicalizeNode)
    .filter(Boolean)
    .join("");
  const opening = attributes ? `<${element.localName} ${attributes}>` : `<${element.localName}>`;

  return `${opening}${children}</${element.localName}>`;
}

function legacyElement(path: string, selector: string) {
  const source = readFileSync(path, "utf8");
  const document = new DOMParser().parseFromString(source, "text/html");
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`No se encontró ${selector} en ${path}.`);
  }

  return canonicalizeNode(element);
}

describe("paridad estructural del layout", () => {
  test.each([
    ["home", "index.html"],
    ["room", "room.html"],
    ["admin", "admin.html"],
    ["simple", "recover.html"],
    ["simple", "share-target.html"]
  ] as const)("AppHeader %s conserva el DOM de %s", (variant, path) => {
    const { container } = render(<AppHeader variant={variant} />);
    const rendered = container.querySelector("header.site-header");

    expect(rendered).not.toBeNull();
    expect(canonicalizeNode(rendered as Element)).toBe(legacyElement(path, "header.site-header"));
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
