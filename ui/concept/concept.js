const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));

const input = $('idea-input');
const send = $('send');
const sync = () => { send.disabled = input.value.trim() === ''; };
input.addEventListener('input', sync);
sync();
send.addEventListener('click', () => {
  if (send.disabled) return;
  emit('yap:idea-message', { text: input.value });
});

const thumbs = [$('thumb-a'), $('thumb-b')];
for (const t of thumbs) {
  t.addEventListener('click', () => {
    for (const o of thumbs) o.setAttribute('aria-pressed', String(o === t));
  });
}

const exp = $('experiment');
exp.addEventListener('click', () => {
  exp.setAttribute('aria-expanded', String(exp.getAttribute('aria-expanded') !== 'true'));
});

const clicks = {
  'talk-to-yap': 'yap:talk',
  'change': 'yap:idea-change-format',
  'edit-story': 'yap:idea-edit-story',
  'bring-experiment': 'yap:experiment-bring',
  'keep-exploring': 'yap:idea-keep-exploring',
  'save-idea': 'yap:idea-save',
};
for (const [id, name] of Object.entries(clicks)) {
  $(id).addEventListener('click', (e) => { e.preventDefault(); emit(name); });
}
