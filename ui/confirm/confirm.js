const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

const input = q('idea-input');
const send = q('send');
const points = ['opening', 'story', 'closing'];

const sync = () => { send.disabled = input.value.trim() === ''; };
input.addEventListener('input', sync);
sync();

send.addEventListener('click', () => {
  if (send.disabled) return;
  emit('yap:idea-message', { text: input.value });
});

for (const key of points) {
  const row = q(`point-${key}`);
  row.addEventListener('click', () => {
    row.setAttribute('aria-checked', String(row.getAttribute('aria-checked') !== 'true'));
  });
}

q('talk-to-yap').addEventListener('click', () => emit('yap:talk'));
q('edit').addEventListener('click', () => emit('yap:idea-edit'));
q('keep-exploring').addEventListener('click', () => emit('yap:idea-keep-exploring'));
q('confirm-idea').addEventListener('click', () => {
  const state = {};
  for (const key of points) state[key] = q(`point-${key}`).getAttribute('aria-checked') === 'true';
  emit('yap:idea-confirm', { points: state });
});
