/* D2C Peptides: public/js/site.js (design agent). Plain script, loaded with defer, no frameworks, under 25 KB.
   Gate, header and menu, marquee, cart (localStorage, drawer, /cart/), product options, /checkout/, grid filters
   and sort, data-event analytics, /search/, lazy chatbot. Markup, JSON blocks (#site-data, #product-data) and
   data- attributes: _work/design/DATA-CONTRACT.md. API: window.D2C = { track(event, params), cart, openCart() }. */
(() => {
'use strict';
const d = document, w = window, R = d.documentElement, path = location.pathname;
const q = (s, el = d) => el.querySelector(s), qa = (s, el = d) => [...el.querySelectorAll(s)];
const on = (el, ev, fn, o) => el && el.addEventListener(ev, fn, o);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const num = v => parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const money = n => '$' + (+n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const json = id => parse(d.getElementById(id)?.textContent);
const load = k => { try { return parse(localStorage.getItem(k)); } catch (e) { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return 1; } catch (e) { return 0; } };
const val = v => (v && typeof v === 'object' ? v.value : v) || null;
const site = json('site-data') || {};
const svg = p => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${p}"/></svg>`;
const variant = it => [it.label !== 'Standard' && it.label, it.origin && 'Ships from ' + it.origin].filter(Boolean).join(' · ');
// fallback mount for /cart/, /checkout/ and /search/ without a hook: a new section at the end of <main>
const mount = () => { const s = d.createElement('section'); s.className = 'section'; s.innerHTML = '<div class="wrap"></div>'; (q('main') || d.body).append(s); return s.firstChild; };
R.classList.add('js');

/* ---- analytics: window.dataLayer when present, plus a d2c:track event on document ---- */
const track = (event, p) => {
  p = { event, ...p };
  if (Array.isArray(w.dataLayer)) w.dataLayer.push(p);
  d.dispatchEvent(new CustomEvent('d2c:track', { detail: p }));
};
// data-ev-product-id="x" on a [data-event] element adds { product_id: "x" }
const evParams = el => {
  const o = {};
  for (const k in el.dataset) if (/^ev[A-Z]/.test(k)) o[k.slice(2).replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase())] = el.dataset[k];
  return o;
};
// modal: lock page scroll and make everything else inert
const modal = (el, open) => {
  R.classList.toggle('is-locked', open);
  for (const c of d.body.children) if (c !== el && c.tagName !== 'SCRIPT') c.inert = open;
};

/* ---- research-use gate: first visit only; acceptance in localStorage, or a cookie when storage is blocked ---- */
const gate = q('.gate');
if (gate && !load('d2c_gate') && !/(^|;\s*)d2c_gate=1/.test(d.cookie)) {
  const boxes = qa('[type=checkbox]', gate), ok = q('[type=submit]', gate), leave = q('[data-action=gate-leave]', gate);
  const all = () => boxes.every(b => b.checked), sync = () => { if (ok) ok.disabled = !all(); };
  on(gate, 'change', sync);
  sync();
  on(q('form', gate), 'submit', e => {
    e.preventDefault();
    if (!all()) return;
    if (!save('d2c_gate', { v: 1, at: Date.now() })) d.cookie = 'd2c_gate=1; max-age=31536000; path=/; samesite=lax';
    gate.hidden = true;
    modal(gate, false);
    track('gate_accept');
  });
  on(leave, 'click', () => { location.href = leave.dataset.href || 'https://www.google.com/'; });
  gate.hidden = false;
  modal(gate, true);
  setTimeout(() => (boxes[0] || ok)?.focus(), 60);
}

/* ---- header: shadow once scrolled, mobile menu and search, tab-bar search ---- */
const hdr = q('.site-header'), mb = hdr && q('[data-action=menu]', hdr), sf = hdr && q('.search', hdr), si = sf && q('[name=q]', sf);
const menuOpen = () => !!hdr?.classList.contains('is-open');
const setMenu = open => {
  if (!mb) return;
  hdr.classList.toggle('is-open', open);
  R.classList.toggle('is-locked', open);
  mb.setAttribute('aria-expanded', open);
};
const openSearch = () => { if (menuOpen()) setMenu(false); sf.classList.add('is-open'); si.focus(); };
if (hdr) {
  const sc = () => hdr.classList.toggle('is-scrolled', scrollY > 4);
  on(w, 'scroll', sc, { passive: true });
  sc();
  on(mb, 'click', () => setMenu(!menuOpen()));
  on(d, 'keydown', e => { if (e.key === 'Escape' && menuOpen()) { setMenu(false); mb.focus(); } });
  const wide = matchMedia('(min-width: 860px)');
  on(wide, 'change', () => wide.matches && menuOpen() && setMenu(false));
}
if (si) {
  on(sf, 'submit', e => { if (!si.value.trim()) { e.preventDefault(); openSearch(); } });
  on(sf, 'focusout', () => setTimeout(() => { if (!sf.contains(d.activeElement) && !si.value.trim()) sf.classList.remove('is-open'); }, 150));
  on(sf, 'keydown', e => { if (e.key === 'Escape') { sf.classList.remove('is-open'); q('button', sf)?.focus(); } });
}
qa('[data-action=search]').forEach(b => on(b, 'click', () => { const m = q('main [name=q]'); m ? m.focus() : si && openSearch(); }));

/* ---- cart: localStorage store, drawer, /cart/ view ---- */
const cart = {
  items: [],
  read() { const v = load('d2c_cart'); this.items = (Array.isArray(v?.items) ? v.items : []).filter(x => x?.id && x.qty > 0 && isFinite(x.price)); },
  write() { save('d2c_cart', { v: 1, items: this.items }); paint(); d.dispatchEvent(new CustomEvent('d2c:cart', { detail: this.items })); },
  find(id) { return this.items.find(x => x.id === id); },
  add(it) {
    const id = [it.slug, it.key || '', it.origin || ''].join('|'), ex = this.find(id);
    if (ex) { ex.qty = Math.min(99, ex.qty + it.qty); ex.price = it.price; } else this.items.push({ id, ...it });
    this.write();
  },
  set(id, n) {
    const it = this.find(id);
    if (!it) return;
    n = Math.min(99, Math.max(0, n | 0));
    if (n) it.qty = n;
    else { this.items = this.items.filter(x => x !== it); track('remove_from_cart', { product_id: it.slug, variant_id: it.slug + '-' + it.key }); }
    this.write();
  },
  count() { return this.items.reduce((a, x) => a + x.qty, 0); },
  total() { return Math.round(this.items.reduce((a, x) => a + x.qty * x.price, 0) * 100) / 100; }
};
cart.read();
on(w, 'storage', e => { if (e.key === 'd2c_cart') { cart.read(); paint(); } });
// "Supplies you may need": supplies saved with peptide lines that are not in the cart yet (max 3)
const suggestions = () => {
  const have = new Set(cart.items.map(x => x.slug)), out = [];
  for (const it of cart.items) if (it.kind !== 'supply') for (const s of it.sup || []) if (s?.slug && !have.has(s.slug)) { have.add(s.slug); out.push(s); }
  return out.slice(0, 3);
};
const lineHTML = it => {
  const n = esc(it.name), u = it.url && esc(it.url + (it.kind !== 'supply' && it.key ? '?strength=' + encodeURIComponent(it.key) : ''));
  return `<li class="cartv__line" data-id="${esc(it.id)}">` + (it.image ? `<img class="cartv__img" src="${esc(it.image)}" alt="" width="68" height="68">` : '<span class="cartv__img"></span>') +
    `<div class="cartv__info">${u ? `<a class="cartv__name" href="${u}">${n}</a>` : `<span class="cartv__name">${n}</span>`}<span class="cartv__var">${esc(variant(it))}</span><span class="cartv__unit">${money(it.price)} each</span></div>` +
    `<div class="cartv__qty"><button type="button" data-q="-1" aria-label="Decrease quantity of ${n}">${svg('M3 8h10')}</button>` +
    `<input type="number" inputmode="numeric" min="1" max="99" value="${it.qty}" aria-label="Quantity of ${n}">` +
    `<button type="button" data-q="1" aria-label="Increase quantity of ${n}">${svg('M3 8h10M8 3v10')}</button></div>` +
    `<strong class="cartv__total">${money(it.price * it.qty)}</strong><button type="button" class="cartv__rm" data-rm aria-label="Remove ${n}">Remove</button></li>`;
};
// mode: drawer | page (/cart/) | summary (checkout, no buttons)
const cartHTML = mode => {
  if (!cart.items.length) return '<div class="empty cartv__empty"><p>Your cart is empty.</p><a class="btn btn--primary" href="/d2cpeptides-redesign/peptides/">Shop peptides</a></div>';
  const sug = suggestions(), label = val(site.research_use_label);
  const main = `<ul class="cartv__lines">${cart.items.map(lineHTML).join('')}</ul>` + (sug.length ? '<div class="cartv__sugg"><p class="cartv__h">Supplies you may need</p><ul>' +
    sug.map(s => `<li class="cartv__sug">${s.image ? `<img src="${esc(s.image)}" alt="" width="46" height="46">` : '<span></span>'}<span><a href="${esc(s.url)}">${esc(s.name)}</a><small>${money(s.price)}</small></span>` +
      `<button type="button" class="btn btn--ghost btn--sm" data-sug="${esc(s.slug)}"${s.in_stock === false ? ' disabled' : ''} aria-label="Add ${esc(s.name)} to cart">Add</button></li>`).join('') + '</ul></div>' : '');
  const side = `<div class="cartv__sum"><span>Subtotal</span><strong>${money(cart.total())}</strong></div>${label ? `<p class="cartv__fine">${esc(label)}</p>` : ''}` +
    (mode === 'summary' ? '' : `<div class="cartv__actions"><button type="button" class="btn btn--primary btn--block" data-go="/d2cpeptides-redesign/checkout/">Checkout</button>${mode === 'page' ? '' : '<button type="button" class="btn btn--ghost btn--block" data-go="/d2cpeptides-redesign/cart/">View cart</button>'}</div>`);
  return mode === 'page' ? `<div class="cartv cartv--page"><div class="cartv__main">${main}</div><div class="cartv__side">${side}</div></div>` : `<div class="cartv">${main}${side}</div>`;
};
let drawer = null, lastFocus = null;
// re-render the count and every cart view; put focus back on the same control of the same line
function paint() {
  const n = cart.count(), a = d.activeElement, m = a?.closest?.('[data-cart-view]'), l = m && a.closest('.cartv__line');
  const back = l && `[data-id="${l.dataset.id}"] ${a.dataset.q ? `[data-q="${a.dataset.q}"]` : a.tagName}`;
  qa('.cart-count').forEach(el => { el.textContent = n; el.hidden = !n; });
  qa('.cart-btn').forEach(b => b.setAttribute('aria-label', n ? `Cart, ${n} item${n > 1 ? 's' : ''}` : 'Cart, empty'));
  qa('[data-cart-view]').forEach(v => { v.innerHTML = cartHTML(v.dataset.cartView); });
  if (m && !m.contains(d.activeElement)) ((back && q(back, m)) || q('button, a', m))?.focus();
}
const bump = () => qa('.cart-count').forEach(c => { c.classList.remove('is-bump'); void c.offsetWidth; c.classList.add('is-bump'); });
const openDrawer = () => {
  if (!drawer) {
    d.body.insertAdjacentHTML('beforeend', '<div class="drawer" hidden><div class="drawer__scrim" data-close></div><div class="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1">' +
      `<div class="drawer__head"><p class="drawer__title" id="drawer-title">Your cart</p><button type="button" class="drawer__close" data-close aria-label="Close cart">${svg('M4 4l8 8M12 4l-8 8')}</button></div><div class="drawer__body" data-cart-view="drawer"></div></div></div>`);
    drawer = d.body.lastElementChild;
    on(drawer, 'keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  }
  if (menuOpen()) setMenu(false);
  if (drawer.hidden) lastFocus = d.activeElement;
  paint();
  drawer.hidden = false;
  modal(drawer, true);
  requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.add('is-open')));
  q('.drawer__panel', drawer).focus();
  track('view_cart', { value: cart.total() });
};
const closeDrawer = () => {
  if (!drawer || drawer.hidden) return;
  drawer.classList.remove('is-open');
  modal(drawer, false);
  setTimeout(() => { if (!drawer.classList.contains('is-open')) drawer.hidden = true; }, reduced ? 0 : 330);
  lastFocus?.focus?.();
};
const pageCart = q('[data-cart-view]') || (/^\/d2cpeptides\/cart\/?$/.test(path) ? mount() : null);
if (pageCart) pageCart.dataset.cartView = 'page';
paint();
const addSupply = slug => {
  for (const it of cart.items) for (const s of it.sup || []) if (s.slug === slug) {
    cart.add({ slug, name: s.name, url: s.url, image: s.image, kind: 'supply', key: s.key, label: s.label, origin: s.ship_from, price: s.price, qty: 1 });
    track('add_to_cart', { product_id: slug, variant_id: slug + '-' + s.key, price: s.price, quantity: 1 });
    return bump();
  }
};

/* ---- product page: strength and ship-from pills, price, stock, ?strength=, add to cart ---- */
const P = json('product-data');
if (P?.strengths?.length) {
  const box = q('.pdp') || d, sR = qa('[name=strength]', box), oR = qa('[name=ship_from]', box);
  const priceEl = q('[data-role=price]', box) || q('.pdp__price', box);
  const stockEl = q('[data-role=stock]', box) || q('.pdp__info .badge--stock, .pdp__info .badge--oos', box);
  const add = q('.pdp__add', box), qty = q('.pdp__qty input', box), form = add?.closest('form');
  const keyOf = r => r.dataset.strength || r.closest('[data-strength]')?.dataset.strength || r.value;
  const byKey = k => P.strengths.find(s => s.key === k), ck = sR.find(r => r.checked);
  let sel = byKey(new URLSearchParams(location.search).get('strength')) || byKey(P.default) || (ck && byKey(keyOf(ck))) || P.strengths.find(s => s.in_stock) || P.strengths[0];
  let origin = oR.find(r => r.checked)?.value || null;
  stockEl?.setAttribute('aria-live', 'polite');
  // auto (load or strength change): move off an out-of-stock origin when another origin has stock
  const pick = auto => {
    const opts = sel.options || [], has = o => o.ship_from === origin;
    if (!opts.some(has) || (auto && !opts.find(has).in_stock && opts.some(o => o.in_stock))) origin = (opts.find(o => o.in_stock) || opts[0])?.ship_from || null;
    const o = opts.find(has);
    return { opts, ok: o ? !!o.in_stock : !!sel.in_stock, price: o?.price ?? sel.price };
  };
  // checked and disabled pills are styled with :has(); out of stock depends on the strength, so it is a class
  const mark = (r, oos) => r.closest('.opt__choice')?.classList.toggle('is-oos', !!oos);
  const render = (user, auto) => {
    const s = pick(auto);
    sR.forEach(r => { const st = byKey(keyOf(r)); r.checked = st === sel; mark(r, st && !st.in_stock); });
    oR.forEach(r => { const o = s.opts.find(x => x.ship_from === r.value); r.disabled = !o; r.checked = r.value === origin; mark(r, o && !o.in_stock); });
    if (priceEl) priceEl.textContent = money(s.price);
    if (stockEl) { stockEl.textContent = s.ok ? 'In stock' : 'Out of stock'; stockEl.classList.toggle('badge--stock', s.ok); stockEl.classList.toggle('badge--oos', !s.ok); }
    if (add) { add.dataset.label ||= add.textContent.trim(); add.disabled = !s.ok; add.textContent = s.ok ? add.dataset.label : 'Out of stock'; }
    if (!user) return;
    if (P.strengths.length > 1) {
      const u = new URL(location.href);
      u.searchParams.set('strength', sel.key);
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
    track('variant_select', { product_id: P.slug, variant_id: P.slug + '-' + sel.key, ship_from: origin });
  };
  sR.forEach(r => on(r, 'change', () => { sel = byKey(keyOf(r)) || sel; render(1, 1); }));
  oR.forEach(r => on(r, 'change', () => { origin = r.value; render(1); }));
  const doAdd = e => {
    e.preventDefault();
    const s = pick(), n = Math.min(99, Math.max(1, parseInt(qty?.value, 10) || 1));
    if (!s.ok) return;
    cart.add({ slug: P.slug, name: P.name, url: P.url, image: P.image, kind: P.kind || 'peptide', key: sel.key, label: sel.label, origin, price: s.price, qty: n, sup: P.supplies || [] });
    track('add_to_cart', { product_id: P.slug, variant_id: P.slug + '-' + sel.key, price: s.price, quantity: n });
    openDrawer();
    bump();
  };
  form ? on(form, 'submit', doAdd) : on(add, 'click', doAdd);
  render(0, 1);
  track('product_view', { product_id: P.slug, group: P.kind || 'peptide', primary_category: P.category || '' });
}

/* ---- delegated: analytics hooks, cart buttons, drawer, cart lines ---- */
on(d, 'click', e => {
  const t = e.target;
  if (!t?.closest) return;
  const ev = t.closest('[data-event]'), go = t.closest('[data-go]'), sg = t.closest('[data-sug]');
  if (ev && ev.tagName !== 'DETAILS') track(ev.dataset.event, evParams(ev));
  if (t.closest('.cart-btn')) {
    e.preventDefault();
    return pageCart ? pageCart.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }) : openDrawer();
  }
  if (t.closest('[data-close]')) return closeDrawer();
  if (go) {
    if (/checkout/.test(go.dataset.go)) track('begin_checkout', { value: cart.total() });
    return location.href = go.dataset.go;
  }
  if (sg) return addSupply(sg.dataset.sug);
  const ln = t.closest('.cartv__line'), it = ln && cart.find(ln.dataset.id), b = t.closest('[data-q]');
  if (it && t.closest('[data-rm]')) cart.set(it.id, 0);
  else if (it && b) cart.set(it.id, it.qty + +b.dataset.q);
});
on(d, 'change', e => {
  const i = e.target.closest?.('.cartv__qty input');
  if (i) cart.set(i.closest('.cartv__line').dataset.id, parseInt(i.value, 10) || 0);
});
// <details data-event> (FAQ items): fires when opened
on(d, 'toggle', e => { const t = e.target; if (t.open && t.dataset?.event) track(t.dataset.event, evParams(t)); }, true);

/* ---- product grids: client-side category and stock filters and sort; the URL never changes ---- */
qa('.filters').forEach(bar => {
  const sc = bar.closest('[data-grid]') || bar.closest('section, main') || d.body, grid = q('.grid', sc);
  if (!grid) return;
  const items = qa('.pcard', grid).map((c, i) => {
    const ds = c.dataset;
    return {
      el: c.parentElement === grid ? c : c.parentElement, i,
      name: (ds.name || q('.pcard__name', c)?.textContent || '').trim().toLowerCase(),
      price: num(ds.price || q('.pcard__price', c)?.textContent), searches: num(ds.searches),
      stock: ds.instock ? !/^(0|false|no)$/i.test(ds.instock) : !q('.badge--oos', c), cats: (ds.categories || '').split(/[\s,]+/)
    };
  });
  const empty = q('.empty', sc), count = q('[data-role=count]', sc), sortEl = q('[data-sort]', sc);
  const S = { searches: (a, b) => b.searches - a.searches, 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, name: (a, b) => a.name.localeCompare(b.name) };
  const apply = () => {
    const v = {}, f = S[sortEl?.value];
    qa('[data-filter]', bar).forEach(el => {
      const x = el.tagName === 'BUTTON' ? el.getAttribute('aria-pressed') === 'true' && el.dataset.value : el.type === 'checkbox' ? el.checked && '1' : el.value;
      if (x && x !== 'all') v[el.dataset.filter] = x;
    });
    let n = 0;
    for (const it of items) n += !(it.el.hidden = !((!v.category || it.cats.includes(v.category)) && (!v.stock || it.stock)));
    items.slice().sort((a, b) => (f && f(a, b)) || a.i - b.i).forEach(it => grid.append(it.el));
    if (empty) empty.hidden = n > 0;
    if (count) count.textContent = n + (n === 1 ? ' product' : ' products');
  };
  // category buttons act like radio buttons; pressing the pressed one goes back to "all"
  on(bar, 'click', e => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    const same = qa('button[data-filter]', bar).filter(x => x.dataset.filter === b.dataset.filter);
    const p = (b.getAttribute('aria-pressed') === 'true' && same.find(x => x.dataset.value === 'all')) || b;
    same.forEach(x => x.setAttribute('aria-pressed', x === p));
    apply();
    track('filter_select', { filter: b.dataset.filter, value: p.dataset.value });
  });
  on(sc, 'change', e => {
    if (!e.target.closest('.filters, [data-sort]')) return;
    apply();
    if (e.target === sortEl) track('sort_select', { value: sortEl.value });
  });
  count?.setAttribute('aria-live', 'polite');
  apply();
});

