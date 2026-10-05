// Runtime adapters only: the frozen reference screens keep their original geometry.
export function applyLaptopEditorLayout(doc = document) {
 if (doc.querySelector('[data-yap-laptop-editor]')) return;
 const style = doc.createElement('style');
 style.dataset.yapLaptopEditor = '';
 style.textContent = `@media (max-height: 760px) {
  .edit-shell { display: flex; flex-direction: column; min-height: 0; }
  .edit-shell > .player { flex: 1 1 auto; min-height: 180px; height: auto; }
  .edit-shell > .top-bar, .edit-shell > .view-row,
  .edit-shell > .timeline, .edit-shell > .bottom-row { flex-shrink: 0; }
 }`;
 doc.head.append(style);
}

// Keep full authored wording in accessible/native labels, inside its own rail slot.
export function containBeatLabel(node, title) {
 node.style.minWidth = '0';
 node.title = title;
 const label = node.querySelector('.beat-name');
 if (label) Object.assign(label.style, {
  display: 'block', minWidth: '0', maxWidth: '100%', overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
 });
}
