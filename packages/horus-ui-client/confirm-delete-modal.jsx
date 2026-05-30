// ConfirmDeleteModal — reusable destructive-action confirmation dialog.
// Props: { note, edgeCount, onConfirm, onCancel, isLoading, errorMsg }
(function () {
  const { useEffect } = React;

  function typeWarning(note, edgeCount) {
    if (note.type === 'project') {
      const data = window.HORUS_DATA;
      const childCount = data
        ? data.notes.filter(n => {
            const edges = data.getEdges(note.id);
            return edges.out.some(e => e.to === n.id && e.intent === 'parent_of');
          }).length
        : 0;
      if (childCount > 0) {
        return `This project has ${childCount} ${childCount === 1 ? 'story' : 'stories'}. Stories will remain but become unlinked.`;
      }
    }
    const count = edgeCount != null ? edgeCount : null;
    if (count === null) {
      return 'This note may have relationships that will become broken.';
    }
    if (count > 0) {
      return `This note is referenced by ${count} other ${count === 1 ? 'note' : 'notes'}. References will become broken.`;
    }
    return null;
  }

  function ConfirmDeleteModal({ note, edgeCount, onConfirm, onCancel, isLoading, errorMsg }) {
    // Dismiss on Escape
    useEffect(() => {
      function onKey(e) {
        if (e.key === 'Escape' && !isLoading) onCancel();
      }
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [isLoading, onCancel]);

    const warning = typeWarning(note, edgeCount);

    return (
      <div className="modal-overlay" onClick={() => { if (!isLoading) onCancel(); }}>
        <div className="modal-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="modal-title">Delete note?</div>

          <div className="modal-note-row">
            <span className={`type-dot ${note.type}`} />
            <span className="modal-note-type">{note.type}</span>
            <span className="modal-note-title">"{note.title}"</span>
          </div>

          {warning && (
            <div className="modal-warning">{warning}</div>
          )}

          {errorMsg ? (
            <div className="modal-error">{errorMsg}</div>
          ) : (
            <div className="modal-irreversible">This action cannot be undone.</div>
          )}

          <div className="modal-actions">
            <button className="modal-cancel-btn" onClick={onCancel} disabled={isLoading}>
              Cancel
            </button>
            <button
              className={`modal-delete-btn${isLoading ? ' loading' : ''}`}
              onClick={onConfirm}
              disabled={isLoading}
            >
              {isLoading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  window.ConfirmDeleteModal = ConfirmDeleteModal;
})();