/* ---- /checkout/: order summary; the template's form posts to checkout_endpoint or opens a prefilled email ---- */
const co = q('[data-checkout]') || (/^\/d2cpeptides\/checkout\/?$/.test(path) ? mount() : null);
if (co) {
  const ep = val(site.checkout_endpoint) || val(site.checkout?.endpoint), mail = val(site.email), brand = val(site.brand);
  // no form from the template (DATA-CONTRACT 5): the spec's notice with a prefilled email link, and the summary
  if (!q('form', co)) co.innerHTML = '<div class="checkout"><p class="note note--advice checkout__notice"></p><aside class="checkout__summary"></aside></div>';
  const form = q('form', co), note = !form && q('.checkout__notice', co), sum = q('.checkout__summary', co) || co.appendChild(d.createElement('aside'));
  if (form && !q('.checkout__msg', form)) form.insertAdjacentHTML('beforeend', '<p class="checkout__msg" role="status" hidden></p>');
  const msg = form && q('.checkout__msg', form);
  const say = (h, ok) => { msg.hidden = false; msg.className = 'checkout__msg ' + (ok ? 'is-ok' : 'is-err'); msg.innerHTML = h; };
  const L = a => a.filter(Boolean).join('\r\n');
  const mailto = (f = {}) => {
    const n = cart.count(), body = [L(['Order request', ...cart.items.map(i => `${i.qty} × ${i.name}${variant(i) ? ' (' + variant(i) + ')' : ''}: ${money(i.price)} each, ${money(i.price * i.qty)}`)]),
      'Subtotal: ' + money(cart.total()), L(['Ship to:', f.name, f.address1, f.address2, [f.city, f.state, f.zip].filter(Boolean).join(', ')]),
      L([f.email && 'Email: ' + f.email, f.phone && 'Phone: ' + f.phone, f.notes && 'Notes: ' + f.notes])].filter(Boolean).join('\r\n\r\n');
    return `mailto:${mail}?subject=${encodeURIComponent(`${brand ? brand + ' order' : 'Order'} request (${n} item${n > 1 ? 's' : ''})`)}&body=${encodeURIComponent(body)}`;
  };
  // the summary is a cart view (editable lines and subtotal, no buttons); paint() keeps it current
  sum.innerHTML = '<h2>Order summary</h2><div data-cart-view="summary"></div>';
  paint();
  const notice = () => { if (note) note.innerHTML = 'Online checkout is being connected. ' + (mail ? `Email your order to <a href="${esc(mailto())}">${esc(mail)}</a>.` : 'Send your order through the <a href="/d2cpeptides-redesign/contact/">contact page</a>.'); };
  notice();
  on(d, 'd2c:cart', notice);
  on(form, 'submit', async e => {
    e.preventDefault();
    if (!cart.items.length) return say('Your cart is empty.');
    if (!form.reportValidity()) return;
    const f = Object.fromEntries(new FormData(form)), total = cart.total(), b = q('[type=submit]', form);
    track('checkout_submit', { method: ep ? 'endpoint' : 'email', value: total, items: cart.count() });
    if (!ep) {
      if (!mail) return say('Online checkout is being connected. Send your order through the <a href="/d2cpeptides-redesign/contact/">contact page</a>.');
      say(`Your email app should open with the order filled in. If it did not, <a href="${esc(mailto(f))}">open the order email</a>.`, 1);
      return location.href = mailto(f);
    }
    if (b) b.disabled = true;
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        items: cart.items.map(i => ({ slug: i.slug, name: i.name, strength: i.key, label: i.label, ship_from: i.origin, price: i.price, qty: i.qty })), subtotal: total, customer: f }) });
      if (!r.ok) throw Error(r.status);
      cart.items = [];
      cart.write();
      form.reset();
      say('Thank you. Your order request was sent.', 1);
    } catch (err) {
      say('The order could not be sent.' + (mail ? ` Email it to <a href="${esc(mailto(f))}">${esc(mail)}</a> instead.` : ''));
    }
    if (b) b.disabled = false;
  });
}

