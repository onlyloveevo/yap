const input = document.querySelector('[data-testid="idea-input"]');
const send = document.querySelector('[data-testid="send"]');
const talk = document.querySelector('[data-testid="talk-to-yap"]');
const chips = [...document.querySelectorAll('.chip')];

const sync = () => { send.disabled = input.value.trim() === ''; };
input.addEventListener('input', sync);
sync();

send.addEventListener('click', () => {
  if (send.disabled) return;
  document.dispatchEvent(new CustomEvent('yap:idea-submit', { detail: { text: input.value } }));
});

talk.addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('yap:talk'));
});

for (const chip of chips) {
  chip.addEventListener('click', () => {
    const next = chip.getAttribute('aria-pressed') !== 'true';
    for (const c of chips) c.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-pressed', String(next));
  });
}
