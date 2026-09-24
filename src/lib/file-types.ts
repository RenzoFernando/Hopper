export type FileKind = "archive" | "audio" | "code" | "document" | "file" | "image" | "markdown" | "pdf" | "table" | "text" | "video";
export type FilePreviewKind = "image" | "markdown" | "pdf" | "text";

export type FileTypeInfo = {
  extension: string;
  kind: FileKind;
  label: string;
  previewKind: FilePreviewKind | null;
  copyable: boolean;
};

const TEXT_EXTENSIONS = new Set(["txt", "log", "ini", "cfg", "conf", "properties"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
const CODE_EXTENSIONS = new Set([
  "bat", "c", "cc", "cjs", "cpp", "cs", "css", "env", "go", "h", "hpp", "htm", "html", "java", "js", "jsx", "json", "mjs", "php", "ps1", "py", "rb", "rs", "sh", "sql", "ts", "tsx", "xml", "yaml", "yml"
]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv", "ods", "xls", "xlsx"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odt", "odp", "ppt", "pptx", "rtf"]);
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const SAFE_IMAGE_PREVIEW_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "weba"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "webm"]);

const LABELS: Record<string, string> = {
  "7z": "7Z",
  csv: "CSV",
  env: "Variables de entorno",
  json: "JSON",
  log: "Registro",
  md: "Markdown",
  markdown: "Markdown",
  pdf: "PDF",
  sql: "SQL",
  tsv: "TSV",
  txt: "Texto plano",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zip: "ZIP"
};

export function fileExtension(name: string) {
  const normalized = String(name || "").trim();
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const basename = normalized.slice(lastSeparator + 1);

  if (!basename || basename.startsWith(".") && basename.indexOf(".", 1) === -1) {
    return basename.startsWith(".") ? basename.slice(1).toLowerCase() : "";
  }

  const dot = basename.lastIndexOf(".");
  if (dot <= 0 || dot === basename.length - 1) return "";
  return basename.slice(dot + 1).toLowerCase();
}

function labelFromExtension(extension: string) {
  if (!extension) return "Archivo";
  return LABELS[extension] || extension.toUpperCase();
}

function isTextMime(mimeType: string) {
  const mime = mimeType.toLowerCase();
  return mime.startsWith("text/") || [
    "application/json",
    "application/ld+json",
    "application/sql",
    "application/xml",
    "application/x-httpd-php",
    "application/x-sh",
    "application/x-yaml"
  ].includes(mime) || mime.endsWith("+json") || mime.endsWith("+xml");
}

export function fileTypeInfo(name: string, mimeType: string): FileTypeInfo {
  const extension = fileExtension(name);
  const mime = String(mimeType || "").toLowerCase().split(";")[0]?.trim() || "";

  if (extension === "pdf" || mime === "application/pdf") {
    return { extension, kind: "pdf", label: "PDF", previewKind: "pdf", copyable: false };
  }

  if (MARKDOWN_EXTENSIONS.has(extension) || mime === "text/markdown") {
    return { extension, kind: "markdown", label: "Markdown", previewKind: "markdown", copyable: true };
  }

  if (SAFE_IMAGE_PREVIEW_EXTENSIONS.has(extension) || ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"].includes(mime)) {
    return { extension, kind: "image", label: labelFromExtension(extension) === "Archivo" ? "Imagen" : labelFromExtension(extension), previewKind: "image", copyable: false };
  }

  if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) {
    return { extension, kind: "image", label: labelFromExtension(extension) === "Archivo" ? "Imagen" : labelFromExtension(extension), previewKind: null, copyable: false };
  }

  if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith("audio/")) {
    return { extension, kind: "audio", label: labelFromExtension(extension) === "Archivo" ? "Audio" : labelFromExtension(extension), previewKind: null, copyable: false };
  }

  if (VIDEO_EXTENSIONS.has(extension) || mime.startsWith("video/")) {
    return { extension, kind: "video", label: labelFromExtension(extension) === "Archivo" ? "Video" : labelFromExtension(extension), previewKind: null, copyable: false };
  }

  if (ARCHIVE_EXTENSIONS.has(extension) || ["application/zip", "application/x-7z-compressed", "application/x-rar-compressed", "application/gzip", "application/x-tar"].includes(mime)) {
    return { extension, kind: "archive", label: labelFromExtension(extension) === "Archivo" ? "Comprimido" : labelFromExtension(extension), previewKind: null, copyable: false };
  }

  if (TABLE_EXTENSIONS.has(extension)) {
    const plainTable = extension === "csv" || extension === "tsv";
    return { extension, kind: "table", label: labelFromExtension(extension), previewKind: plainTable ? "text" : null, copyable: plainTable };
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return { extension, kind: "code", label: labelFromExtension(extension), previewKind: "text", copyable: true };
  }

  if (TEXT_EXTENSIONS.has(extension) || isTextMime(mime)) {
    return { extension, kind: "text", label: labelFromExtension(extension) === "Archivo" ? "Texto" : labelFromExtension(extension), previewKind: "text", copyable: true };
  }

  if (DOCUMENT_EXTENSIONS.has(extension) || mime.includes("officedocument") || mime.includes("opendocument")) {
    return { extension, kind: "document", label: labelFromExtension(extension) === "Archivo" ? "Documento" : labelFromExtension(extension), previewKind: null, copyable: false };
  }

  const category = mime.split("/")[0] || "";
  return {
    extension,
    kind: "file",
    label: extension ? labelFromExtension(extension) : category && category !== "application" ? category.toUpperCase() : "Archivo",
    previewKind: null,
    copyable: false
  };
}
