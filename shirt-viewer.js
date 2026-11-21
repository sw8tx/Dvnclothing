// The viewer and models are served from DVN. No third-party requests are made.
let viewerModule;
const copy = {
  de: { title: '3D am Model', hint: 'Ziehen zum Drehen · mit zwei Fingern zoomen', left: 'Model nach links drehen', right: 'Model nach rechts drehen', reset: 'Vorderseite', loading: '3D-Ansicht wird geladen …', error: 'Die 3D-Ansicht konnte nicht geladen werden. Du siehst weiterhin das Originalfoto.', unsupported: 'Dein Browser unterstützt die 3D-Ansicht nicht. Du siehst stattdessen das Originalfoto.', retry: 'Erneut laden', note: 'KI-generierte Person mit getragenem Shirt. Körper, Passform und nicht fotografierte Seiten sind angenähert. Die Originalfotos zeigen das tatsächliche Produkt.' },
  en: { title: '3D on model', hint: 'Drag to rotate · pinch to zoom', left: 'Rotate model left', right: 'Rotate model right', reset: 'Front view', loading: 'Loading 3D view …', error: 'The 3D view could not be loaded. The original photo is still shown.', unsupported: 'Your browser does not support the 3D view. The original photo is shown instead.', retry: 'Try again', note: 'AI-generated person wearing the tee. Body, fit and unphotographed sides are approximate. Refer to the original photos for the actual product.' }
};
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
export function createShirtViewer(container, product) {
  const words = () => copy[document.documentElement.lang === 'en' ? 'en' : 'de'];
  const section = node('section', 'shirt-viewer');
  const stage = node('div', 'shirt-viewer-stage');
  const status = node('p', 'shirt-viewer-status'); status.setAttribute('role', 'status');
  const fallback = node('img', 'shirt-viewer-fallback'); fallback.src = product.image; fallback.alt = product.name;
  const model = node('model-viewer');
  model.setAttribute('alt', product.name + ' · ' + words().title);
  model.setAttribute('camera-controls', ''); model.setAttribute('touch-action', 'pan-y');
  model.setAttribute('camera-orbit', '0deg 90deg auto');
  model.setAttribute('min-camera-orbit', 'auto 20deg auto'); model.setAttribute('max-camera-orbit', 'auto 160deg auto');
  model.setAttribute('shadow-intensity', '0.35'); model.setAttribute('exposure', '1.1');
  model.setAttribute('interaction-prompt', 'none'); model.setAttribute('loading', 'eager');
  model.setAttribute('poster', product.image); model.setAttribute('disable-tap', '');
  const controls = node('div', 'shirt-viewer-controls');
  const left = node('button', 'shirt-rotate', '←'); const right = node('button', 'shirt-rotate', '→');
  const reset = node('button', 'shirt-reset');
  const hint = node('p', 'shirt-viewer-hint');
  const note = node('p', 'shirt-viewer-note');
  const retry = node('button', 'shirt-retry'); retry.hidden = true;
  for (const button of [left, right, reset, retry]) button.type = 'button';
  controls.append(left, reset, right); stage.append(fallback, model, status, retry); section.append(stage, controls, hint, note); container.append(section);
  let started = false, ready = false, failed = false, unsupported = false, timeout;
  const sync = () => {
    const w = words(); section.setAttribute('aria-label', w.title); model.setAttribute('alt', product.name + ' · ' + w.title); hint.textContent = w.hint; note.textContent = w.note;
    left.setAttribute('aria-label', w.left); right.setAttribute('aria-label', w.right); reset.textContent = w.reset; retry.textContent = w.retry;
    status.textContent = unsupported ? w.unsupported : failed ? w.error : w.loading;
    hint.hidden = unsupported || failed; controls.hidden = unsupported || failed;
    for (const b of [left, right, reset]) b.disabled = !ready;
  };
  const fail = () => { clearTimeout(timeout); failed = true; ready = false; model.hidden = true; fallback.hidden = false; status.hidden = false; retry.hidden = false; sync(); };
  model.addEventListener('load', () => { clearTimeout(timeout); ready = true; failed = false; model.hidden = false; fallback.hidden = true; status.hidden = true; retry.hidden = true; sync(); });
  model.addEventListener('error', fail);
  const start = async () => {
    if (unsupported || (started && !failed)) return;
    started = true; failed = false; ready = false; model.hidden = false; fallback.hidden = false; status.hidden = false; retry.hidden = true; sync();
    try {
      // Check before importing Three/model-viewer so unsupported devices retain
      // their original photo immediately instead of waiting on a blank canvas.
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) { unsupported = true; model.hidden = true; sync(); return; }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      viewerModule ||= import('./assets/vendor/model-viewer.min.js').catch(error => { viewerModule = undefined; throw error; });
      await viewerModule;
      if (model.getAttribute('src')) model.removeAttribute('src');
      model.setAttribute('src', '/assets/models/' + product.id + '.glb');
      timeout = setTimeout(fail, 45000);
    } catch { fail(); }
  };
  const turn = degrees => {
    if (!ready) return;
    const orbit = model.getCameraOrbit();
    model.cameraOrbit = `${orbit.theta * 180 / Math.PI + degrees}deg ${orbit.phi * 180 / Math.PI}deg ${orbit.radius}m`;
  };
  left.addEventListener('click', () => turn(-30)); right.addEventListener('click', () => turn(30));
  reset.addEventListener('click', () => { model.cameraOrbit = '0deg 90deg auto'; model.cameraTarget = 'auto auto auto'; });
  retry.addEventListener('click', start);
  // Native model-viewer keyboard controls support arrows; Home restores the front.
  model.addEventListener('keydown', event => { if (event.key === 'Home') { event.preventDefault(); reset.click(); } });
  sync();
  return { show() { container.hidden = false; sync(); void start(); }, hide() { container.hidden = true; }, translate: sync };
}