/* ---- /search/: client-side search over /search-index.json ---- */
const out = q('[data-search-results]') || (/^\/d2cpeptides\/search\/?$/.test(path) ? mount() : null), sF = out && (q('main form.search') || sf), sIn = sF && q('[name=q]', sF);
if (sIn) {
  out.innerHTML = '<p class="search__count" role="status"></p><ol class="results"></ol>';
  const cnt = out.firstChild, list = out.lastChild;
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9.+\s-]/g, ' ');
  const flat = s => s.replace(/[^a-z0-9]/g, '');
  const kind = t => /^(product|supply)$/.test(t) ? 'Product' : /^(category|shop-hub|supplies-hub)$/.test(t) ? 'Shop' : /^blog/.test(t) ? 'Blog'
    : /city|location/.test(t) ? 'Location' : /profile|goal|compare|hub|learn|glossary|faq|guide|tool/.test(t) ? 'Learn' : 'Page';
  // whole-query name match first, then every word in a name (word start beats inside), then the summary
  const score = (e, terms, fq) => {
    const names = [e.title, ...(e.names || []), ...(e.aliases || [])].map(norm), fl = names.map(flat), sm = norm(e.summary);
    let s = fl.includes(fq) ? 40 : fl.some(n => n.startsWith(fq)) ? 20 : fq.length > 2 && fl.some(n => n.includes(fq)) ? 10 : 0, all = true;
    for (const t of terms) {
      let b = 0;
      for (const n of names) b = Math.max(b, n === t ? 12 : (' ' + n).includes(' ' + t) ? 6 : n.includes(t) ? 3 : 0);
      if (!b && sm.includes(t)) b = 1;
      all = all && b > 0;
      s += b;
    }
    return !all && s < 10 ? 0 : s + (/^(product|supply)$/.test(e.type) ? 4 : 0);
  };
  // split on the search words (a capture group puts the matches at odd indexes), escape every part
  const hl = (s, terms) => {
    const t = terms.filter(x => x.length > 1).sort((a, b) => b.length - a.length).map(x => x.replace(/[.+]/g, '\\$&'));
    return t.length ? String(s || '').split(new RegExp(`(${t.join('|')})`, 'i')).map((p, i) => i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join('') : esc(s);
  };
  const cut = s => (s = String(s || '')).length > 190 ? s.slice(0, s.lastIndexOf(' ', 186)) + '…' : s;
  let idx = null, timer = 0;
  const getIdx = () => idx || (idx = fetch('/d2cpeptides-redesign/search-index.json').then(r => r.json()).then(j => Array.isArray(j) ? j : j.items || j.pages || []).catch(() => { idx = null; return []; }));
  const run = async (raw, push) => {
    const qs = raw.trim(), terms = norm(qs).split(/\s+/).filter(Boolean), fq = flat(norm(qs));
    if (push) { const u = new URL(location.href); qs ? u.searchParams.set('q', qs) : u.searchParams.delete('q'); history.replaceState(history.state, '', u.pathname + u.search); }
    if (!fq) { cnt.textContent = ''; list.innerHTML = ''; return; }
    const data = await getIdx();
    if (sIn.value.trim() !== qs) return;
    const res = data.map(e => [score(e, terms, fq), e]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 40);
    cnt.textContent = (res.length ? res.length + (res.length === 1 ? ' result' : ' results') : 'No results') + ` for “${qs}”`;
    list.innerHTML = res.length ? res.map(([, e]) => `<li class="result"><span class="badge result__type">${kind(e.type)}</span><a href="${esc(e.url)}">${hl(e.title, terms)}</a>${e.summary ? `<p>${hl(cut(e.summary), terms)}</p>` : ''}</li>`).join('')
      : '<li class="empty">Try a shorter word, a product name or a category.</li>';
  };
  const tr = () => { const v = sIn.value.trim(); if (v) track('search', { search_term: v.slice(0, 100) }); };
  sIn.value = new URLSearchParams(location.search).get('q') || sIn.value;
  on(sF, 'submit', e => { e.preventDefault(); run(sIn.value, 1); tr(); });
  on(sIn, 'input', () => { clearTimeout(timer); timer = setTimeout(() => run(sIn.value, 1), 160); });
  if (sIn.value.trim()) { run(sIn.value); tr(); }
}

