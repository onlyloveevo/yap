// Classic, independent bootstrap: a failed module graph cannot run its imports.
// Loaded only by runtime take responses; frozen shell routes never load this.
(() => {
 const fail = () => {
  const gate=document.querySelector('[data-testid="take-loading"]');
  if(!gate || document.documentElement.dataset.takeReady!=='false')return;
  document.documentElement.dataset.takeReady='error';
  gate.setAttribute('role','alert');
  gate.querySelector('[data-testid="take-loading-title"]').textContent='Could not load this page';
  gate.querySelector('[data-testid="take-loading-detail"]').textContent='The recording page could not finish loading. Reload this take to try again. Your saved recording has not been changed.';
 };
 window.addEventListener('error',event=>{
  // Module graph fetch failures target the entry script; evaluation errors are
  // ErrorEvents. Ignore unrelated image/media errors and failures after boot.
  if(event.target?.tagName==='SCRIPT' || event instanceof ErrorEvent)fail();
 },true);
})();
