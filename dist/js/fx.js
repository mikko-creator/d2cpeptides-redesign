/* D2C Peptides redesign: fx.js - the motion and depth layer. Plain script, loaded with defer after the client's
   site.js, no dependencies. It never changes the text of a page: reveals only toggle classes, the ticker's clones
   are aria-hidden, and the counters end on the exact text they started with.
   - scroll reveals (IntersectionObserver, threshold 0, no dead band; released after the entrance so hover works;
     a focus inside a pending reveal finishes it; a fail-safe only when the observer never delivered)
   - parallax depth for [data-depth] layers and the hero media, one rAF per frame, only while in view
   - pointer tilt + glare on cards (fine pointers only) and a spotlight on dark bands
   - background loops: the phone cut under 700px, play only while visible, never under reduced motion / Save-Data
   - header scroll progress, a seamless ticker, count-up readouts, a contents scrollspy */
(() => {
  'use strict';
  const d = document, w = window, R = d.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const qa = (s, el = d) => [...el.querySelectorAll(s)];

  /* ---- ticker: clone the items once so translateX(-50%) loops without a gap ---- */
  if (!reduced) qa('.marquee ul').forEach((ul) => {
    if (ul.dataset.cloned) return;
    ul.dataset.cloned = '1';
    [...ul.children].forEach((li) => { const c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); ul.append(c); });
  });

  /* ---- header progress hairline ---- */
  const hdr = d.querySelector('.site-header');
  let bar = null;
  if (hdr) { bar = d.createElement('span'); bar.className = 'progress'; bar.setAttribute('aria-hidden', 'true'); hdr.append(bar); }

  /* ---- background loops ---- */
  const vids = qa('video[data-src]');
  if (vids.length && !reduced && !saveData) {
    const small = matchMedia('(max-width: 700px)').matches;
    const vio = new IntersectionObserver((es) => es.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) {
        if (!v.src) { v.src = (small && v.dataset.srcSm) || v.dataset.src; v.load(); }
        const p = v.play(); if (p && p.catch) p.catch(() => {});
      } else if (!v.paused) v.pause();
    }), { rootMargin: '200px 0px' });
    vids.forEach((v) => { v.muted = true; v.setAttribute('muted', ''); vio.observe(v); });
  }

  if (reduced) return; // everything below is motion

  R.classList.add('fx-ready');

  /* ---- reveals ---- */
  const blocks = qa([
    'main .section > .wrap > :not(.prose):not([data-grid]):not(.grid):not(.tiles):not(.child-cards):not(.faq):not(.links):not(.city):not(.toc):not(.catrow)',
    'main .section > .wrap > .prose > :is(h2, h3, .table-wrap, blockquote, figure, .note)',
    'main .section > .wrap--narrow > .prose > :is(p, ul, ol):nth-child(-n+3)',
    'main .section > .wrap > .city > div > .prose > :is(h2, h3)',
    'main .section > .wrap > .band__text, main .section > .wrap > .band__aside',
    'main .bulk, main .supplies-needed > h2, main .related > h2, main .review-block, main .city__facts',
    '.site-footer .footer__cols > div',
  ].join(','));
  const items = qa([
    'main .grid > .pcard', 'main .tiles > .tile', 'main .child-cards > li', 'main .faq > .faq__item',
    'main .band__list > li', 'main .supplies-needed li', 'main .stats > .stat', 'main .trust > .trust__item',
    'main .links:not(.links--cols) > li', 'main .results > .result',
  ].join(','));
  const all = new Set([...blocks, ...items]);
  // never gate anything inside the hero (it has its own entrance) or a sideways-scrolling rail
  for (const el of all) if (el.closest('.hero, .filters, .marquee')) all.delete(el);
  const STEP = 70, MAX = 8;
  const sib = new Map();
  for (const el of all) {
    el.setAttribute('data-rv', el.matches('.band__aside, .city__facts') ? 'right' : '');
    if (items.includes(el)) {
      const p = el.parentElement, i = (sib.get(p) || 0);
      sib.set(p, i + 1);
      el.style.setProperty('--rv-d', Math.min(i, MAX) * STEP + 'ms');
    }
  }
  const release = (el) => {
    if (!el.hasAttribute('data-rv') || el.classList.contains('is-in')) return;
    el.classList.add('is-in');
    const delay = parseFloat(getComputedStyle(el).getPropertyValue('--rv-d')) || 0;
    // drop the attribute after the entrance so hover and tilt transforms are no longer outranked
    setTimeout(() => { el.removeAttribute('data-rv'); el.classList.remove('is-in'); el.style.removeProperty('--rv-d'); }, 1100 + delay);
  };
  let delivered = false;
  const io = new IntersectionObserver((es) => {
    delivered = true;
    for (const e of es) if (e.isIntersecting) { release(e.target); io.unobserve(e.target); }
  }, { threshold: 0, rootMargin: '0px' });
  all.forEach((el) => io.observe(el));
  const revealAll = () => { all.forEach(release); };
  d.addEventListener('focusin', (e) => { const el = e.target.closest('[data-rv]'); if (el) release(el); qa('[data-rv]', e.target).forEach(release); });
  w.addEventListener('beforeprint', revealAll);
  setTimeout(() => { if (!delivered && d.visibilityState === 'visible') revealAll(); }, 2500);

  /* ---- count-up readouts (text restored exactly) ---- */
  const cio = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    cio.unobserve(e.target);
    const el = e.target, text = el.textContent, n = parseInt(text, 10);
    if (!/^\d{1,4}$/.test(text.trim()) || !n) return;
    const t0 = performance.now(), dur = 1100 + Math.min(n, 60) * 8;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur), v = Math.round(n * (1 - Math.pow(1 - k, 3)));
      el.textContent = k < 1 ? String(v) : text;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.4 });
  qa('.stat dd').forEach((el) => cio.observe(el));

  /* ---- parallax depth + header progress: one rAF per scroll frame ---- */
  if (matchMedia('(min-width: 1024px)').matches) qa('.hero__media').forEach((m) => { if (!m.dataset.depth) m.dataset.depth = '-0.06'; });
  const layers = qa('[data-depth]').map((el) => ({ el, k: parseFloat(el.dataset.depth) || 0, fixed: !!el.closest('.stage'), host: el.closest('section, .stage, header, footer') || el.parentElement }));
  const visible = new Set();
  const lio = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target))), { rootMargin: '120px 0px' });
  layers.forEach((l) => { if (!l.fixed) lio.observe(l.host); });
  let ticking = false;
  const frame = () => {
    ticking = false;
    const vh = innerHeight, y = scrollY;
    if (bar) { const max = R.scrollHeight - vh; bar.style.setProperty('--progress', max > 0 ? Math.min(1, y / max).toFixed(4) : 0); }
    for (const l of layers) {
      if (l.fixed) { l.el.style.backgroundPositionY = (-y * l.k).toFixed(1) + 'px'; continue; }
      if (!visible.has(l.host)) continue;
      const r = l.host.getBoundingClientRect();
      const off = (r.top + r.height / 2 - vh / 2) * l.k;
      const lim = Math.max(24, r.height * 0.07);
      l.el.style.translate = '0 ' + Math.max(-lim, Math.min(lim, -off)).toFixed(1) + 'px';
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  w.addEventListener('scroll', onScroll, { passive: true });
  w.addEventListener('resize', onScroll, { passive: true });
  frame();

  /* ---- contents scrollspy ---- */
  const tocLinks = qa('.toc a[href^="#"]');
  if (tocLinks.length) {
    const map = new Map();
    tocLinks.forEach((a) => { const t = d.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); if (t) map.set(t, a); });
    const sio = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      tocLinks.forEach((a) => a.classList.remove('is-active'));
      map.get(e.target)?.classList.add('is-active');
    }), { rootMargin: '0px 0px -70% 0px' });
    map.forEach((a, t) => sio.observe(t));
  }

  if (!fine) return; // pointer effects below

  /* ---- tilt + glare on cards ---- */
  const tilts = qa('main .pcard, main .tile > a, main .child-cards .card, main .band__aside');
  tilts.forEach((el) => {
    el.classList.add('has-tilt');
    let raf = 0;
    el.addEventListener('pointermove', (e) => {
      if (el.closest('[data-rv]')) return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transition = 'transform .12s linear, box-shadow .45s';
        el.style.transform = `perspective(900px) rotateX(${((0.5 - y) * 7).toFixed(2)}deg) rotateY(${((x - 0.5) * 9).toFixed(2)}deg) translateY(-6px)`;
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
    });
    el.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1), box-shadow .45s'; el.style.transform = ''; });
  });

  /* ---- spotlight on dark bands ---- */
  qa('.hero, .section--navy').forEach((s) => {
    if (!s.querySelector(':scope > .fx')) return;
    s.addEventListener('pointermove', (e) => { const r = s.getBoundingClientRect(); s.style.setProperty('--sx', (e.clientX - r.left).toFixed(0) + 'px'); s.style.setProperty('--sy', (e.clientY - r.top).toFixed(0) + 'px'); s.classList.add('is-lit'); });
    s.addEventListener('pointerleave', () => s.classList.remove('is-lit'));
  });
})();