/* ---- chatbot: load data-src on idle or first interaction; a launcher click before it loads is replayed ----
   Every .chat-launcher (header and tab bar); st: 0 idle, 1 loading, 2 loaded, 3 failed (clicks go to /contact/) */
const chs = qa('.chat-launcher');
if (chs.length) {
  let st = q('script[src*="chatbot"]') ? 2 : 0, want = null;
  const go = () => {
    if (st) return;
    st = 1;
    const s = d.createElement('script');
    s.src = chs[0].dataset.src || '/d2cpeptides-redesign/js/chatbot.js';
    s.onload = s.onerror = e => {
      st = e.type === 'error' ? 3 : 2;
      chs.forEach(b => b.removeAttribute('aria-busy'));
      const b = want;
      want = null;
      if (b) st > 2 ? (location.href = '/d2cpeptides-redesign/contact/') : setTimeout(() => b.click(), 0);
    };
    d.body.append(s);
  };
  chs.forEach(b => on(b, 'click', e => {
    if (st === 2) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (st === 3) return location.href = '/d2cpeptides-redesign/contact/';
    want = b;
    b.setAttribute('aria-busy', 'true');
    go();
  }));
  const idle = () => (w.requestIdleCallback || (f => setTimeout(f, 2500)))(go, { timeout: 6000 });
  d.readyState === 'complete' ? idle() : on(w, 'load', idle);
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(t => on(w, t, go, { once: true, passive: true }));
}

