// ModeToggle — header mode switch between Editor and Agent
(function () {
  function ModeToggle({ route, onNavigate }) {
    const isAgent = route?.kind === 'ask';

    function switchToAgent() {
      const editorPath = !route || route.kind === 'home' ? '/'
        : route.kind === 'note' ? `/n/${route.id}`
        : route.kind === 'tag' ? `/t/${route.tag}`
        : route.kind === 'type' ? `/type/${route.type}`
        : '/';
      window.ChatSessionStore?.setLastEditorPath(editorPath);
      onNavigate({ kind: 'ask' });
    }

    function switchToEditor() {
      const lastPath = window.ChatSessionStore?.getLastEditorPath() || '/';
      if (lastPath === '/') return onNavigate({ kind: 'home' });
      const noteM = lastPath.match(/^\/n\/(.+)$/);
      if (noteM) return onNavigate({ kind: 'note', id: noteM[1] });
      const tagM = lastPath.match(/^\/t\/(.+)$/);
      if (tagM) return onNavigate({ kind: 'tag', tag: tagM[1] });
      const typeM = lastPath.match(/^\/type\/(.+)$/);
      if (typeM) return onNavigate({ kind: 'type', type: typeM[1] });
      onNavigate({ kind: 'home' });
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
