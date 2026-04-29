// Inline SVG icon set — clean, consistent, sized via CSS
window.Icon = {
  Chevron: () => (
    <svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg>
  ),
  Sidebar: () => (
    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>
  ),
  PanelRight: () => (
    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
  ),
  ArrowLeft: () => (
    <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
  ),
  ArrowRight: () => (
    <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
  ),
  Search: () => (
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></svg>
  ),
  Sun: () => (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
  ),
  Moon: () => (
    <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  ),
  Pin: ({ filled }) => (
    filled
      ? <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"><path d="M16 3l5 5-3 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4z"/></svg>
      : <svg viewBox="0 0 24 24"><path d="M16 3l5 5-3 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4z"/></svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
};
