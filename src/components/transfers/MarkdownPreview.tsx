import type { ReactNode } from "react";

function inlineMarkdown(source: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      nodes.push(link ? <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : token);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    cursor = match.index + token.length;
    index += 1;
  }

  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

export function MarkdownPreview({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^\s`]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre className="markdown-code" key={`code-${index}`}><code data-language={fence[1] || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const content = inlineMarkdown(heading[2] ?? "", `heading-${index}`);
      if (level === 1) blocks.push(<h1 key={`h-${index}`}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${index}`}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`h-${index}`}>{content}</h3>);
      else if (level === 4) blocks.push(<h4 key={`h-${index}`}>{content}</h4>);
      else if (level === 5) blocks.push(<h5 key={`h-${index}`}>{content}</h5>);
      else blocks.push(<h6 key={`h-${index}`}>{content}</h6>);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((value, quoteIndex) => <p key={`quote-line-${quoteIndex}`}>{inlineMarkdown(value, `quote-${index}-${quoteIndex}`)}</p>)}</blockquote>);
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").match(/^\s*[-+*]\s+(.+)$/);
        if (!current) break;
        items.push(current[1] ?? "");
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items.map((value, itemIndex) => <li key={`ul-${itemIndex}`}>{inlineMarkdown(value, `ul-${index}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").match(/^\s*\d+[.)]\s+(.+)$/);
        if (!current) break;
        items.push(current[1] ?? "");
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((value, itemIndex) => <li key={`ol-${itemIndex}`}>{inlineMarkdown(value, `ol-${index}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim() || /^```/.test(current) || /^(#{1,6})\s+/.test(current) || /^>\s?/.test(current) || /^\s*[-+*]\s+/.test(current) || /^\s*\d+[.)]\s+/.test(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return <article className="markdown-preview">{blocks}</article>;
}
