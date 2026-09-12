export function AppFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="project-footer">
      <p>
        <a href="https://github.com/RenzoFernando/Hopper" target="_blank" rel="noopener noreferrer">
          <strong>Hopper</strong>
        </a>
        <span> — Transferencia temporal de texto y archivos</span>
      </p>
      <p>© {currentYear} — Renzo Fernando Mosquera Daza</p>
    </footer>
  );
}
