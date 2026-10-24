// App wrapper (same idea as the KGEES FSR wrapper):
// splash screen while loading, a "No signal" screen when offline,
// an install button on Android, and the service worker that makes it installable.
(function () {
  const splash = document.getElementById('splash');
  const offline = document.getElementById('offline');
  const usesSheet = !!(window.WORD_CHALLENGE_API || '').trim();

  function hideSplash() {
    if (!splash || splash.classList.contains('fade')) return;
    splash.classList.add('fade');
    setTimeout(() => { splash.hidden = true; }, 450);
  }

  // Practice mode works offline; the live game needs the sheet
  if (usesSheet && !navigator.onLine) {
    splash.hidden = true;
    offline.hidden = false;
  } else {
    const minShow = new Promise(r => setTimeout(r, 900));
    const fonts = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
    const maxWait = new Promise(r => setTimeout(r, 3000));
    Promise.race([Promise.all([minShow, fonts]), maxWait]).then(hideSplash);
  }

  window.addEventListener('online', () => { if (!offline.hidden) location.reload(); });
  window.addEventListener('offline', () => {
    if (usesSheet && splash && !splash.hidden) { splash.hidden = true; offline.hidden = false; }
  });

  // Service worker: needed for install + the offline screen
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Install button (Android Chrome)
  let deferredPrompt = null;
  const bar = document.getElementById('install');
  let dismissed = false;
  try { dismissed = localStorage.getItem('wc-install-dismissed') === '1'; } catch (e) {}

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!dismissed) bar.hidden = false;
  });
  document.getElementById('installBtn').addEventListener('click', async () => {
    bar.hidden = true;
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  });
  document.getElementById('installClose').addEventListener('click', () => {
    bar.hidden = true;
    try { localStorage.setItem('wc-install-dismissed', '1'); } catch (e) {}
  });
  window.addEventListener('appinstalled', () => { bar.hidden = true; });
})();
