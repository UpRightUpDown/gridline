/* Reference material for Ask Claude: files uploaded in the settings panel that show which
 * methods to use. They live in the gridline-settings worker, shared by every device, and the
 * gridline-claude worker reads them with each question. Works in the browser (window.GRefs)
 * and in Node. */
(function (root) {
  'use strict';
  const URL = 'https://gridline-settings.uprightupdown.workers.dev/references';
  const MAX_FILE = 3.7 * 1000 * 1000; // a PDF this size is 5 MB once base64-encoded, all the worker holds
  const IMAGE_EDGE = 1568;           // Claude scales larger images down to this anyway

  // 'pdf', 'text' or 'image' for a file Claude can read, otherwise null.
  function kindOf(file) {
    const name = (file.name || '').toLowerCase();
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return 'image';
    if (/^text\//.test(file.type) || /\.(txt|md|csv|tex)$/.test(name)) return 'text';
    return null;
  }

  async function call(url, opts, fetchImpl) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    let res;
    try { res = await doFetch(url, opts); }
    catch (e) { throw new Error('Could not reach the settings store. Check the connection and try again.'); }
    if (!res.ok) {
      let why = '';
      try { why = await res.text(); } catch (e) { /* no body */ }
      throw new Error(why && why.length < 200 ? why : 'The settings store said no (error ' + res.status + ').');
    }
    return res;
  }

  const list = async fetchImpl => (await call(URL, { cache: 'no-store' }, fetchImpl)).json();
  const add = async (file, fetchImpl) => (await call(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file) }, fetchImpl)).json();
  const remove = async (id, fetchImpl) => { await call(URL + '/' + encodeURIComponent(id), { method: 'DELETE' }, fetchImpl); };

  // Browser only: read a chosen file into what add() sends.
  function readFile(file) {
    const kind = kindOf(file);
    if (!kind) return Promise.reject(new Error('Please choose a PDF, a text file (.txt, .md, .csv) or a PNG, JPEG, GIF or WebP image.'));
    // images are scaled down below, so only PDFs and text files can be too big here
    if (kind !== 'image' && file.size > MAX_FILE) return Promise.reject(new Error('That file is over 3.7 MB. The reference files can add up to 5 MB, so please choose a smaller one.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('That file could not be read. Please try another.'));
      reader.onload = () => {
        if (kind === 'text') { resolve({ name: file.name, kind, mediaType: 'text/plain', data: String(reader.result) }); return; }
        const url = String(reader.result);
        if (kind === 'pdf') { resolve({ name: file.name, kind, mediaType: 'application/pdf', data: url.slice(url.indexOf(',') + 1) }); return; }
        // images: scale down to what Claude reads, so large photos stay within its limits
        const img = new Image();
        img.onerror = () => reject(new Error('That image could not be read. Please try another.'));
        img.onload = () => {
          const scale = Math.min(1, IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const jpeg = canvas.toDataURL('image/jpeg', 0.9);
          resolve({ name: file.name, kind, mediaType: 'image/jpeg', data: jpeg.slice(jpeg.indexOf(',') + 1) });
        };
        img.src = url;
      };
      if (kind === 'text') reader.readAsText(file); else reader.readAsDataURL(file);
    });
  }

  const api = { URL, kindOf, list, add, remove, readFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GRefs = api;
})(typeof window !== 'undefined' ? window : globalThis);