/* ---- chat teaser (860px and up): a once-per-visit greeting above the floating launcher, so visitors see the chat.
   Waits for the research-use gate; a click opens the chat; x, or opening the chat, hides it for the visit. ---- */
const fab = q('.chat-launcher--tab');
const teased = () => { try { return sessionStorage.getItem('d2c_teaser') === '1'; } catch (e) { return false; } };
if (fab && !teased() && matchMedia('(min-width: 860px)').matches) {
  let tip = null, tries = 0;
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  const show = () => {
    const g = q('.gate');
    if (g && !g.hidden) { if (++tries < 120) setTimeout(show, 1000); return; }
    if (teased() || fab.getAttribute('aria-expanded') === 'true') return;
    try { sessionStorage.setItem('d2c_teaser', '1'); } catch (e) { /* storage blocked: once per page */ }
    tip = d.createElement('p');
    tip.className = 'chat-teaser';
    tip.innerHTML = '<strong>Questions?</strong>Ask about a product, a price, supplies or shipping.'
      + '<button class="chat-teaser__close" type="button" aria-label="Close">&times;</button>';
    on(tip, 'click', e => {
      const x = e.target.closest('.chat-teaser__close');
      hide();
      if (!x) { track('chat_teaser_open'); fab.click(); }
    });
    d.body.append(tip);
    track('chat_teaser_shown');
    setTimeout(hide, 15000);
  };
  on(fab, 'click', hide);
  on(d, 'd2c:chat-open', hide);
  setTimeout(show, 2500);
}
// keep the floating launcher off a product's Add to cart: while they would overlap, --fab-lift raises it (site.css)
const cta = q('.pdp__add');
if (fab && cta) {
  let raf = 0;
  // compare against the launcher's resting box (24px above the viewport bottom), not its animated one
  const lift = () => {
    raf = 0;
    const a = cta.getBoundingClientRect(), f = fab.getBoundingClientRect(), bot = innerHeight - 24;
    const hit = matchMedia('(min-width: 860px)').matches && a.width && a.right > f.left && a.left < f.right && a.bottom > bot - f.height && a.top < bot;
    const v = hit ? Math.ceil(bot - a.top + 12) + 'px' : '';
    if (R.style.getPropertyValue('--fab-lift') !== v) v ? R.style.setProperty('--fab-lift', v) : R.style.removeProperty('--fab-lift');
  };
  const req = () => { if (!raf) raf = requestAnimationFrame(lift); };
  on(w, 'scroll', req, { passive: true });
  on(w, 'resize', req);
  lift();
}

w.D2C = { track, cart, openCart: openDrawer };
})();
