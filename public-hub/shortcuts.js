// Keyboard navigation additions for the synthetic and production Document Hub UI.
// All actions target existing permission-aware controls; this module never bypasses API authorization.
export function isTypingTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable], [role="textbox"]'));
}
export function shortcutAction(event, typing = isTypingTarget(event.target)) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || typing) return null;
  if (event.key === '?' && event.shiftKey) return 'help';
  if (event.key === '/') return 'search';
  if (event.key === 'Escape') return 'close';
  return null;
}
function initShortcuts(doc) {
  const help = doc.createElement('dialog');
  help.id = 'hub-shortcut-help';
  help.className = 'hub-shortcut-help';
  help.setAttribute('aria-labelledby', 'hub-shortcut-title');
  help.innerHTML = `<div class="shortcut-help-header"><h2 id="hub-shortcut-title">Keyboard shortcuts</h2><button type="button" class="shortcut-help-close" aria-label="Close keyboard shortcuts">Close</button></div>
  <p>Use these shortcuts when you are not typing in a field.</p>
  <dl><div><dt>Search documents</dt><dd><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd></dd></div>
  <div><dt>Focus search</dt><dd><kbd>/</kbd></dd></div>
  <div><dt>Show shortcuts</dt><dd><kbd>?</kbd></dd></div>
  <div><dt>Close shortcuts or menus</dt><dd><kbd>Esc</kbd></dd></div></dl>`;
  doc.body.append(help);
  const close = help.querySelector('.shortcut-help-close');
  close.addEventListener('click', () => help.close());
  help.addEventListener('click', event => { if (event.target === help) help.close(); });
  let returnFocus = null;
  function showHelp(trigger) {
    if (help.open) return;
    returnFocus = trigger || doc.activeElement;
    help.showModal();
    close.focus();
  }
  help.addEventListener('close', () => {
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
  });
  function attachHelpButton() {
    const bar = doc.querySelector('#app .explorer-top-actions');
    if (!bar || bar.querySelector('.hub-shortcut-trigger')) return;
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'hub-shortcut-trigger';
    trigger.textContent = '?';
    trigger.title = 'Keyboard shortcuts';
    trigger.setAttribute('aria-label', 'Keyboard shortcuts');
    trigger.addEventListener('click', () => showHelp(trigger));
    const account = bar.querySelector('.explorer-alerts');
    if (account) bar.insertBefore(trigger, account);
    else bar.append(trigger);
  }
  doc.addEventListener('keydown', event => {
    // While a modal is open, do not send keyboard events behind it.
    if (help.open) return;
    const action = shortcutAction(event);
    if (action === 'help') {
      event.preventDefault();
      showHelp();
    } else if (action === 'search') {
      const input = doc.querySelector('#app .modern-search input, #app #search input');
      if (!input || input.disabled || input.hidden) return;
      event.preventDefault();
      input.focus();
    }
  });
  const root = doc.querySelector('#app');
  if (root) {
    // Hub screens are replaced asynchronously after sign-in and section changes.
    const observer = new MutationObserver(attachHelpButton);
    observer.observe(root, {childList: true, subtree: false});
    attachHelpButton();
    // The explorer can insert its toolbar after a root render.
    doc.addEventListener('tdsa:shortcuts-refresh', attachHelpButton);
  }
}
if (typeof document !== 'undefined' && document.body) initShortcuts(document);
