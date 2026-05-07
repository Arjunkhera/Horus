// ModeToggle — header mode switch between Editor and Agent
(function () {
  function ModeToggle({ onNavigate }) {
    const isAgent = window.location.pathname === '/ask' ||
      (window.__currentRoute && window.__currentRoute.kind === 'ask');

    function switchToAgent() {
      window.ChatSessionStore?.setLastEditorPath(window.location.pathname);
      onNavigate({ kind: 'ask' });
    }

    function switchToEditor() {
      const lastPath = window.ChatSessionStore?.getLastEditorPath() || '/';
      onNavigate({ kind: lastPath === '/' ? 'home' : 'restore', path: lastPath });
    }

    return (
      <div className="mode-toggle">
        <button
          className={`mode-toggle-seg${!isAgent ? ' active-editor' : ''}`}
          onClick={!isAgent ? undefined : switchToEditor}
        >
          ☰ Editor
        </button>
        <button
          className={`mode-toggle-seg${isAgent ? ' active-agent' : ''}`}
          onClick={isAgent ? undefined : switchToAgent}
        >
          ✦ Agent
        </button>
      </div>
    );
  }
  window.ModeToggle = ModeToggle;
})();
