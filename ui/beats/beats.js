const $ = (id, root = document) => root.querySelector(`[data-testid="${id}"]`);
const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
const list = $('beat-list');
const rows = () => [...list.querySelectorAll('.beat')];

const renumber = () => rows().forEach((row, i) => {
  $(`beat-${row.dataset.id}-num`).textContent = String(i + 1).padStart(2, '0');
});

const move = (row, dir) => {
  const to = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!to) return;
  if (dir < 0) list.insertBefore(row, to); else list.insertBefore(to, row);
  renumber();
};

for (const row of rows()) {
  const id = row.dataset.id;
  const handle = $(`beat-${id}-handle`);
  handle.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    move(row, e.key === 'ArrowUp' ? -1 : 1);
    handle.focus();
  });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!row.classList.contains('dragging')) return;
    const prev = row.previousElementSibling;
    const next = row.nextElementSibling;
    if (prev && e.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) move(row, -1);
    else if (next && e.clientY > next.getBoundingClientRect().bottom - next.offsetHeight / 2) move(row, 1);
  });
  const drop = () => row.classList.remove('dragging');
  handle.addEventListener('pointerup', drop);
  handle.addEventListener('pointercancel', drop);

  const accept = $(`beat-${id}-accept`);
  if (accept) accept.addEventListener('click', () => {
    accept.setAttribute('aria-pressed', 'true');
    row.dataset.state = 'accepted';
  });
  $(`beat-${id}-edit`).addEventListener('click', () => fire('yap:beat-edit', { id }));
}

const extras = $('extras');
extras.addEventListener('click', () => {
  extras.setAttribute('aria-expanded', String(extras.getAttribute('aria-expanded') !== 'true'));
});

const input = $('refine-input');
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  fire('yap:idea-message', { text });
  input.value = '';
});

$('talk-to-yap').addEventListener('click', () => fire('yap:talk'));
$('edit-idea').addEventListener('click', () => fire('yap:idea-edit'));
$('add-beat').addEventListener('click', () => fire('yap:beat-add'));
for (const id of ['back-top', 'back-bottom']) {
  $(id).addEventListener('click', (e) => { e.preventDefault(); fire('yap:idea-back'); });
}
$('prepare-recording').addEventListener('click', () => {
  fire('yap:beats-ready', {
    beats: rows().map((row) => {
      const id = row.dataset.id;
      return {
        id,
        title: $(`beat-${id}-title`).textContent,
        line: $(`beat-${id}-line`).textContent,
        state: row.dataset.state,
      };
    }),
  });
});
