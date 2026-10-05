// Release the server's first-paint gate only after the actual take is rendered.
export function takeReady(doc) {
 const surface=doc.querySelector('[data-take-surface]');
 if(!surface)return;
 surface.inert=false;surface.setAttribute('aria-busy','false');surface.style.removeProperty('visibility');
 doc.documentElement.dataset.takeReady='true';
 doc.querySelector('[data-testid="take-loading"]')?.remove();
}

export function takeLoadFailed(doc,error) {
 const gate=doc.querySelector('[data-testid="take-loading"]');
 if(!gate)return;
 doc.documentElement.dataset.takeReady='error';gate.setAttribute('role','alert');
 doc.querySelector('[data-testid="take-loading-title"]').textContent='Could not open your take';
 doc.querySelector('[data-testid="take-loading-detail"]').textContent=`${error.message || String(error)} Your saved recording has not been changed. Reload this take to try again, or go Home.`;
}
