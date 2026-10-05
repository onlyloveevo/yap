// The wording-trial check-in on the Return card: the engine's own question with two plain answers.
// It is separate from the delivery-note Keep/Drop below it. Nothing is saved until a button is pressed.
let styled = false;
function addStyles() {
 if (styled) return;
 styled = true;
 const link = document.createElement('link');
 link.rel = 'stylesheet';
 link.href = new URL('check-in.css', import.meta.url).href;
 document.head.append(link);
}
export function createCheckIn(card, { onAnswer }) {
 addStyles();
 const root = document.createElement('div');
 root.className = 'check-in';
 root.dataset.testid = 'trial-check-in';
 root.hidden = true;
 card.querySelector('.memory-title').after(root);
 // One block per due trial, rebuilt from the persisted trials each time so a stale answer button never lingers.
 function render({ items = [], busy = false, message = '', failed = false }) {
  root.replaceChildren();
  root.hidden = !items.length && !message;
  for (const item of items) {
   const ask = document.createElement('p');
   ask.className = 'check-in-ask';
   ask.dataset.testid = 'check-in-ask';
   ask.textContent = item.ask;
   const actions = document.createElement('div');
   actions.className = 'check-in-actions';
   for (const [answer, label, cls] of [['keep', item.keepLabel, 'pill pill-amber'], ['revert', item.revertLabel, 'pill pill-glass']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = cls;
    button.dataset.testid = `check-in-${answer}`;
    button.textContent = label;
    button.disabled = busy;
    button.addEventListener('click', () => onAnswer(item.trialId, answer));
    actions.append(button);
   }
   root.append(ask, actions);
  }
  if (message) {
   const note = document.createElement('p');
   note.className = 'check-in-note';
   note.dataset.testid = 'check-in-message';
   note.setAttribute('role', failed ? 'alert' : 'status');
   if (failed) note.dataset.failed = 'true';
   note.textContent = message;
   root.append(note);
  }
 }
 return { render, element: root };
}
