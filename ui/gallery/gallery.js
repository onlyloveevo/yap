const pills = [...document.querySelectorAll('.pill')];
const cards = [...document.querySelectorAll('.card')];
const formatOf = { 'filter-talking-head': 'Talking head', 'filter-vlog': 'Vlog', 'filter-walkthrough': 'Walkthrough', 'filter-interview': 'Interview' };

for (const pill of pills) {
  pill.addEventListener('click', () => {
    for (const p of pills) p.setAttribute('aria-pressed', String(p === pill));
    const want = formatOf[pill.dataset.testid];
    for (const card of cards) card.hidden = Boolean(want) && card.dataset.format !== want;
  });
}

const pick = (card) => {
  const id = Number(card.dataset.id);
  const title = card.querySelector('.card-title').textContent;
  document.dispatchEvent(new CustomEvent('yap:idea-pick', { detail: { id, title } }));
};
for (const card of cards) {
  card.addEventListener('click', (e) => { if (!e.target.closest('.more')) pick(card); });
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); pick(card); }
  });
}

document.querySelector('[data-testid="new-idea"]').addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('yap:idea-new'));
});
