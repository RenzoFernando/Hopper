type AppHeaderVariant = "home" | "room" | "admin" | "simple";

type SyncVariant = "" | "busy" | "offline" | "ok";

type AppHeaderProps = {
  variant?: AppHeaderVariant;
  authenticated?: boolean;
  syncLabel?: string;
  syncVariant?: SyncVariant;
  installVisible?: boolean;
  updateVisible?: boolean;
  roomCode?: string;
  roomExpiry?: string;
  onInstall?: () => void;
  onUpdate?: () => void;
  onLogout?: () => void;
  onShareRoom?: () => void;
  onLeaveRoom?: () => void;
  onRefreshAdmin?: () => void;
  adminRefreshing?: boolean;
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 11 8-7 8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8Zm5.5 9.5v-6h5v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 7v5h-5M5 17v-5h5M7.1 8.2A6.5 6.5 0 0 1 18.4 10M16.9 15.8A6.5 6.5 0 0 1 5.6 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20H10M14 8l4 4-4 4M18 12H9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V4m0 0L8 8m4-4 4 4M5 12v6.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Brand({ homeLabel }: { homeLabel: string }) {
  return (
    <a className="brand" href="/" aria-label={homeLabel}>
      <img className="brand-mark" src="/assets/favicon.svg" alt="" />
      <span className="brand-name">HOPPER</span>
    </a>
  );
}

export function AppHeader({
  variant = "simple",
  authenticated = false,
  syncLabel = "Sincronizado",
  syncVariant = "",
  installVisible = false,
  updateVisible = false,
  roomCode,
  roomExpiry = "--:--",
  onInstall,
  onUpdate,
  onLogout,
  onShareRoom,
  onLeaveRoom,
  onRefreshAdmin,
  adminRefreshing = false
}: AppHeaderProps) {
  if (variant === "home") {
    return (
      <header className="site-header">
        <Brand homeLabel="Hopper — transferencia temporal" />
        <nav className="public-nav" id="public-nav" aria-label="Accesos de Hopper" hidden={authenticated}>
          <button className="header-link header-button" id="install-button" type="button" hidden={!installVisible} onClick={onInstall}>Instalar</button>
          <button className="icon-button info-icon-button" id="update-button" type="button" aria-label="Actualizar Hopper" title="Actualizar" hidden={!updateVisible} onClick={onUpdate}><RefreshIcon /></button>
        </nav>
        <div className="header-session" id="header-session" hidden={!authenticated}>
          <span className={`sync-state ${syncVariant ? `is-${syncVariant}` : ""}`.trim()} id="sync-state" aria-live="polite">{syncLabel}</span>
          <a className="header-link" href="/admin">Administración</a>
          <button className="header-link header-button" id="install-button-session" type="button" hidden={!installVisible} onClick={onInstall}>Instalar</button>
          <button className="icon-button info-icon-button" id="update-button-session" type="button" aria-label="Actualizar Hopper" title="Actualizar" hidden={!updateVisible} onClick={onUpdate}><RefreshIcon /></button>
          <button className="icon-button logout-button" id="logout-button" type="button" aria-label="Salir" title="Salir" onClick={onLogout}><LogoutIcon /></button>
        </div>
      </header>
    );
  }

  if (variant === "room") {
    return (
      <header className="site-header">
        <Brand homeLabel="Volver a Hopper" />
        <div className="header-session" id="header-session" hidden={!authenticated}>
          <span className="room-header-code" id="room-name">{roomCode || "SALA"}</span>
          <span className="room-expiry" id="room-expiry" aria-label="Tiempo restante">{roomExpiry}</span>
          <button className="icon-button info-icon-button" id="share-room-button" type="button" aria-label="Compartir sala" title="Compartir sala" hidden={roomCode === ""} onClick={onShareRoom}><ShareIcon /></button>
          <button className="icon-button logout-button" id="leave-room-button" type="button" aria-label="Salir de la sala" title="Salir de la sala" onClick={onLeaveRoom}><LogoutIcon /></button>
        </div>
      </header>
    );
  }

  if (variant === "admin") {
    return (
      <header className="site-header">
        <Brand homeLabel="Volver a Hopper" />
        <div className="header-session">
          <a className="icon-button info-icon-button" href="/space" aria-label="Mi espacio" title="Mi espacio"><HomeIcon /></a>
          <button className={`icon-button refresh-button${adminRefreshing ? " is-spinning" : ""}`} id="admin-refresh-button" type="button" aria-label="Actualizar panel" title="Actualizar" disabled={adminRefreshing} onClick={onRefreshAdmin}><RefreshIcon /></button>
          <button className="icon-button logout-button" id="admin-logout-button" type="button" aria-label="Salir" title="Salir" onClick={onLogout}><LogoutIcon /></button>
        </div>
      </header>
    );
  }

  return <header className="site-header"><Brand homeLabel="Volver a Hopper" /></header>;
}
