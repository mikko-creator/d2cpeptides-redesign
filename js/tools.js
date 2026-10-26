/* D2C Peptides calculators (ENGINE-SPEC section 5). Plain script, no dependencies. src/lib/layout.mjs adds it
 * (defer) to pages whose <main> holds a calculator container:
 *
 *   <div class="calc" data-tool="peptide-calculator"> ...server-rendered no-JS fallback... </div>
 *   data-tool = peptide-calculator | reconstitution-calculator | units-converter
 *
 * Markup contract with the learn template (src/templates/learn.mjs renders a lead <p> and a <noscript> note): the
 * children of .calc stay, except the no-JS fallback, which gets the hidden attribute when the calculator renders:
 * [data-fallback], .calc__fallback, .calc__nojs, and any server-rendered .calc__form, .calc__out or .calc__formula
 * (<noscript> never shows with scripts on). The script then appends
 * .calc__form, .calc__out (the dark result panel, with dl results, errors and the syringe .calc__bar),
 * .calc__formula (the formula with the visitor's own numbers) and a note. Class names follow ENGINE-SPEC 4.2 and
 * public/css/site.css section 19; the few helper classes site.css does not style get zero-specificity defaults.
 *
 * Rules: arithmetic only, never a dose suggestion (inputs start empty, no example amounts anywhere); plain
 * validation messages; works without login; never changes the URL (no history or hash writes, forms never
 * submit); analytics push { event: 'tool_use', tool_slug } through window.D2C.track or window.dataLayer once per
 * new valid calculation, never the inputs.
 *
 * window.D2CTools.math holds the pure functions (tests: _work/tools/test-tools.mjs).
 */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.D2CTools && G.D2CTools.loaded) return;

  // =====================================================================================================
  // Math (pure, no DOM)
  // =====================================================================================================
  const UNITS_PER_ML = 100;   // U-100 syringe scale: 100 units = 1 mL, so 1 unit = 0.01 mL
  const MCG_PER_MG = 1000;
  const SYRINGES = [0.3, 0.5, 1]; // mL (30, 50 and 100 units)
  const MAX = { mg: 10000, mcg: 10000000, iu: 1000000, ml: 100, units: 10000, factor: 1000000 };
  const UNIT_WORD = { mg: 'mg', mcg: 'mcg', iu: 'IU', ml: 'mL', units: 'units' };

  // A visitor's number: digits with an optional decimal point (a comma decimal or thousands commas are accepted).
  function parseNum(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
    if (!s) return { empty: true };
    if (/^[-\u2212]/.test(s)) return { negative: true };
    s = s.replace(/^\+/, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d*,\d+$/.test(s)) s = s.replace(',', '.');
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { invalid: true };
    const v = parseFloat(s);
    return Number.isFinite(v) ? { value: v } : { invalid: true };
  }

  // Validate one field: { value } | { empty: true } | { error }
  function check(raw, label, max, unit) {
    const p = parseNum(raw);
    if (p.empty) return { empty: true };
    if (p.negative) return { error: label + ' must be more than 0.' };
    if (p.invalid) return { error: label + ': use digits and a decimal point only.' };
    if (!(p.value > 0)) return { error: label + ' must be more than 0.' };
    if (p.value > max) return { error: label + ' must be ' + fmt(max) + ' ' + (UNIT_WORD[unit] || unit) + ' or less.' };
    return { value: p.value };
  }

  const toMg = (v, unit) => (unit === 'mcg' ? v / MCG_PER_MG : v);

  // Peptide calculator: { vialMg, waterMl, amount?, unit: 'mg'|'mcg', syringeMl? }
  function peptide(o) {
    const conc = o.vialMg / o.waterMl; // mg per mL
    const r = { concMgMl: conc, concMcgMl: conc * MCG_PER_MG, mcgPerUnit: conc * MCG_PER_MG / UNITS_PER_ML };
    if (o.amount != null) {
      const mg = toMg(o.amount, o.unit);
      r.amountMg = mg;
      r.overVial = mg > o.vialMg * (1 + 1e-9);
      r.volumeMl = mg / conc;
      r.units = r.volumeMl * UNITS_PER_ML;
      if (o.syringeMl) {
        r.capacityUnits = o.syringeMl * UNITS_PER_ML;
        r.fillPct = Math.min(100, (r.units / r.capacityUnits) * 100);
        r.overSyringe = r.units > r.capacityUnits * (1 + 1e-9);
      }
    }
    return r;
  }

  // Reconstitution: { amount, unit: 'mg'|'mcg'|'iu', waterMl } -> amount per mL, per 10 units (0.1 mL), per unit
  function reconstitution(o) {
    const perMl = o.amount / o.waterMl;
    return { unit: o.unit, perMl, per10Units: (perMl * 10) / UNITS_PER_ML, perUnit: perMl / UNITS_PER_ML };
  }

  const convertMass = (v, from) => (from === 'mcg' ? { mg: v / MCG_PER_MG, mcg: v } : { mg: v, mcg: v * MCG_PER_MG });
  const convertVolume = (v, from) => (from === 'units' ? { ml: v / UNITS_PER_ML, units: v } : { ml: v, units: v * UNITS_PER_ML });
  // IU measure activity, not mass: no conversion without the product's own factor (IU per mg)
  function convertIu(v, from, iuPerMg) {
    if (!(iuPerMg > 0)) return null;
    return from === 'mg' ? { mg: v, iu: v * iuPerMg } : { iu: v, mg: v / iuPerMg };
  }

  // 2.5, 0.1, 0.0125, 2,500, 33.33: at least two decimals of headroom, at most 6
  function fmt(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    if (n === 0) return '0';
    const dec = Math.min(6, Math.max(2, 3 - Math.floor(Math.log10(Math.abs(n)))));
    return n.toLocaleString('en-US', { maximumFractionDigits: dec });
  }
  const amt = (v, unit) => fmt(v) + ' ' + (UNIT_WORD[unit] || unit);

  const math = { UNITS_PER_ML, MCG_PER_MG, SYRINGES, MAX, parseNum, check, toMg, peptide, reconstitution, convertMass, convertVolume, convertIu, fmt };
  G.D2CTools = { loaded: true, version: 1, math };

  // =====================================================================================================
  // UI (browser only)
  // =====================================================================================================
  if (typeof document === 'undefined') return;
  const d = document;
  const X = '\u00d7'; // multiplication sign
  let seq = 0;

  function h(tag, attrs, kids) {
    const e = d.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids || []) if (c != null) e.appendChild(typeof c === 'string' ? d.createTextNode(c) : c);
    return e;
  }

  function track(slug) {
    const p = { tool_slug: slug };
    try {
      if (G.D2C && typeof G.D2C.track === 'function') G.D2C.track('tool_use', p);
      else if (Array.isArray(G.dataLayer)) G.dataLayer.push(Object.assign({ event: 'tool_use' }, p));
    } catch (e) { /* analytics never breaks a calculator */ }
  }

  function injectStyles() {
    if (d.getElementById('d2c-tools-css')) return;
    const s = d.createElement('style');
    s.id = 'd2c-tools-css';
    // zero-specificity defaults (:where) for helper classes; public/css/site.css wins wherever it styles them
    s.textContent = [
      ':where(.calc__field){display:grid;gap:6px;align-content:start;min-width:0}',
      ':where(.calc__form fieldset){display:grid;gap:12px;min-width:0}',
      ':where(.calc__pair){display:flex;gap:8px}',
      ':where(.calc__pair)>input{flex:1 1 auto;min-width:0}',
      ':where(.calc__pair)>select{flex:0 0 6.8em;min-width:0}',
      ':where(.calc__actions){display:flex;flex-wrap:wrap;gap:10px;margin:0}',
      ':where(.calc__hint){margin:0;font-size:.86rem;line-height:1.5;color:var(--muted-2,#4a5873)}',
      ':where(.calc [aria-invalid="true"]){border-color:var(--red-ink,#c2232f);box-shadow:0 0 0 2px rgba(194,35,47,.16)}',
      ':where(.calc__out p){margin:0}',
      ':where(.calc__out)>*+*{margin-top:14px}',
      ':where(.calc__out dd small){display:block;margin-top:5px;font:600 .8rem/1.35 var(--font,Inter,system-ui,sans-serif);color:var(--on-dark-2,rgba(246,241,231,.7))}',
      ':where(.calc__u){font:600 .56em/1 var(--font,Inter,system-ui,sans-serif);letter-spacing:0}',
      ':where(.calc__error p+p){margin-top:4px}',
      ':where(.calc__bar){--ticks:10}',
      ':where(.calc__bar)::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,transparent 0 calc(100% / var(--ticks) - 1px),rgba(246,241,231,.4) calc(100% / var(--ticks) - 1px) calc(100% / var(--ticks)))}',
      ':where(.calc__barlabel){margin-top:8px;font-size:.88rem}',
      ':where(.calc__formula>div+div){margin-top:3px}',
      ':where(.calc__formula strong){font-family:var(--font,Inter,system-ui,sans-serif)}',
      ':where(.calc__note){margin:0}',
      ':where(.calc__sr){position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}',
    ].join('\n');
    d.head.appendChild(s);
  }

  // ---------- shared building blocks ----------
  function numInput(id) {
    return h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', maxlength: 14 });
  }
  function field(id, label, hint) {
    const input = numInput(id);
    const wrap = h('div', { class: 'calc__field' }, [h('label', { for: id }, [label, hint ? h('span', { text: hint }) : null]), input]);
    return { wrap, input, label };
  }
  function pairField(id, label, hint, units, def) {
    const input = numInput(id);
    const select = h('select', { id: id + '-unit', 'aria-label': label + ', unit' },
      units.map(u => h('option', { value: u, selected: u === def }, [UNIT_WORD[u]])));
    const wrap = h('div', { class: 'calc__field' }, [h('label', { for: id }, [label, hint ? h('span', { text: hint }) : null]), h('span', { class: 'calc__pair' }, [input, select])]);
    return { wrap, input, select, label };
  }
  function syringeField(id) {
    const radios = [];
    const choices = SYRINGES.map(ml => {
      const r = h('input', { type: 'radio', name: id, value: ml, checked: ml === 1 });
      radios.push(r);
      return h('label', { class: 'opt__choice' }, [r, fmt(ml) + ' mL', h('small', { text: fmt(ml * UNITS_PER_ML) + ' units' })]);
    });
    const wrap = h('fieldset', { class: 'calc__wide' }, [h('legend', { class: 'opt__label', text: 'Syringe size (U-100)' }), h('div', { class: 'opt__choices' }, choices)]);
    return { wrap, radios, value: () => { const c = radios.find(r => r.checked); return c ? Number(c.value) : 1; } };
  }
  function actions() {
    const clear = h('button', { type: 'button', class: 'btn btn--ghost', text: 'Clear' });
    return { wrap: h('p', { class: 'calc__actions' }, [h('button', { type: 'submit', class: 'btn btn--primary', text: 'Calculate' }), clear]), clear };
  }
  function resultItem(key, label) {
    const v = h('span');
    const alt = h('small');
    const item = h('div', { 'data-k': key, hidden: true }, [h('dt', { text: label }), h('dd', null, [v, alt])]);
    return {
      item,
      set(main, small) {
        // "2.5 mg/mL": the number large, its unit smaller so the pair stays on one line
        const m = /^(\S+) (.+)$/.exec(main);
        v.textContent = m ? m[1] + ' ' : main;
        if (m) v.appendChild(h('span', { class: 'calc__u', text: m[2] }));
        alt.textContent = small || '';
        alt.hidden = !small;
        item.hidden = false;
      },
      hide() { item.hidden = true; },
    };
  }

  // One calculator instance: form + result panel + formula + note, with validation, status and analytics.
  function frame(root, slug, formKids, items, extraOut) {
    const form = h('form', { class: 'calc__form', novalidate: true, 'aria-label': (root.getAttribute('aria-label') || labelFor(slug)) + ' inputs' }, formKids);
    const errors = h('div', { class: 'calc__error', hidden: true });
    const prompt = h('p', { class: 'calc__prompt' });
    const dl = h('dl', null, items.map(i => i.item));
    const status = h('p', { class: 'calc__sr', role: 'status', 'aria-live': 'polite' });
    const out = h('div', { class: 'calc__out' }, [h('p', null, [h('strong', { text: 'Results' })]), errors, prompt, dl].concat(extraOut || [], [status]));
    const formula = h('div', { class: 'calc__formula', hidden: true });
    const note = h('p', { class: 'note note--advice calc__note', text: 'Arithmetic only, from the numbers you enter. It is not a dose or a recommendation.' });
    for (const e of [form, out, formula, note]) e.setAttribute('data-calc-gen', '');
    root.append(form, out, formula, note);
    let timer = 0, lastSig = '';
    const F = {
      form, out, errors, prompt, dl, status, formula,
      showErrors(list) {
        errors.textContent = '';
        for (const e of list) errors.appendChild(h('p', { id: e.id || null, text: e.text }));
        errors.hidden = !list.length;
      },
      setPrompt(text) { prompt.textContent = text || ''; prompt.hidden = !text; },
      setFormula(lines) {
        formula.textContent = '';
        if (!lines || !lines.length) { formula.hidden = true; return; }
        formula.appendChild(h('div', null, [h('strong', { text: 'The formula with your numbers' })]));
        for (const l of lines) formula.appendChild(h('div', { text: l }));
        formula.hidden = false;
      },
      // status for screen readers (debounced while typing) and one tool_use per new valid calculation
      report(text, sig, now) {
        clearTimeout(timer);
        const run = () => {
          status.textContent = text;
          if (sig && sig !== lastSig) { lastSig = sig; track(slug); }
        };
        if (now) run(); else timer = setTimeout(run, 900);
      },
    };
    return F;
  }
  function labelFor(slug) { return { 'peptide-calculator': 'Peptide calculator', 'reconstitution-calculator': 'Reconstitution calculator', 'units-converter': 'Units converter' }[slug] || 'Calculator'; }

  // mark one input valid or invalid; returns the error entry or null
  function verdict(input, res, errs) {
    if (res.error) {
      const id = input.id + '-err';
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', id);
      errs.push({ id, text: res.error });
      return true;
    }
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    return false;
  }

  function wire(F, inputs, compute, clearBtn) {
    const run = now => compute(now === true);
    for (const el of inputs) el.addEventListener(el.tagName === 'INPUT' && el.type === 'radio' ? 'change' : el.tagName === 'SELECT' ? 'change' : 'input', () => run(false));
    F.form.addEventListener('submit', e => { e.preventDefault(); run(true); });
    clearBtn.addEventListener('click', () => {
      for (const el of inputs) if (el.tagName === 'INPUT' && el.type !== 'radio') el.value = '';
      run(true);
      const first = inputs.find(el => el.tagName === 'INPUT' && el.type !== 'radio');
      if (first) first.focus();
    });
    run(false);
  }

  // ---------- peptide calculator ----------
  function peptideCalculator(root, id) {
    const vial = field(id + '-vial', 'Peptide in the vial', 'mg, as printed on the vial');
    const water = field(id + '-water', 'Water added', 'mL of diluent');
    const amount = pairField(id + '-amt', 'Amount to measure', 'in mcg or mg', ['mcg', 'mg'], 'mcg');
    const syr = syringeField(id + '-syr');
    const act = actions();
    const hint = h('p', { class: 'calc__hint', text: 'Vial labeled in IU? IU do not convert to mg; the reconstitution calculator works in IU per mL.' });
    const R = { conc: resultItem('concentration', 'Concentration'), unit: resultItem('per-unit', 'Per unit'), vol: resultItem('volume', 'Volume'), units: resultItem('units', 'Syringe units') };
    const fill = h('span', { style: 'width:0%' });
    const bar = h('div', { class: 'calc__bar', 'aria-hidden': 'true' }, [fill]);
    const barLabel = h('p', { class: 'calc__barlabel' });
    const syringe = h('div', { class: 'calc__syringe', hidden: true }, [bar, barLabel]);
    const F = frame(root, 'peptide-calculator', [vial.wrap, water.wrap, amount.wrap, syr.wrap, hint, act.wrap], [R.conc, R.unit, R.vol, R.units], [syringe]);

    function compute(now) {
      const errs = [];
      const unit = amount.select.value === 'mg' ? 'mg' : 'mcg';
      const v = check(vial.input.value, 'Peptide in the vial', MAX.mg, 'mg');
      const w = check(water.input.value, 'Water added', MAX.ml, 'ml');
      let a = check(amount.input.value, 'Amount to measure', unit === 'mcg' ? MAX.mcg : MAX.mg, unit);
      verdict(vial.input, v, errs); verdict(water.input, w, errs); verdict(amount.input, a, errs);
      const ml = syr.value();
      let r = null;
      if (v.value && w.value) {
        r = peptide({ vialMg: v.value, waterMl: w.value, amount: a.value || null, unit, syringeMl: ml });
        if (a.value && r.overVial) {
          verdict(amount.input, { error: 'x' }, []);
          errs.push({ id: amount.input.id + '-err', text: 'The amount to measure (' + amt(a.value, unit) + ') is more than the vial holds (' + amt(v.value, 'mg') + ').' });
          a = { error: true };
        }
      }
      F.showErrors(errs);
      if (!r) {
        Object.values(R).forEach(i => i.hide());
        syringe.hidden = true;
        F.setFormula(null);
        const miss = [!v.value && !v.error && 'the peptide in the vial', !w.value && !w.error && 'the water added'].filter(Boolean);
        F.setPrompt(miss.length ? 'Enter ' + miss.join(' and ') + ' to see the concentration.' : '');
        F.report(errs.map(e => e.text).join(' '), '', now);
        return;
      }
      R.conc.set(amt(r.concMgMl, 'mg') + '/mL', fmt(r.concMcgMl) + ' mcg/mL');
      R.unit.set(amt(r.mcgPerUnit, 'mcg'), 'in 0.01 mL');
      const lines = ['Concentration = ' + amt(v.value, 'mg') + ' / ' + amt(w.value, 'ml') + ' = ' + amt(r.concMgMl, 'mg') + '/mL (' + fmt(r.concMcgMl) + ' mcg/mL)'];
      lines.push('Per unit = ' + fmt(r.concMcgMl) + ' mcg/mL / ' + UNITS_PER_ML + ' units per mL = ' + amt(r.mcgPerUnit, 'mcg'));
      let summary = 'Concentration ' + amt(r.concMgMl, 'mg') + ' per mL, ' + amt(r.mcgPerUnit, 'mcg') + ' per unit.';
      if (a.value) {
        R.vol.set(amt(r.volumeMl, 'ml'));
        R.units.set(amt(r.units, 'units'), 'on a U-100 syringe');
        if (unit === 'mcg') lines.push('Amount in mg = ' + amt(a.value, 'mcg') + ' / 1,000 = ' + amt(r.amountMg, 'mg'));
        lines.push('Volume = ' + amt(r.amountMg, 'mg') + ' / ' + amt(r.concMgMl, 'mg') + '/mL = ' + amt(r.volumeMl, 'ml'));
        lines.push('Syringe units = ' + amt(r.volumeMl, 'ml') + ' ' + X + ' ' + UNITS_PER_ML + ' = ' + amt(r.units, 'units') + ' (U-100: 1 unit = 0.01 mL)');
        const pct = r.units > 0 ? Math.max(0.8, r.fillPct) : 0;
        fill.style.width = pct.toFixed(2) + '%';
        bar.style.setProperty('--ticks', String(ml === 0.3 ? 6 : 10));
        barLabel.textContent = r.overSyringe
          ? amt(r.units, 'units') + ' is more than a ' + fmt(ml) + ' mL syringe holds (' + fmt(r.capacityUnits) + ' units).'
          : amt(r.units, 'units') + ' of ' + fmt(r.capacityUnits) + ' on a ' + fmt(ml) + ' mL syringe (' + fmt(Math.round(r.fillPct * 10) / 10) + '% full).';
        syringe.hidden = false;
        F.setPrompt('');
        summary += ' Volume ' + amt(r.volumeMl, 'ml') + ', ' + amt(r.units, 'units') + '.' + (r.overSyringe ? ' ' + barLabel.textContent : '');
      } else {
        R.vol.hide(); R.units.hide();
        syringe.hidden = true;
        F.setPrompt(a.error ? '' : 'Add the amount to measure to see the volume and syringe units.');
      }
      F.setFormula(lines);
      const sig = errs.length ? '' : [v.value, w.value, a.value || '', unit, a.value ? ml : ''].join('|');
      F.report(errs.length ? errs.map(e => e.text).join(' ') : summary, sig, now);
    }
    wire(F, [vial.input, water.input, amount.input, amount.select, ...syr.radios], compute, act.clear);
  }

  // ---------- reconstitution calculator ----------
  function reconstitutionCalculator(root, id) {
    const amount = pairField(id + '-amt', 'Amount in the vial', 'as printed on the vial', ['mg', 'mcg', 'iu'], 'mg');
    const water = field(id + '-water', 'Water added', 'mL of diluent');
    const act = actions();
    const R = { ml: resultItem('per-ml', 'Per mL'), ten: resultItem('per-10-units', 'Per 10 units'), one: resultItem('per-unit', 'Per unit') };
    const F = frame(root, 'reconstitution-calculator', [amount.wrap, water.wrap, act.wrap], [R.ml, R.ten, R.one]);
    function compute(now) {
      const errs = [];
      const unit = ['mg', 'mcg', 'iu'].includes(amount.select.value) ? amount.select.value : 'mg';
      const a = check(amount.input.value, 'Amount in the vial', MAX[unit], unit);
      const w = check(water.input.value, 'Water added', MAX.ml, 'ml');
      verdict(amount.input, a, errs); verdict(water.input, w, errs);
      F.showErrors(errs);
      if (!(a.value && w.value)) {
        Object.values(R).forEach(i => i.hide());
        F.setFormula(null);
        const miss = [!a.value && !a.error && 'the amount in the vial', !w.value && !w.error && 'the water added'].filter(Boolean);
        F.setPrompt(miss.length ? 'Enter ' + miss.join(' and ') + ' to see the concentration.' : '');
        F.report(errs.map(e => e.text).join(' '), '', now);
        return;
      }
      const r = reconstitution({ amount: a.value, unit, waterMl: w.value });
      // the other mass unit as a second line (IU has none: it does not convert to mass)
      const alt = v => (unit === 'mg' ? amt(v * MCG_PER_MG, 'mcg') : unit === 'mcg' ? amt(v / MCG_PER_MG, 'mg') : '');
      const withVol = (v, vol) => [alt(v), 'in ' + vol].filter(Boolean).join(', ');
      R.ml.set(amt(r.perMl, unit), alt(r.perMl));
      R.ten.set(amt(r.per10Units, unit), withVol(r.per10Units, '0.1 mL'));
      R.one.set(amt(r.perUnit, unit), withVol(r.perUnit, '0.01 mL'));
      F.setPrompt(unit === 'iu' ? 'IU stay in IU: they do not convert to mg without a factor for the specific product.' : '');
      F.setFormula([
        'Concentration = ' + amt(a.value, unit) + ' / ' + amt(w.value, 'ml') + ' = ' + amt(r.perMl, unit) + ' per mL',
        'Per 10 units = ' + amt(r.perMl, unit) + ' per mL ' + X + ' 0.1 mL = ' + amt(r.per10Units, unit),
        'Per unit = ' + amt(r.perMl, unit) + ' per mL ' + X + ' 0.01 mL = ' + amt(r.perUnit, unit),
      ]);
      F.report(amt(r.perMl, unit) + ' per mL, ' + amt(r.per10Units, unit) + ' per 10 units, ' + amt(r.perUnit, unit) + ' per unit.', [a.value, unit, w.value].join('|'), now);
    }
    wire(F, [amount.input, amount.select, water.input], compute, act.clear);
  }

  // ---------- units converter ----------
  function unitsConverter(root, id) {
    const mass = pairField(id + '-mass', 'Amount', 'mg or mcg', ['mg', 'mcg'], 'mg');
    const vol = pairField(id + '-vol', 'Amount', 'mL or units on a U-100 syringe', ['ml', 'units'], 'ml');
    const factor = field(id + '-factor', 'IU per mg for this product', 'only a factor stated for this specific product');
    const iu = pairField(id + '-iu', 'Amount', 'IU or mg', ['iu', 'mg'], 'iu');
    const act = actions();
    const fsMass = h('fieldset', null, [h('legend', { class: 'opt__label', text: 'mg and mcg' }), mass.wrap]);
    const fsVol = h('fieldset', null, [h('legend', { class: 'opt__label', text: 'mL and syringe units' }), vol.wrap]);
    const fsIu = h('fieldset', null, [h('legend', { class: 'opt__label', text: 'IU (international units)' }),
      h('p', { class: 'calc__hint', text: 'An IU measures biological activity, not mass. How many IU make up 1 mg is different for each product, so IU convert to mg only with a factor stated for that specific product. Without one, there is no conversion.' }),
      factor.wrap, iu.wrap]);
    const R = { mass: resultItem('mass', 'mg and mcg'), vol: resultItem('volume', 'mL and units'), iu: resultItem('iu', 'IU') };
    const F = frame(root, 'units-converter', [fsMass, fsVol, fsIu, act.wrap], [R.mass, R.vol, R.iu]);
    function compute(now) {
      const errs = [], lines = [], said = [], sig = [];
      const mu = mass.select.value === 'mcg' ? 'mcg' : 'mg';
      const m = check(mass.input.value, 'mg and mcg amount', MAX[mu], mu);
      const vu = vol.select.value === 'units' ? 'units' : 'ml';
      const v = check(vol.input.value, 'mL and units amount', MAX[vu], vu);
      const f = check(factor.input.value, 'IU per mg', MAX.factor, 'iu');
      const iuU = iu.select.value === 'mg' ? 'mg' : 'iu';
      const i = check(iu.input.value, 'IU amount', MAX[iuU], iuU);
      verdict(mass.input, m, errs); verdict(vol.input, v, errs); verdict(factor.input, f, errs); verdict(iu.input, i, errs);
      F.showErrors(errs);
      if (m.value) {
        const c = convertMass(m.value, mu);
        if (mu === 'mg') { R.mass.set(amt(c.mcg, 'mcg'), 'from ' + amt(c.mg, 'mg')); lines.push('mcg = mg ' + X + ' 1,000: ' + fmt(c.mg) + ' ' + X + ' 1,000 = ' + amt(c.mcg, 'mcg')); }
        else { R.mass.set(amt(c.mg, 'mg'), 'from ' + amt(c.mcg, 'mcg')); lines.push('mg = mcg / 1,000: ' + fmt(c.mcg) + ' / 1,000 = ' + amt(c.mg, 'mg')); }
        said.push(mu === 'mg' ? amt(c.mg, 'mg') + ' = ' + amt(c.mcg, 'mcg') : amt(c.mcg, 'mcg') + ' = ' + amt(c.mg, 'mg'));
        sig.push('m', m.value, mu);
      } else R.mass.hide();
      if (v.value) {
        const c = convertVolume(v.value, vu);
        if (vu === 'ml') { R.vol.set(amt(c.units, 'units'), 'from ' + amt(c.ml, 'ml')); lines.push('units = mL ' + X + ' 100 (U-100): ' + fmt(c.ml) + ' ' + X + ' 100 = ' + amt(c.units, 'units')); }
        else { R.vol.set(amt(c.ml, 'ml'), 'from ' + amt(c.units, 'units')); lines.push('mL = units / 100 (U-100): ' + fmt(c.units) + ' / 100 = ' + amt(c.ml, 'ml')); }
        said.push(vu === 'ml' ? amt(c.ml, 'ml') + ' = ' + amt(c.units, 'units') : amt(c.units, 'units') + ' = ' + amt(c.ml, 'ml'));
        sig.push('v', v.value, vu);
      } else R.vol.hide();
      let iuNote = '';
      if (i.value && f.value) {
        const c = convertIu(i.value, iuU, f.value);
        if (iuU === 'iu') { R.iu.set(amt(c.mg, 'mg'), 'from ' + amt(c.iu, 'iu') + ' at ' + fmt(f.value) + ' IU per mg'); lines.push('mg = IU / factor: ' + fmt(c.iu) + ' / ' + fmt(f.value) + ' = ' + amt(c.mg, 'mg')); }
        else { R.iu.set(amt(c.iu, 'iu'), 'from ' + amt(c.mg, 'mg') + ' at ' + fmt(f.value) + ' IU per mg'); lines.push('IU = mg ' + X + ' factor: ' + fmt(c.mg) + ' ' + X + ' ' + fmt(f.value) + ' = ' + amt(c.iu, 'iu')); }
        said.push(iuU === 'iu' ? amt(c.iu, 'iu') + ' = ' + amt(c.mg, 'mg') : amt(c.mg, 'mg') + ' = ' + amt(c.iu, 'iu'));
        sig.push('i', i.value, iuU, f.value);
      } else {
        R.iu.hide();
        if (i.value && !f.error) iuNote = 'IU cannot be converted to mg without the factor for that specific product.';
      }
      const any = !!(m.value || v.value || (i.value && f.value));
      F.setPrompt(iuNote || (!any && !errs.length ? 'Enter an amount in any section to convert it.' : ''));
      F.setFormula(lines);
      const text = errs.length ? errs.map(e => e.text).join(' ') : said.concat(iuNote ? [iuNote] : []).map(s => (/[.?!]$/.test(s) ? s : s + '.')).join(' ');
      F.report(text, errs.length || !sig.length ? '' : sig.join('|'), now);
    }
    wire(F, [mass.input, mass.select, vol.input, vol.select, factor.input, iu.input, iu.select], compute, act.clear);
  }

  const TOOLS = { 'peptide-calculator': peptideCalculator, 'reconstitution-calculator': reconstitutionCalculator, 'units-converter': unitsConverter };

  function mount(root) {
    if (!root || root.hasAttribute('data-calc-ready')) return;
    const build = TOOLS[root.getAttribute('data-tool')];
    if (!build) return;
    root.setAttribute('data-calc-ready', '');
    injectStyles();
    // hide the server-rendered no-JS fallback; the lead text and headings stay
    Array.from(root.children).forEach(c => {
      if (!c.matches('[data-fallback], .calc__fallback, .calc__nojs, .calc__form, .calc__out, .calc__formula')) return;
      c.hidden = true;
      c.setAttribute('data-calc-fallback', '');
    });
    try { build(root, 'calc' + ++seq); } catch (e) {
      // fail visible: show the fallback again rather than a half-built calculator
      root.querySelectorAll('[data-calc-gen]').forEach(c => c.remove());
      root.querySelectorAll('[data-calc-fallback]').forEach(c => { c.hidden = false; });
      if (G.console) G.console.error('calculator failed', e);
    }
  }

  function init() { d.querySelectorAll('.calc[data-tool]').forEach(mount); }
  G.D2CTools.init = init;
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
