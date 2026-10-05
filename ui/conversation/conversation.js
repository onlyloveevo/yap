const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const input = $('idea-input');
const send = $('send');
const formats = [$('format-vlog'), $('format-talking-head')];

const sync = () => { send.disabled = input.value.trim() === ''; };
input.addEventListener('input', sync);
sync();

const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

send.addEventListener('click', () => {
  if (send.disabled) return;
  emit('yap:idea-message', { text: input.value });
});

for (const f of formats) {
  f.addEventListener('click', () => {
    for (const o of formats) o.setAttribute('aria-pressed', String(o === f));
  });
}

const clicks = { 'talk-to-yap': 'yap:talk', 'save-thought': 'yap:idea-save-thought', 'more-formats': 'yap:formats-more', 'keep-exploring': 'yap:idea-keep-exploring' };
for (const [id, name] of Object.entries(clicks)) $(id).addEventListener('click', () => emit(name));
