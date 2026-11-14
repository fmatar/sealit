function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function activateTabSet(names, activeName, getPanel, getTab) {
  for (const name of names) {
    const panel = getPanel(name);
    const tab = getTab(name);
    const isActive = name === activeName;
    if (panel) panel.hidden = !isActive;
    if (tab) tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
}

function bindDelegatedNodeClicks(container, onSelect) {
  if (!container) return;
  container.onclick = (ev) => {
    const targetEl = ev.target && ev.target.closest ? ev.target.closest('[data-node-id]') : null;
    if (targetEl) onSelect(targetEl.getAttribute('data-node-id'));
  };
}
