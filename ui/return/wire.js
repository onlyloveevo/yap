import {takeReady,takeLoadFailed} from '../lib/take-loading.js';
import {containBeatLabel} from '../lib/laptop-layout.js';
import { isShellMode, sayQuietly, go, comingSoon } from '../lib/app.js';
import { getRecording, getMemory, saveMemory, getTrials, answerTrialCheckIn, createRecordingFor, exportRecording } from '../lib/api.js';
import { createCheckIn } from './check-in.js';
import { matchRoute, routeFor } from '../lib/routes.js';
import { returnView, decisionLine, memoryMetaForTake, betFor, pendingNote, memoryDecision, take2Request, restartCount, betResultView } from '../lib/return-model.js';
import { checkBet, logLine } from '../../src/engine/prediction.js';
import { emptyMemory } from '../../src/engine/memory.js';
import { createReturnPreview } from '../lib/return-preview.js';
const $ = id => document.querySelector(`[data-testid="${id}"]`);
const shell = document.querySelector('.live-shell');
const shellMode = isShellMode(location);
const id = matchRoute(location.pathname, location.search)?.params.id;
let recording = null, meta = null, memory = emptyMemory(), trials = [], note = null, bet = null, busy = false, answer = null, checkInMessage = '', checkInFailed = false;
const checkIn = shellMode ? null : createCheckIn(document.querySelector('[data-testid="memory-card"]'), { onAnswer: answerCheck });
const show = (el, on) => { el.hidden = !on; };
// Saved footage only, and never in the drawn shell: no device is asked for, nothing plays.
const preview = shellMode ? null : createReturnPreview(document, { record: $('record') });
const quiet = text => sayQuietly(document, text);
function phase(value) {
 shell.dataset.phase = value;
 show($('memory-card'), value === 'ready');
 show($('record'), value === 'ready');
 for (const name of ['delivery-cue','story-card','pause','stop','timer','tick','end-take']) show($(name), value === 'recording');
 show($('bet-result'), value === 'result');
}
function render() {
 const view = returnView({ memory, trials, bet, recording, meta, note });
 const line=document.querySelector('.memory-line');line.textContent = view.question;
 let original=document.querySelector('[data-testid="original-correction"]');
 if(!original){original=document.createElement('p');original.dataset.testid='original-correction';original.style.cssText='font-size:15px;line-height:1.5;color:var(--white-soft,#c7c4bf);margin:12px 0 0';line.after(original);}
 original.textContent=view.exact ? (view.quote ? `“${view.quote}”` : '') : view.original?`You said: “${view.original}”`:'';original.hidden=!original.textContent;
 document.querySelector('.memory-title').textContent=view.title;
 let context=$('correction-context');
 if(!context){context=document.createElement('p');context.dataset.testid='correction-context';context.style.cssText='font-size:14px;line-height:1.5;color:var(--white-soft);margin:0';line.before(context);}
 context.textContent=view.contextLine||'';context.hidden=!view.contextLine;
 if(!meta?.sample){$('brand').lastElementChild.textContent='Before your next take';$('memory-card').setAttribute('aria-label','Correction for future takes');}

 let scope=document.querySelector('[data-testid="memory-scope"]');
 if(!scope){scope=document.createElement('p');scope.dataset.testid='memory-scope';scope.style.cssText='font-size:14px;line-height:1.5;color:var(--white-soft);margin:0';original.after(scope);}
 scope.textContent=view.scopeLine||'';scope.hidden=!view.scopeLine;
 if(view.exact){original.style.cssText='font-size:18px;line-height:1.45;color:var(--white-soft);margin:0;overflow-wrap:anywhere;max-height:28vh;overflow:auto';document.querySelector('.memory-actions').style.flexWrap='wrap';}
 $('memory-keep').textContent=view.keepLabel;
 if(!meta?.sample){const kept=Boolean(view.exact&&note.stored);$('memory-keep').style.background=kept?'var(--glass)':'';$('memory-keep').style.color=kept?'var(--white-soft)':'';$('memory-keep').style.borderColor=kept?'var(--glass-border)':'';}


 $('trial-status').lastElementChild.textContent = view.trialStatus || '';
 show($('trial-status'), Boolean(view.trialStatus));
 $('bet').textContent = view.betLine;$('bet').hidden=view.betOptional;
 let details=$('restart-check-details');
 if(!details){details=document.createElement('details');details.dataset.testid='restart-check-details';details.style.cssText='font-size:13px;line-height:1.5;color:var(--white-dim);margin:0';const summary=document.createElement('summary');summary.textContent='About this review';summary.style.cursor='pointer';const explanation=document.createElement('p');explanation.style.margin='8px 0 0';details.append(summary,explanation);$('bet').after(details);}
 details.hidden=!view.betOptional;details.lastElementChild.textContent=view.betExplanation;

 $('memory-keep').disabled = !note || busy || Boolean(view.exact && note.stored);
 $('memory-drop').disabled = !note || busy;
 $('memory-drop').textContent = view.dropLabel;
 if (!note && recording?.notes?.length) document.querySelector('.memory-line').textContent = meta?.sample ? 'Your choices are saved. Ready for the next take.' : 'Finished take only. This correction will not carry into your next take.';
 // A wording trial is separate from delivery-note choices. Do not offer an inert Keep/Drop decision.
 document.querySelector('.memory-actions').hidden = !note;
 // A due wording trial asks its own question; its answers are never the delivery note's Keep/Drop.
 const asking = view.checkIns.length > 0;
 checkIn?.render({ items: view.checkIns, busy, message: checkInMessage, failed: checkInFailed });
 line.hidden = false;
 if (asking) $('trial-status').hidden = true;
 if (!note && !recording?.notes?.length) {
  document.querySelector('.memory-title').textContent = asking ? 'Check in on your wording trial' : 'Ready for your next take';
  line.textContent = view.decisionLine || view.trialStatus || 'Your take is saved.';
  line.hidden = asking;
  $('trial-status').hidden = true;
  $('memory-card').setAttribute('aria-label', asking ? 'Wording trial check-in' : 'Your saved take');
 }
 $('record').disabled = !recording || busy;
 $('memory-keep').setAttribute('aria-pressed', String(answer === true));
 $('memory-drop').setAttribute('aria-pressed', String(answer === false));
 // Preserve the shell's rail and hooks while using this recording's own beats.
 const rail = $('beats');
 for (const b of rail.querySelectorAll('[data-testid="beat-node"]')) b.remove();
 for (const [index, beat] of (recording?.beats || []).entries()) {
  const button = document.createElement('button'); button.className = 'beat'; button.type = 'button';
  Object.assign(button.dataset, { testid:'beat-node', state:index ? 'ahead' : 'current' });
  button.setAttribute('aria-label', `${beat.label || beat.title}, ${index ? 'ahead' : 'current'}`);
  if (!index) button.setAttribute('aria-current','step');
  const dot = document.createElement('span'); dot.className = 'node';
  const label = document.createElement('span'); label.className = 'beat-name'; label.textContent = beat.label || beat.title;
  button.append(dot,label); rail.append(button);
  if (!shellMode) containBeatLabel(button, beat.label || beat.title);
 }
}
async function decide(keep) {
 if (busy || !note) return;
 busy = true; render();
 try {
  const next = memoryDecision(memory, note, keep);
  await saveMemory(next);
  const answeredId = note.id;
  memory = next;
  note = pendingNote(recording, memory, meta);
  answer = note && note.id !== answeredId ? null : keep;
  quiet(keep ? `Kept for ${meta?.ideaId ? 'this idea' : 'the next takes of this recording'}.` : 'The finished take keeps its correction. It will not carry into your next take.');
 } catch (err) { quiet(`Could not save that choice: ${err.message}`); }
 finally { busy = false; render(); }
}
async function answerCheck(trialId, choice) {
 if (busy) return;
 busy = true; checkInFailed = false; checkInMessage = 'Saving your answer…'; render();
 try {
  const result = await answerTrialCheckIn(trialId, choice);
  trials = trials.map(t => t.id === result.trial.id ? result.trial : t);
  // With no delivery note the card's main line says it; otherwise it is said right under the question that was answered.
  checkInMessage = note || recording?.notes?.length ? decisionLine(result.trial, meta) : '';
  quiet(decisionLine(result.trial, meta));
 } catch (err) {
  checkInFailed = true; checkInMessage = `Could not save that answer: ${err.message}`;
 } finally {
  // The saved trials are the truth: reload them so a stale page shows what is really kept.
  try { trials = (await getTrials()) || trials; } catch {}
  busy = false; render();
 }
}
async function start() {
 if (busy || !recording) return;
 busy = true; render();
 try {
  // An unanswered note is not silently accepted. Existing memory remains the person's.
  const next = await createRecordingFor({ ...take2Request(recording, meta, memory), sampleTake: meta.sample ? 2 : undefined, returnFrom: id });
  if (bet) {
   memory = { ...memory, predictionLog: [...(memory.predictionLog || []), { ...logLine(bet, null, new Date().toISOString()), recordingId: next.id, sourceRecording: id, sample: Boolean(meta.sample) }] };
   await saveMemory(memory);
  }
  const query = new URLSearchParams();
  if (meta.sample) { query.set('sample','1'); query.set('sampleTake','2'); }
  query.set('returnFrom', id);
  if (new URLSearchParams(location.search).has('fast')) query.set('fast','1');
  go(`${routeFor('record', { id:next.id })}?${query}`);
 } catch (err) { busy = false; render(); quiet(`Could not start the next take: ${err.message}`); }
}
async function open() {
 phase('ready'); $('record').disabled = true;
 // No drawn sample claims remain visible while the saved facts are loading.
 document.querySelector('.memory-line').textContent = 'Opening your saved take…';
 $('trial-status').hidden = true; $('bet').textContent = '';
 try {
  const settled = await Promise.allSettled([getRecording(id), getMemory(), getTrials()]);
  if (settled[0].status !== 'fulfilled') throw settled[0].reason;
  const saved = settled[0].value;
  if (!saved) throw new Error('There is no saved take at this address.');
  ({recording, meta} = saved);
  meta = await memoryMetaForTake(meta, getRecording);
  if (settled[1].status !== 'fulfilled') throw settled[1].reason;
  if (settled[2].status !== 'fulfilled') throw settled[2].reason;
  memory = settled[1].value || emptyMemory(); trials = settled[2].value || [];
  note = pendingNote(recording, memory, meta);
  bet = betFor(recording, (memory.predictionLog || []).filter(entry => meta.sample ? entry.sample !== false : entry.sample !== true));
  render();
  const completed = new URLSearchParams(location.search).get('completed');
  // A completed child is shown only once it is proved to belong to this return; until then nothing unrelated appears.
  if (!completed) preview?.show(id, 'previous');
  if (completed) {
   const take = await getRecording(completed);
   if (!take || take.meta.returnFrom !== id) throw new Error('The completed take does not belong to this return.');
   preview?.show(completed, 'completed');
   const logged = (memory.predictionLog || []).find(entry => entry.recordingId === completed && entry.actual === null);
   const savedBet = logged ? { kind: logged.kind, forTake: logged.forTake, predicted: logged.predicted, slack: logged.slack } : bet;
   const actual = restartCount(take.recording);
   const result = betResultView(savedBet, actual);
   if (savedBet && actual != null && !(memory.predictionLog || []).some(entry => entry.recordingId === completed && entry.actual != null)) {
    memory = { ...memory, predictionLog: [...(memory.predictionLog || []), { ...logLine(savedBet, checkBet(savedBet, actual), new Date().toISOString()), recordingId: completed, sourceRecording: id, sample: Boolean(meta.sample) }] };
    await saveMemory(memory);
   }
   document.querySelector('.result-line').textContent = result.line;
   document.querySelector('.result-next').textContent = result.nextLine || '';
   $('edit').onclick = () => go(routeFor('edit', {id:completed}));
   $('export').onclick = () => go(routeFor('edit', {id:completed}));
   phase('result');
  }
  takeReady(document);
 } catch (err) {
  $('record').disabled = true; $('memory-keep').disabled = true; $('memory-drop').disabled = true;
  document.querySelector('.memory-line').textContent = err.message;
  quiet(err.message);
  takeLoadFailed(document,err);
 }
}
if (!shellMode) {
 $('memory-keep').addEventListener('click', () => decide(true));
 $('memory-drop').addEventListener('click', () => decide(false));
 $('record').addEventListener('click', start);
 $('edit').onclick = () => go(routeFor('edit', {id}));
 $('export').onclick = () => go(routeFor('edit', {id}));
 $('help').lastElementChild.textContent = 'About this take'; $('help').setAttribute('aria-label', 'About this take');
$('help').addEventListener('click', () => quiet(meta?.sample ? 'Keep or drop the delivery note, then press Record to start a new take. Your previous take stays saved.' : 'The correction already happened in the finished take. Keep for future takes carries it into the next take and later takes of this idea or recording. Finished take only does not carry it forward. Your finished take stays saved.'));
 open();
} else {
 // Isolated visual fixture only: no device permission, API writes or real outcome claims.
 let keep = true, seconds = 0, paused = false, ticker;
 const timer = () => { $('timer').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; };
 $('memory-keep').onclick = () => { keep=true; $('memory-keep').setAttribute('aria-pressed','true'); $('memory-drop').setAttribute('aria-pressed','false'); };
 $('memory-drop').onclick = () => { keep=false; $('memory-keep').setAttribute('aria-pressed','false'); $('memory-drop').setAttribute('aria-pressed','true'); };
 $('record').onclick = () => { seconds=0; paused=false; timer(); phase('recording'); $('delivery-cue').querySelector('[data-role="cue-text"]').textContent = keep ? 'From last time: slow down' : 'Smile'; clearInterval(ticker); ticker=setInterval(() => { if (!paused) { seconds++; timer(); } },1000); };
 const end = () => { clearInterval(ticker); phase('result'); };
 $('stop').onclick=end; $('end-take').onclick=end;
 $('pause').onclick=()=>{ paused=!paused; $('pause').classList.toggle('is-paused',paused); $('pause').setAttribute('aria-pressed',String(paused)); $('pause').setAttribute('aria-label',paused?'Resume recording':'Pause recording'); };
 $('tick').onclick=()=>{ const beats=[...document.querySelectorAll('[data-testid="beat-node"]')]; const index=beats.findIndex(b=>b.dataset.state==='current'); if(index>=0&&index<beats.length-1){ beats[index].dataset.state='done'; beats[index].querySelector('.node').textContent='✓'; beats[index+1].dataset.state='current'; } };
 phase('ready');
}
