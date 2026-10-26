/* D2C Peptides chatbot: a client-side, rule-based product finder and question bot (ENGINE-SPEC section 5).
 *
 * Facts come only from /chat-index.json (built by src/lib/chatindex.mjs from the catalog and the published pages).
 * The bot quotes a catalog record, a page summary or an FAQ answer and links the page; everything else goes to the
 * hand-off (/contact/). Guardrails, enforced in code below:
 *   - no dose or health advice for a person (dosage questions: quote the reviewed page, link it, offer the hand-off;
 *     a question about the asker's own dose gets the link and the hand-off, never a number);
 *   - no opinion on legal or prescription status (hand-off);
 *   - GLP-1 research vials are never presented as prescriptions, generics or substitutes, and brand-name questions
 *     never get a research vial, price or product link in the answer;
 *   - names only catalog products and real listed locations (none today, so location answers point to the city
 *     page, /locations/ and shipping).
 *
 * Loading: this file is meant to be loaded lazily (on idle or on the first .chat-launcher click). It binds every
 * .chat-launcher, builds the panel on first open and fetches the index then. To open the panel right after a
 * click-triggered load, set window.__d2cChatOpen = true (or data-open on the script tag) before loading it, or call
 * window.D2CChat.open(). It also listens for a "d2c:chat-open" event on document.
 *
 * Analytics (Site Architecture Spec 2.2), through window.D2C.track (site.js) or window.dataLayer when present:
 * chatbot_open {page_type}, chatbot_intent {page_type, intent}, chatbot_link {intent, to_url without its query},
 * chatbot_handoff {intent}. The question text is never sent.
 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  if (G.D2CChatEngine && G.D2CChatEngine.loaded) return;

  // =====================================================================================================
  // Engine (pure functions, no DOM)
  // =====================================================================================================
  const STOP = new Set(('a an the is are am was were be been do does did you your yours i me my mine we our us of for to in on at by ' +
    'and or with what which who whom how why when where it its this that these those can could would should will shall may might ' +
    'any some there here have has had get got about from as if so not no yes please pls tell know need want like just also ' +
    'much many more most than then them they their he she his her one ones x').split(' '));
  // whole-word prefixes that are common words: never match a product on their own
  const PREFIX_STOP = new Set(('human body the a an of for and with no peptide peptides blend stack growth hormone insulin alcohol ' +
    'water syringe syringes needle needles inch gauge pack vial vials injections injection with dac').split(' '));
  const FUZZY_STOP = new Set(('peptide peptides research supplies supply shipping shipped delivery testing tested certificate ' +
    'certificates wholesale reseller protocol dosage injection injections bacteriostatic syringes syringe needles calculator ' +
    'reconstitute reconstitution storage refrigerator something anything available products product category categories ' +
    'location locations pickup weight muscle healing recovery collagen cognitive sleeping stress hormone hormones growth ' +
    'compare comparison difference between prescription insurance pharmacy doctor clinic cheaper alternative substitute ' +
    'generic stomach nausea effects selection selling sellers testosterone diabetes glucose memory tanning libido').split(' '));
  const COMMON_PLACE = new Set(['paradise', 'enterprise', 'surprise', 'anthem', 'corona', 'winchester', 'buckeye', 'mesa', 'peoria']);
  const STATES = { az: 'AZ', arizona: 'AZ', nv: 'NV', nevada: 'NV', ca: 'CA', california: 'CA' };
  const STATE_NAMES = { AZ: 'Arizona', NV: 'Nevada', CA: 'California' };

  // goal words are language, not facts: they only choose which published goal page to quote
  const GOAL_WORDS = [
    ['weight-loss', ['weight loss', 'lose weight', 'losing weight', 'weightloss', 'fat loss', 'lose fat', 'burn fat', 'fat burning', 'fat burner', 'obesity', 'obese', 'slimming', 'appetite', 'belly fat', 'weight management']],
    ['muscle', ['muscle', 'muscles', 'muscle growth', 'build muscle', 'gain muscle', 'muscle gain', 'bulking', 'bulk up', 'bodybuilding', 'lean mass']],
    ['skin-hair', ['skin', 'hair', 'wrinkle', 'wrinkles', 'hair loss', 'hair growth', 'complexion', 'skin care', 'skincare', 'anti aging skin']],
    ['sleep', ['sleep', 'insomnia', 'sleeping', 'deep sleep', 'fall asleep']],
    ['tanning', ['tan', 'tanning', 'tanned', 'sunless tan', 'bronze']],
    ['healing', ['healing', 'heal', 'recovery', 'recover', 'injury', 'injuries', 'tendon', 'tendons', 'ligament', 'joint', 'joints', 'gut', 'wound', 'wounds', 'repair', 'inflammation', 'torn']],
    ['cognitive', ['focus', 'memory', 'brain', 'cognitive', 'cognition', 'nootropic', 'nootropics', 'mental clarity', 'brain fog']],
    ['testosterone', ['testosterone', 'low t', 'trt', 'test levels']],
    ['men', ['men', 'male', 'mens', 'erectile', 'men health']],
    ['blood-sugar', ['blood sugar', 'diabetes', 'diabetic', 'glucose', 'a1c', 'insulin resistance', 'type 2']],
    ['women', ['women', 'female', 'womens', 'women health']],
  ];
  const LIBIDO = ['libido', 'sex drive', 'sexual desire', 'arousal'];

  const RE = {
    greeting: /^(hi|hello|hey|hiya|howdy|yo|good (morning|afternoon|evening)|hola)( there)?( team)?$/,
    thanks: /^(thanks|thank you|thx|ty|cheers|great thanks|ok thanks|perfect|got it|ok|okay)( so much| a lot)?$/,
    handoff: /\b((talk|speak|chat) (to|with) (a |an |the |your |real |live )*(person|human|someone|somebody|agent|rep|representative|team|staff|manager|support)|(real|live) (person|human|agent)|customer (service|support|care)|phone number|call (you|someone|your)|(email|contact|reach) (you|us|support|someone|the team|your team)|contact (info|information|details|page|support)|(your|an|the) email|email address|how (do|can) i contact|my order|order (status|number|tracking)|where is my|track(ing)? (my|an|the) (order|package|shipment)|cancel (my )?(order|subscription)|complain\w*|refund my|damaged|wrong item|missing (item|package|order)|speak to)\b/,
    personalHealth: /\b(i (have|ve|am|m|was diagnosed with|got)( \w+){0,2} (diabetes|diabetic|pregnant|breastfeeding|nursing|cancer|kidney|liver|heart|blood pressure|thyroid|a condition|allergies|allergic|pcos|depression)|(safe|ok|okay|good|right|bad) for me|(can|should|could) (i|you|we) (drink|take|combine|stop|start|eat|travel|exercise|work out|stack)|(while|when) (on|taking|using|pregnant|breastfeeding)|interact\w*|(together|combined|combine) with|my (doctor|condition|health|blood|knee|back|shoulder|injury|symptoms|kids?|child|son|daughter|dog|cat|pet|body)|will it (help|work for) me|for my (knee|back|shoulder|injury|pain|condition)|i am (taking|on))\b/,
    legal: /\b(legal|illegal|legally|law|laws|lawful|controlled substance|schedule (iii|3)|dea|customs|seiz\w+|need a prescription|prescription (required|needed|only)|without a (prescription|script|rx)|over the counter|otc|allowed to (buy|own|use|import|order)|get in trouble|get arrested)\b/,
    wadaReg: /\b(wada|fda|approved|approval|regulat\w*|banned in sport|drug test\w*)\b/,
    rx: /\b(prescription|prescriptions|prescribe|prescribed|prescriber|rx|script|pharmacy|pharmacies|insurance|copay|telehealth|telemedicine|clinic|doctor|compounded|compounding|compound pharmacy|generic|med spa|medspa)\b/,
    substitution: /\b(alternative|alternatives|instead|substitute|substitutes|substitution|replacement|replace|generic|cheaper|cheap|cheapest|knock ?off|dupe|copy|compounded|equivalent|poor man|version of|similar to|same thing|same as|identical|interchangeable|swap|switch)\b/,
    brandCommerce: /\b(buy|order|purchase|price|prices|pricing|cost|costs|how much (is|are|does|do|for|would|will)|sell|sold|carry|stock|for sale|where (can|to|do)|available|availability|get|ship|deliver|coupon|discount|cheaper|cheap|afford\w*)\b/,
    compare: /\b(vs|v|versus|compare|compared|comparing|comparison|difference|differences|differ|different|same as|the same|better|worse|stronger|weaker|similar|equivalent|or)\b/,
    dosage: /\b(dose|doses|dosage|dosages|dosing|protocol|protocols|cycle|cycles|cycled|cycling|how often|frequency|per week|per day|daily|weekly|titrat\w*|microdos\w*|loading phase|maintenance dose|schedule)\b/,
    sideEffects: /\b(side effects?|sideeffects?|safe|safety|safer|risk|risks|risky|danger\w*|adverse|reaction|reactions|nausea|vomit\w*|diarrh\w*|constipat\w*|headache|cancer|toxic\w*|harm|harmful|warnings?|contraindicat\w*|long term effects?|avoid|who should not)\b/,
    reconstitute: /\b(reconstitut\w*|mix|mixing|mixed|dilut\w*|diluent|how much (bacteriostatic )?water|how many ml|bacteriostatic water (to|for)|add water|water to add|water (do i|should i|to) (add|use|mix))\b/,
    inject: /\b(how (to|do|do i|should i|can i|would i|do you|you) (inject|give|administer|do (an |a )?(injection|shot)|use (the|a|an) pen)|where (to|do i|should i|can i|is the best place to|on the body to|do you) inject|inject (it|into|in|where|under)|injection (site|sites|technique|angle|depth|spot|spots|area)|needle (size|length|gauge) for|subq|subcutaneous|intramuscular|pen (use|instructions)|(use|using) (the|a|an|my) pen|how to use|dispos\w*|sharps)\b/,
    store: /\b(store|storing|storage|stored|refrigerat\w*|fridge|freez\w*|room temperature|shelf life|expire|expires|expiration|how long (does|do|will) (it|they|\w+) (last|keep)|keep (it|them) (cold|cool)|on arrival|arrive warm)\b/,
    calculate: /\b(calculat\w*|calculator|how many units|units is|units are|unit is|concentration|convert\w*|conversion|mcg to mg|mg to mcg|ml to units|units to ml|u ?100|syringe units|tick marks?|draw up|how much to draw)\b/,
    wholesale: /\b(wholesale|wholesaler|bulk(?! up)|in bulk|reseller|resellers|resell|reselling|distributor|distribut\w*|private label|white label|large (order|orders|quantity|quantities)|volume (pricing|discount|order)|b2b|trade account|clinic account|supplier|suppliers|case price|moq|minimum order)\b/,
    coa: /\b(coa|coas|certificate|certificates|certificate of analysis|lab results?|lab test\w*|third party|3rd party|tested|testing|test results?|test (your|the|each|every|all|them|it|products|peptides|batches|lots)|purity|pure|hplc|mass spec\w*|batch|batches|lot (number|numbers|specific)|(this|each|every|per|the|a) lot|quality|verified)\b/,
    shipping: /\b(ship|ships|shipping|shipped|deliver|delivery|delivers|arrive|arrival|tracking|track|how long (does|will) (it|my order) take|days to|overnight|express|cold pack|ice pack|international|canada|usa|the us|united states|states do you)\b/,
    returns: /\b(return|returns|refund|refunds|exchange|money back|guarantee)\b/,
    payment: /\b(payment|payments|pay|paying|credit cards?|debit( cards?)?|crypto|bitcoin|paypal|venmo|zelle|apple pay|google pay|cash app|checkout|check out)\b/,
    reviews: /\b(reviews?|testimonials?|ratings?|reputation|legit|legitimate|scam|trust|trustworthy|real company|fake|reliable|who are you|about you|about your company|safe to (buy|order|shop|pay|purchase))\b/,
    researchUse: /\b(research use|research only|ruo|human use|for humans|not for human|human consumption|veterinary|lab use|laboratory use)\b/,
    location: /\b(near me|nearby|close to me|location|locations|local|locally|in person|walk in|walkin|pick up|pickup|pick it up|address|visit|storefront|physical store|retail store|your store|a store|in store|stores near|clinic near|office|open today|opening hours|hours)\b/,
    supplies: /\b(supplies|supply|what (else )?(do|would|will) (i|you) need|need with|needed (with|for)|comes? with|come with|kit|kits|what goes with|go with|accessor\w*|syringes?|needles?|swabs?|bacteriostatic water|diluent)\b/,
    price: /\b(price|prices|priced|pricing|cost|costs|costing|how much (is|are|for|would|will)|how much( \w+){0,6} (cost|costs|run|charge|go for|sell for)|how much$|cheap\w*|expensive|afford\w*|per mg|discount\w*|coupon\w*|promo|deal|deals|on sale|sale price|usd|dollars?)\b/,
    buy: /\b(buy|buying|purchase|order|ordering|in stock|stock|out of stock|available|availability|do you (have|sell|carry|stock|offer)|for sale|where (can|do) i (get|buy|find|order)|get some|sell|selling|carry|shop|add to cart|cart)\b/,
    browse: /\b(categor\w*|browse|show me|list|catalog|catalogue|range|selection|what (peptides|products|items) do you|all (your )?(peptides|products)|what do you (sell|have|carry|offer)|your (peptides|products))\b/,
    goal: /\b(best|good for|help with|helps with|helps?|for (weight|fat|muscle|sleep|healing|recovery|skin|hair|focus|memory|libido|tanning|energy|men|women)|which (peptide|peptides|one|product|compound)|what (do|should) (people|i|you) (use|take)|what works|what is used for|used for|work for|works for|benefits?|recommend\w*|suggest\w*|effective|results?)\b/,
    what: /\b(what is|what are|what s|whats|tell me about|explain|define|definition|meaning|mean|means|how does (it|\w+) work|mechanism|what does (it|\w+) do|what do (they|\w+) do|info on|information (on|about)|learn about|overview|describe|is it a|are they|is xent (a|an|the)|are xent|xent (is|are) (a|an))\b/,
  };

  // a question about the asker's own (or another person's) dose: answered with links and the hand-off, no number
  function isPersonalDose(rest, amounts) {
    if (/\b(what|which|right|best|starting|recommended|ideal|typical|correct|safe|good|effective|optimal|usual|normal|max|maximum|minimum) (dose|doses|dosage|dosing|amount|protocol|cycle)\b/.test(rest)) return true;
    if (/\bmy (dose|dosage|protocol|cycle|stack|amount)\b/.test(rest)) return true;
    if (/\b(dose|dosage|amount|protocol|cycle|units|mg|mcg) (for|to give) (me|myself|my|him|her|us)\b/.test(rest)) return true;
    if (/\bi (weigh|am \d+ ?(lbs|pounds|kg))\b/.test(rest)) return true;
    const doseCtx = /\b(dose|doses|dosage|dosing|how much|how many|units?|mg|mcg|ml|iu|how often|daily|weekly|per day|per week|a day|a week|every day|every week|every other day|times|protocol|cycle|amount)\b/.test(rest);
    if (!doseCtx) return false;
    const measureOnly = /\b(draw|measure|pull)\b/.test(rest) && !/\b(take|inject|dose|use|run)\b/.test(rest) && calcReady(amounts || []);
    if (measureOnly) return false;
    return /\b(should|can|could|do|would|must|shall|may) (i|we|you|one|my \w+) (take|use|inject|dose|run|start|begin|go|administer|give|microdose|draw|be taking)\b/.test(rest) ||
      /\bhow (much|many|often)( \w+){0,6} (should|do|can|could|would|must|to) (i|we|you|one)? ?(take|use|inject|dose|run|start|begin|administer|give|draw)\b/.test(rest) ||
      /\bhow (much|many)( \w+){0,4} to (take|inject|use|dose|run|start)\b/.test(rest);
  }

  const clean = s => String(s == null ? '' : s).replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1 to $2').replace(/\s*[\u2013\u2014]\s*/g, ', ');

  function norm(s) {
    let t = String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    t = t.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019\u201b\u02bc`\u00b4]/g, "'").replace(/[\u201c\u201d]/g, '"');
    t = t.replace(/[\u00b5\u03bc]g\b/g, 'mcg');
    t = t.replace(/\b(what|where|how|who|it|that|there|here)'s\b/g, '$1 is').replace(/\bwhats\b/g, 'what is').replace(/\bwheres\b/g, 'where is');
    t = t.replace(/\bcan't\b|\bcant\b/g, 'cannot').replace(/\bwon't\b/g, 'will not').replace(/n't\b/g, ' not');
    t = t.replace(/'m\b/g, ' am').replace(/'re\b/g, ' are').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will').replace(/'d\b/g, ' would');
    t = t.replace(/'s\b/g, '').replace(/s'(\s|$)/g, 's$1');
    t = t.replace(/\b(do|can|could|would|will|are|r|have|did) u\b/g, '$1 you').replace(/\bur\b/g, 'your').replace(/\bplz\b|\bpls\b/g, 'please');
    t = t.replace(/\bbac(?:teriostatic)?[\s-]*water\b/g, 'bacteriostatic water').replace(/\bbac[\s-]*h2o\b/g, 'bacteriostatic water');
    t = t.replace(/\bversus\b/g, 'vs').replace(/\bv\.?s\.?(?=\s|$)/g, 'vs');
    return t.replace(/\s+/g, ' ').trim();
  }
  const toks = t => (String(t).match(/[a-z0-9]+/g) || []);
  const squash = arr => arr.join('');
  const stem = w => (w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(sses)$/, 'ss').replace(/([^s])s$/, '$1').replace(/(ing|ed)$/, '') : w);

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? '$' + v : '$' + v.toFixed(2);
  }
  function fmt(n, dec) {
    if (!Number.isFinite(n)) return '';
    const d = dec == null ? 3 : dec;
    const r = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return r.toLocaleString('en-US', { maximumFractionDigits: d });
  }
  function parseNum(s) {
    const x = String(s);
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) return parseFloat(x.replace(/,/g, ''));
    return parseFloat(x.replace(',', '.'));
  }

  // ---------- prepare: lexicon, places, categories, goals, glossary, FAQ corpus ----------
  function prepare(index) {
    if (!index || typeof index !== 'object') throw new Error('chat index missing');
    if (index.__prepared) return index.__prepared;
    const X = { index };
    X.products = new Map((index.products || []).map(p => [p.slug, p]));
    X.brands = new Map((index.brands || []).map(b => [b.slug, b]));
    X.topics = new Map((index.topics || []).map(t => [t.slug, t]));
    X.pages = new Map((index.pages || []).map(p => [p.url, p]));
    X.site = index.site || {};
    X.cats = index.categories || [];
    X.catBySlug = new Map(X.cats.map(c => [c.slug, c]));

    // lexicon
    X.exact = new Map(); X.prefix = new Map(); X.fuzzy = [];
    const addTo = (map, key, ent) => { if (!map.has(key)) map.set(key, new Map()); map.get(key).set(ent.kind + ':' + ent.id, ent); };
    const valid = (kind, id) => (kind === 'p' ? X.products.has(id) : kind === 'b' ? X.brands.has(id) : X.topics.has(id));
    for (const row of index.lexicon || []) {
      const term = row[0], kind = row[1], id = row[2];
      if (!valid(kind, id)) continue;
      const tk = toks(norm(term));
      if (!tk.length) continue;
      const ent = { kind, id };
      addTo(X.exact, squash(tk), ent);
      const last = tk[tk.length - 1];
      if (/^[a-z]{4,}$/.test(last)) addTo(X.exact, squash(tk.slice(0, -1)) + (last.endsWith('s') ? last.slice(0, -1) : last + 's'), ent);
      for (let k = 1; k < tk.length; k++) {
        const pre = tk.slice(0, k);
        if (pre.every(w => PREFIX_STOP.has(w) || /^\d+$/.test(w))) continue;
        if (k === 1 && (PREFIX_STOP.has(pre[0]) || pre[0].length < 2)) continue;
        addTo(X.prefix, pre.join(' '), ent);
      }
      if (tk.length === 1 && /^[a-z]{6,}$/.test(tk[0])) X.fuzzy.push([tk[0], ent]);
    }

    // places
    X.places = [];
    for (const pl of index.places || []) {
      const tk = toks(norm(pl.name));
      if (tk.length) X.places.push({ tk, place: pl, common: tk.length === 1 && COMMON_PLACE.has(tk[0]) });
    }
    X.places.sort((a, b) => b.tk.length - a.tk.length);
    X.locations = index.locations || [];

    // categories: keyword phrases from the category names (data), "supplies" handled by the supplies intent
    X.catKeys = [];
    for (const c of X.cats) {
      if (c.supplies) continue;
      const base = norm(c.name).replace(/\bpeptides?\b/g, ' ').replace(/\s+/g, ' ').trim();
      const parts = new Set([base]);
      const paren = base.match(/\(([^)]+)\)/); if (paren) { parts.add(paren[1].trim()); parts.add(base.replace(/\([^)]*\)/, '').trim()); }
      for (const piece of base.replace(/\([^)]*\)/g, ' ').split(/\band\b/)) if (piece.trim()) parts.add(piece.trim());
      for (const ph of parts) { const tk = toks(ph); if (tk.length) X.catKeys.push({ sq: squash(tk), n: tk.length, cat: c }); }
    }
    X.catKeys.sort((a, b) => b.n - a.n);

    // goals: only goal hubs that are published
    X.goalHubs = new Map();
    for (const p of index.pages || []) if (p.type === 'goal-hub' && p.goal) X.goalHubs.set(p.goal, p);
    X.goalKeys = [];
    for (const [goal, words] of GOAL_WORDS) {
      if (!X.goalHubs.has(goal)) continue;
      for (const w of words) X.goalKeys.push({ tk: toks(w), goal });
    }
    X.goalKeys.sort((a, b) => b.tk.length - a.tk.length);

    // glossary
    X.terms = (index.glossary || []).map(g => ({ g, tk: toks(norm(g.term)) })).filter(t => t.tk.length).sort((a, b) => b.tk.length - a.tk.length);

    // FAQ corpus
    X.faqs = [];
    const df = new Map();
    const addFaq = (q, a, url, label, pg) => {
      const words = [...new Set(toks(norm(q)).filter(w => !STOP.has(w)).map(stem))];
      if (!words.length) return;
      const ents = findEntities(norm(q), X).ents.map(e => e.kind + ':' + e.id);
      X.faqs.push({ q, a, url, label, pg, words, ents });
      for (const w of words) df.set(w, (df.get(w) || 0) + 1);
    };
    for (const p of index.pages || []) for (const f of p.faq || []) addFaq(f[0], f[1], p.url, p.h1, p);
    const faqPage = (index.pages || []).find(p => p.type === 'faq');
    for (const g of index.faq_groups || []) for (const it of g.items || []) {
      const link = it[2] && X.pages.has(it[2]) ? X.pages.get(it[2]) : null;
      addFaq(it[0], it[1], link ? link.url : faqPage ? faqPage.url : null, link ? link.h1 : faqPage ? faqPage.h1 : '', link || faqPage || null);
    }
    const N = X.faqs.length || 1;
    X.idf = w => Math.log(1 + N / (1 + (df.get(w) || 0)));
    index.__prepared = X;
    return X;
  }

  // ---------- entity detection ----------
  function findEntities(t, X) {
    const tk = toks(t);
    const used = new Array(tk.length).fill(false);
    const ents = []; const ambiguous = [];
    const free = (i, n) => { for (let k = i; k < i + n; k++) if (used[k]) return false; return true; };
    const mark = (i, n) => { for (let k = i; k < i + n; k++) used[k] = true; };
    // longest span first; at each length an exact name wins over a prefix, and a longer prefix ("hgh fragment")
    // wins over a shorter exact name ("hgh")
    for (let n = Math.min(8, tk.length); n >= 1; n--) {
      for (let i = 0; i + n <= tk.length; i++) {
        if (!free(i, n)) continue;
        const hit = X.exact.get(squash(tk.slice(i, i + n)));
        if (!hit) continue;
        mark(i, n);
        for (const e of hit.values()) ents.push({ kind: e.kind, id: e.id, at: i, len: n });
      }
      if (n > 4) continue;
      for (let i = 0; i + n <= tk.length; i++) {
        if (!free(i, n)) continue;
        const hit = X.prefix.get(tk.slice(i, i + n).join(' '));
        if (!hit) continue;
        mark(i, n);
        const list = [...hit.values()];
        const ids = new Set(list.map(e => e.kind + ':' + e.id));
        if (ids.size === 1) ents.push({ kind: list[0].kind, id: list[0].id, at: i, len: n, how: 'prefix' });
        else ambiguous.push({ at: i, len: n, options: list });
      }
    }
    for (let i = 0; i < tk.length; i++) {
      const w = tk[i];
      if (used[i] || !/^[a-z]{6,}$/.test(w) || FUZZY_STOP.has(w) || STOP.has(w)) continue;
      const max = w.length >= 10 ? 2 : 1;
      let best = null, bestD = max + 1;
      for (const [term, e] of X.fuzzy) {
        const d = editDistance(w, term, max);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best && bestD <= max) { used[i] = true; ents.push({ kind: best.kind, id: best.id, at: i, len: 1, how: 'fuzzy' }); }
    }
    ents.sort((a, b) => a.at - b.at);
    const seen = new Set(); const uniq = [];
    for (const e of ents) { const k = e.kind + ':' + e.id; if (!seen.has(k)) { seen.add(k); uniq.push(e); } }
    const rest = tk.map((w, i) => (used[i] ? 'xent' : w)).join(' ').replace(/\b(xent )+xent\b/g, 'xent');
    return { ents: uniq, ambiguous, rest, tokens: tk };
  }

  function findPlaces(tk, X) {
    const out = []; const joined = ' ' + tk.join(' ') + ' ';
    for (const p of X.places) {
      const ph = ' ' + p.tk.join(' ') + ' ';
      const at = joined.indexOf(ph);
      if (at < 0) continue;
      if (p.common) {
        const before = joined.slice(0, at).trim().split(' ').pop();
        const after = joined.slice(at + ph.length).trim().split(' ')[0];
        if (!/^(in|to|near|around|from|at)$/.test(before || '') && !STATES[after || '']) continue;
      }
      if (out.some(o => o.tk.join(' ').includes(p.tk.join(' ')))) continue; // "north las vegas" beats "las vegas"
      out.push(p);
    }
    const states = [];
    for (const w of tk) if (STATES[w] && !states.includes(STATES[w]) && (w.length > 2 || /\b(in|to|near) (az|nv|ca)\b/.test(tk.join(' ')) || out.length)) states.push(STATES[w]);
    return { places: out.map(o => o.place), states };
  }

  function findCategory(rest, X) {
    const tk = toks(rest);
    for (const k of X.catKeys) {
      for (let i = 0; i + k.n <= tk.length; i++) {
        if (squash(tk.slice(i, i + k.n)) === k.sq) return { cat: k.cat, withPeptides: /^peptides?$/.test(tk[i + k.n] || '') };
      }
    }
    return null;
  }

  function findGoals(rest, X) {
    const s = ' ' + toks(rest).join(' ') + ' ';
    const goals = [];
    for (const k of X.goalKeys) if (s.includes(' ' + k.tk.join(' ') + ' ') && !goals.includes(k.goal)) goals.push(k.goal);
    if (/\blos(e|ing) (\w+ ){0,3}weight\b|\bweight (\w+ ){0,2}los(e|s|ing)\b|\blos(e|ing) \d+ ?(lbs|lb|pounds|kg|kilos)\b/.test(s) && X.goalHubs.has('weight-loss') && !goals.includes('weight-loss')) goals.unshift('weight-loss');
    if (LIBIDO.some(w => s.includes(' ' + w + ' '))) for (const g of ['men', 'women']) if (X.goalHubs.has(g) && !goals.includes(g)) goals.push(g);
    return goals;
  }

  function findTerm(rest, X) {
    const tk = toks(rest);
    for (const t of X.terms) {
      for (let i = 0; i + t.tk.length <= tk.length; i++) if (squash(tk.slice(i, i + t.tk.length)) === squash(t.tk)) return t.g;
    }
    return null;
  }

  // amounts with units, for arithmetic and strength mentions
  function parseAmounts(t) {
    const out = [];
    const re = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(mcg|ug|micrograms?|mg|milligrams?|ml|milliliters?|millilitres?|cc|iu|units?|u)\b/g;
    let m;
    while ((m = re.exec(t))) {
      const v = parseNum(m[1]);
      if (!Number.isFinite(v)) continue;
      const raw = m[2];
      const u = /^(mcg|ug|micro)/.test(raw) ? 'mcg' : /^(mg|milligram)/.test(raw) ? 'mg' : /^(ml|milli|cc)/.test(raw) ? 'ml' : raw === 'iu' ? 'iu' : 'units';
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 16);
      const before = t.slice(Math.max(0, m.index - 14), m.index);
      out.push({ v, u, at: m.index, syringe: u === 'ml' && /^\s*(insulin\s+)?syringe/.test(after), vial: /^\s*(of \w+ )?(\w+ )?vial/.test(after) || /vial (of|with|is)?\s*$/.test(before), water: u === 'ml' && (/^\s*(of\s+)?(bacteriostatic |sterile )?(water|diluent|bac)/.test(after) || /(water|diluent|add|added|adding|mix|mixed|with)\s*$/.test(before)) });
    }
    return out;
  }

  // ---------- routing ----------
  function route(text, X, state) {
    const t = norm(text);
    const st = state || {};
    const found = findEntities(t, X);
    const products = found.ents.filter(e => e.kind === 'p').map(e => X.products.get(e.id));
    const brands = found.ents.filter(e => e.kind === 'b').map(e => X.brands.get(e.id));
    const topics = found.ents.filter(e => e.kind === 't').map(e => X.topics.get(e.id));
    const rest = found.rest;
    const pl = findPlaces(found.tokens, X);
    const r = {
      text: t, rest, products, brands, topics, ambiguous: found.ambiguous, places: pl.places, states: pl.states,
      category: null, goals: [], term: null, amounts: parseAmounts(t), flags: {}, intent: 'unknown', sub: null, usedContext: false,
    };
    const has = re => re.test(rest);
    const f = r.flags;
    f.personalDose = isPersonalDose(rest, r.amounts);
    f.personalHealth = has(RE.personalHealth);
    f.legal = has(RE.legal) && !/\bwada\b/.test(rest);
    f.rx = has(RE.rx);
    f.substitution = has(RE.substitution);
    f.handoff = has(RE.handoff);
    const catHit = findCategory(rest, X);
    r.category = catHit ? catHit.cat : null;
    r.goals = findGoals(rest, X);
    r.term = findTerm(rest, X);

    // context product: the page the panel is open on, then the last product discussed
    const needsProduct = !products.length && !brands.length && !topics.length && !found.ambiguous.length;
    if (needsProduct) {
      const ctxSlug = contextProduct(X, st);
      const pronoun = /\b(it|this|that|these|this one|that one|the vial|this vial|that vial|this product|them|they)\b/.test(rest);
      if (ctxSlug && (pronoun || /\b(price|cost|how much|supplies|need with|side effects?|dose|dosage|reconstitut\w*|store|storage|stock|available|what is it)\b/.test(rest))) {
        const p = X.products.get(ctxSlug.slug); const b = X.brands.get(ctxSlug.slug); const tp = X.topics.get(ctxSlug.slug);
        if (p) r.products.push(p); else if (b) r.brands.push(b); else if (tp) r.topics.push(tp);
        r.usedContext = !!(p || b || tp);
      }
    }
    const nEnt = r.products.length + r.brands.length + r.topics.length;
    const glpVial = r.products.some(p => p.research_vial);
    // "a store in Henderson" is a place to buy from, not storage
    const storeNoun = /\b(a|an|the|your|any|physical|retail|local|walk in|in) stores?\b|\bstores? (near|in|around|nearby|close|location|locations|hours|address|front)\b|\bstorefront\b/.test(rest);
    const storage = has(RE.store) && !(storeNoun && !/\b(storing|storage|stored|refrigerat\w*|fridge|freez\w*|room temperature|shelf life|expir\w*|keep (it|them))\b/.test(rest));

    const decide = (intent, sub) => { r.intent = intent; r.sub = sub || null; return r; };
    if (!t) return decide('greeting');
    if (RE.greeting.test(t)) return decide('greeting');
    if (RE.thanks.test(t)) return decide('thanks');
    if (f.handoff && !nEnt) return decide('handoff', 'person');
    if (f.personalDose) return decide('dosage', 'personal');
    if (f.legal) return decide('handoff', 'legal');
    if (r.brands.length) {
      if (has(RE.compare) && nEnt >= 2) return decide('compare');
      if (f.substitution || has(RE.brandCommerce) || f.rx && !has(RE.what)) return decide('brand', 'guard');
      if (f.personalHealth) return decide('side_effects', 'personal');
      if (has(RE.dosage)) return decide('dosage');
      if (has(RE.sideEffects)) return decide('side_effects');
      if (has(RE.reconstitute) || has(RE.inject) || storage) return decide('howto', storage ? 'store' : 'inject');
      if (r.goals.length) return decide('goal');
      if (f.handoff) return decide('brand', 'guard');
      return decide('what');
    }
    // "what is reconstitution", "define U-100 syringe": only a glossary term asked about, answered by its definition
    if (r.term && !nEnt && !r.amounts.length && /^(what is|what are|what does|define|definition of|meaning of|explain)\b/.test(rest)) {
      const own = new Set(toks(norm(r.term.term)).map(stem));
      const extra = toks(rest).filter(w => !STOP.has(w) && !/^(define|definition|meaning|mean|explain|xent)$/.test(w) && !own.has(stem(w)));
      if (!extra.length) return decide('what');
    }
    if (glpVial && (f.rx || f.substitution)) return decide('brand', 'glp');
    if (f.handoff) return decide('handoff', 'person');
    if (has(RE.compare) && nEnt >= 2 && !/\b(and|or) (supplies|bacteriostatic|syringes?|needles?)\b/.test(rest) && !(has(RE.price) && !/\b(vs|versus|compare\w*|difference|better|same)\b/.test(rest))) return decide('compare');
    if (/\bsafe to (buy|order|shop|pay|purchase)\b/.test(rest)) return decide('trust', 'reviews');
    if (f.personalHealth && (nEnt || has(RE.sideEffects))) return decide('side_effects', 'personal');
    if (has(RE.dosage) && !has(RE.calculate)) return decide('dosage');
    if (has(RE.sideEffects)) return decide('side_effects');
    // "how to store it after mixing" is storage; "how to reconstitute and store it" or a water question is reconstitution
    const reconVerb = /\b(how (to|do i|do you|should i|can i|would i) (reconstitute|mix|dilute)|how much (bacteriostatic )?water|how many ml|water to add|add water)\b/.test(rest);
    if (has(RE.reconstitute) && (reconVerb || !storage)) return decide('howto', 'reconstitute');
    if (has(RE.calculate) || calcReady(r.amounts)) return decide('howto', 'calculate');
    if (has(RE.inject)) return decide('howto', 'inject');
    if (storage) return decide('howto', 'store');
    if (has(RE.wholesale)) return decide('wholesale');
    if (has(RE.researchUse)) return decide('trust', 'research');
    if (has(RE.coa)) return decide('trust', 'coa');
    if (r.places.length || r.states.length && (has(RE.location) || has(RE.buy) || /\bavailable\b/.test(rest)) || has(RE.location)) return decide('location');
    if (has(RE.returns)) return decide('trust', 'returns');
    if (has(RE.shipping)) return decide('trust', 'shipping');
    if (has(RE.payment)) return decide('trust', 'payment');
    if (has(RE.reviews)) return decide('trust', 'reviews');
    if (has(RE.supplies) && !(products.length && products.every(p => p.kind === 'supply') && has(RE.price))) {
      if (!(products.length && products.every(p => p.kind === 'supply') && has(RE.buy))) return decide('supplies');
    }
    if (has(RE.price)) return decide('price');
    // "healing peptides", "show me your weight loss peptides": the store category; "peptides for healing": the goal pages
    const catPhrase = !!(catHit && catHit.withPeptides);
    if (r.category && (has(RE.browse) || has(RE.buy) || catPhrase) && !(has(RE.goal) && r.goals.length)) return decide('category');
    if (r.goals.length && !has(RE.browse) && !has(RE.buy)) return decide('goal');
    if (r.category && !nEnt) return decide('category');
    if (has(RE.browse)) return decide('category');
    if (RE.wadaReg.test(rest) && nEnt) return decide('what', 'regulatory');
    if (has(RE.what) || r.term && !nEnt) return decide('what');
    if (found.ambiguous.length && !nEnt) return decide('buy');
    if (nEnt) {
      const bare = !rest.split(' ').some(w => w !== 'xent' && !STOP.has(w));
      if (r.products.length && (has(RE.buy) || bare)) return decide('buy');
      if (/^(how|why|does|do|is|are|can|could|will|would|what|when|which|who|should|did)\b/.test(rest) || /\?\s*$/.test(t)) return decide('what');
      return decide(r.products.length ? 'buy' : 'what');
    }
    if (has(RE.buy)) return decide('buy');
    if (r.goals.length) return decide('goal');
    return decide('unknown');
  }

  function contextProduct(X, st) {
    if (st.pageUrl) {
      const pg = X.pages.get(st.pageUrl);
      if (pg) {
        const slug = pg.product || pg.subject || pg.a || null;
        if (slug && (X.products.has(slug) || X.brands.has(slug) || X.topics.has(slug))) return { slug };
      }
      for (const p of X.products.values()) if (p.url === st.pageUrl) return { slug: p.slug };
    }
    if (st.last && st.last.length) return { slug: st.last[0] };
    return null;
  }

  function calcReady(am) {
    const masses = am.filter(a => (a.u === 'mg' || a.u === 'mcg' || a.u === 'iu') && !a.syringe);
    const water = am.filter(a => a.u === 'ml' && !a.syringe);
    return masses.length >= 1 && water.length >= 1;
  }

  // ---------- FAQ retrieval ----------
  function faqMatch(r, X, opts) {
    const o = opts || {};
    const words = [...new Set(toks(r.text).filter(w => !STOP.has(w)).map(stem))];
    if (!words.length || !X.faqs.length) return null;
    const ents = new Set([...r.products.map(p => 'p:' + p.slug), ...r.brands.map(b => 'b:' + b.slug), ...r.topics.map(tp => 't:' + tp.slug)]);
    const qMass = words.reduce((s, w) => s + X.idf(w), 0);
    let best = null;
    for (const f of X.faqs) {
      if (o.types && f.pg && !o.types.includes(f.pg.type)) continue;
      if (o.exclude && o.exclude(f)) continue;
      // entity consistency: a named product must be the FAQ's subject; a generic question gets generic answers
      const fEnts = new Set(f.ents);
      const pgKey = f.pg ? [f.pg.product && 'p:' + f.pg.product, f.pg.subject && (X.brands.has(f.pg.subject) ? 'b:' : X.topics.has(f.pg.subject) ? 't:' : 'p:') + f.pg.subject].filter(Boolean) : [];
      if (ents.size) {
        const ok = [...ents].every(e => fEnts.has(e) || pgKey.includes(e));
        if (!ok) continue;
        if ([...fEnts].some(e => !ents.has(e))) continue;
      } else if (fEnts.size || (pgKey.length && !(o.pageUrl && f.pg && f.pg.url === o.pageUrl))) continue;
      let hit = 0;
      const fw = new Set(f.words);
      for (const w of words) if (fw.has(w)) hit += X.idf(w);
      if (!hit) continue;
      const fMass = f.words.reduce((s, w) => s + X.idf(w), 0);
      const score = hit / Math.sqrt(qMass * fMass);
      const cover = hit / qMass;
      if (!best || score > best.score) best = { f, score, cover };
    }
    if (!best) return null;
    const min = o.min == null ? 0.55 : o.min;
    return best.score >= min && best.cover >= 0.5 ? best : null;
  }

  // ---------- answer building ----------
  function answer(text, index, state) {
    const X = prepare(index);
    const st = state || {};
    const r = route(text, X, st);
    const A = newAnswer(r);
    const H = BUILD[r.intent] || BUILD.unknown;
    H(r, X, A, st);
    finish(A, X, r);
    A.state = { pageUrl: st.pageUrl || null, last: r.products.length ? r.products.map(p => p.slug) : r.brands.length ? r.brands.map(b => b.slug) : (st.last || []) };
    return A;
  }

  function newAnswer(r) {
    return { intent: r.intent, sub: r.sub, flags: r.flags, handoff: false, blocks: [], chips: [], route: r };
  }
  const say = (A, text) => A.blocks.push({ t: 'p', text: clean(text) });
  const note = (A, text) => A.blocks.push({ t: 'note', text: clean(text) });
  const quote = (A, text, pg) => { if (text) A.blocks.push({ t: 'quote', text: clean(text), url: pg ? pg.url : null, label: pg ? clean(pg.h1) : null }); };
  const links = (A, items) => { const it = items.filter(x => x && x.url); if (it.length) A.blocks.push({ t: 'links', items: it.map(x => ({ url: x.url, label: clean(x.label) })) }); };
  const pageLink = (pg, label) => (pg ? { url: pg.url, label: label || pg.h1 } : null);
  const findPage = (X, pred) => { for (const p of X.pages.values()) if (pred(p)) return p; return null; };
  const typePage = (X, type, extra) => findPage(X, p => p.type === type && (!extra || extra(p)));
  const urlPage = (X, url) => X.pages.get(url) || null;
  const contactPage = X => typePage(X, 'contact');
  const vialName = p => (p.research_vial ? p.name + ' research vial' : p.name);

  function handoffLine(A, X, lead) {
    const c = contactPage(X);
    A.handoff = true;
    const email = X.site.email;
    say(A, (lead ? lead + ' ' : '') + 'To talk to a person, use the contact page' + (email ? ' or email ' + email : '') + '.');
    links(A, [pageLink(c, 'Contact us')]);
  }

  function ruoNote(A, X, list) {
    if (X.site.research_use_label && list.some(p => p.kind !== 'supply')) note(A, X.site.research_use_label);
  }

  function priceLines(p) {
    return p.strengths.map(s => s.label + ': ' + (s.varies ? 'from ' : '') + money(s.price) + (s.in_stock ? '' : ' (out of stock)'));
  }
  function productCard(A, p, opts) {
    const o = opts || {};
    A.blocks.push({ t: 'product', slug: p.slug, name: clean(vialName(p)), url: p.url, lines: priceLines(p), stock: p.in_stock ? 'In stock' : 'Out of stock', cta: (p.in_stock ? 'Buy ' : 'View ') + clean(p.name), highlight: o.highlight || null });
  }
  function strengthNote(A, r, p) {
    const asked = r.amounts.filter(a => a.u === 'mg' || a.u === 'iu' || a.u === 'mcg');
    if (!asked.length || p.kind === 'supply') return null;
    const labels = p.strengths.map(s => ({ s, m: String(s.label).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(mg|mcg|iu)/) }));
    for (const a of asked) {
      const v = a.u === 'mcg' ? a.v / 1000 : a.v; const u = a.u === 'mcg' ? 'mg' : a.u;
      const match = labels.find(x => x.m && Math.abs(parseFloat(x.m[1]) - v) < 1e-9 && x.m[2] === u);
      if (match) return match.s;
      say(A, p.name + ' is listed in ' + p.strengths.map(s => s.label).join(', ') + '. ' + fmt(a.v) + ' ' + (a.u === 'iu' ? 'IU' : a.u) + ' is not a listed strength.');
      return null;
    }
    return null;
  }

  function sideEffectsPage(X, slug) { return findPage(X, p => p.type === 'profile-child' && p.kind === 'side-effects' && p.subject === slug); }
  function childPage(X, slug, kind) { return findPage(X, p => p.type === 'profile-child' && p.kind === kind && p.subject === slug); }
  function profilePage(X, slug) {
    if (slug === 'glp-1') return findPage(X, p => p.type === 'type-hub' && p.hub === 'glp-1');
    return findPage(X, p => p.type === 'profile' && p.subject === slug);
  }
  function guidePage(X, g) { return findPage(X, p => p.type === 'guide' && p.guide === g); }
  function toolPage(X, tool) { return findPage(X, p => p.type === 'tool' && p.tool === tool); }
  function entName(e) { return e.name; }
  function subjectsOf(r) { return [...r.products.map(p => ({ slug: p.slug, name: p.name, p })), ...r.brands.map(b => ({ slug: b.slug, name: b.name, b })), ...r.topics.map(tp => ({ slug: tp.slug, name: tp.name, tp }))]; }

  const BUILD = {
    greeting(r, X, A) {
      say(A, 'Hi. Ask about a product, a price, supplies for a vial, shipping, certificates or wholesale. I answer from our catalog and site pages, and I cannot give medical or dosing advice.');
      A.chips.push(...starterChips(X));
    },
    thanks(r, X, A) {
      say(A, 'You are welcome. Anything else?');
      A.chips.push(...starterChips(X).slice(0, 3));
    },

    buy(r, X, A) {
      if (!r.products.length && r.ambiguous.length) return disambiguate(r, X, A);
      if (!r.products.length) {
        say(A, 'I could not find that product in our catalog. Name a product, or browse the full list.');
        const shop = typePage(X, 'shop-hub'); const sup = typePage(X, 'supplies-hub');
        links(A, [pageLink(shop, 'All peptides'), pageLink(sup, 'All supplies'), searchLink(r)]);
        A.chips.push(...starterChips(X).slice(0, 3));
        return;
      }
      for (const p of r.products.slice(0, 4)) {
        const hl = strengthNote(A, r, p);
        if (hl) say(A, 'The ' + hl.label + ' ' + p.name + ' is ' + (hl.varies ? 'from ' : '') + money(hl.price) + (hl.in_stock ? ' and in stock.' : ', and it is out of stock right now.'));
        else say(A, vialName(p) + (p.in_stock ? ' is in stock.' : ' is out of stock right now.'));
        productCard(A, p, { highlight: hl && hl.label });
      }
      ruoNote(A, X, r.products);
      const p0 = r.products[0];
      if (p0.kind !== 'supply' && p0.supplies && p0.supplies.length) A.chips.push('Supplies for ' + p0.name);
      if (p0.education && !p0.research_vial) A.chips.push('What is ' + p0.name + '?');
      else if (p0.education) A.chips.push('What is ' + p0.name + '?');
    },

    price(r, X, A) {
      if (!r.products.length && r.ambiguous.length) return disambiguate(r, X, A);
      if (!r.products.length) {
        say(A, 'Which product? Every product page lists its strengths and prices.');
        const shop = typePage(X, 'shop-hub'); const sup = typePage(X, 'supplies-hub');
        links(A, [pageLink(shop, 'All peptides'), pageLink(sup, 'All supplies')]);
        A.chips.push(...[...X.products.values()].filter(p => p.kind !== 'supply').slice(0, 3).map(p => p.name + ' price'));
        return;
      }
      for (const p of r.products.slice(0, 4)) {
        const hl = strengthNote(A, r, p);
        if (hl) say(A, 'The ' + hl.label + ' ' + p.name + ' is ' + (hl.varies ? 'from ' : '') + money(hl.price) + '.');
        else if (p.strengths.length === 1) say(A, vialName(p) + ' (' + p.strengths[0].label + ') is ' + (p.strengths[0].varies ? 'from ' : '') + money(p.strengths[0].price) + '.');
        else say(A, vialName(p) + ' prices: ' + p.strengths.map(s => s.label + ' ' + (s.varies ? 'from ' : '') + money(s.price)).join(', ') + '.');
        productCard(A, p, { highlight: hl && hl.label });
        const blogs = (p.blog || []).map(u => urlPage(X, u)).filter(Boolean);
        if (blogs.length) links(A, blogs.map(b => pageLink(b, 'Read: ' + b.h1)));
      }
      ruoNote(A, X, r.products);
      const p0 = r.products[0];
      if (p0.kind !== 'supply' && p0.supplies && p0.supplies.length) A.chips.push('Supplies for ' + p0.name);
      if (X.site.wholesale) A.chips.push('Bulk pricing');
    },

    supplies(r, X, A) {
      const vials = r.products.filter(p => p.kind !== 'supply');
      const named = r.products.filter(p => p.kind === 'supply');
      if (vials.length) {
        for (const p of vials.slice(0, 2)) {
          const sup = (p.supplies || []).map(s => X.products.get(s)).filter(Boolean);
          if (!sup.length) { say(A, 'The catalog lists no supplies for ' + p.name + '.'); continue; }
          say(A, 'Supplies listed with ' + vialName(p) + ':');
          A.blocks.push({ t: 'list', items: sup.map(s => ({ text: clean(s.name) + ': ' + (s.strengths.length > 1 ? 'from ' : '') + money(s.price_from) + (s.in_stock ? '' : ' (out of stock)'), url: s.url })) });
        }
      } else if (named.length) {
        for (const s of named.slice(0, 3)) productCard(A, s);
      } else {
        const hub = X.cats.find(c => c.supplies);
        const sup = hub ? hub.products.map(s => X.products.get(s)).filter(Boolean) : [...X.products.values()].filter(p => p.kind === 'supply');
        if (sup.length) {
          say(A, 'Tell me which vial and I will list the supplies the catalog pairs with it. All supplies:');
          A.blocks.push({ t: 'list', items: sup.map(s => ({ text: clean(s.name) + ': ' + money(s.price_from) + (s.in_stock ? '' : ' (out of stock)'), url: s.url })) });
        } else say(A, 'Tell me which vial and I will list the supplies the catalog pairs with it.');
      }
      const hubPage = typePage(X, 'supplies-hub');
      links(A, [pageLink(hubPage, 'Shop all supplies'), pageLink(guidePage(X, 'how-to-reconstitute')), pageLink(toolPage(X, 'reconstitution-calculator'))]);
    },

    category(r, X, A) {
      const c = r.category;
      if (c && c.products.length) {
        const items = c.products.map(s => X.products.get(s)).filter(Boolean);
        say(A, c.name + ': ' + items.length + (items.length === 1 ? ' product.' : ' products.'));
        A.blocks.push({ t: 'list', items: items.slice(0, 14).map(p => ({ text: clean(p.name) + ': ' + (p.price_from !== p.price_to ? 'from ' : '') + money(p.price_from) + (p.in_stock ? '' : ' (out of stock)'), url: p.url })) });
        links(A, [{ url: c.url, label: 'Shop ' + c.name }]);
        return;
      }
      say(A, 'Shop by category:');
      A.blocks.push({ t: 'list', items: X.cats.map(cat => ({ text: clean(cat.name) + ' (' + cat.products.length + ')', url: cat.url })) });
      links(A, [pageLink(typePage(X, 'shop-hub'), 'All peptides')]);
    },

    wholesale(r, X, A) {
      const wp = typePage(X, 'wholesale');
      const apply = typePage(X, 'wholesale-apply');
      const pl = typePage(X, 'private-label');
      const wantsPL = /\b(private|white) label\b/.test(r.text);
      if (wantsPL && !(X.site.private_label && pl)) {
        say(A, 'For private or white label questions, our team answers directly.');
        handoffLine(A, X);
        if (wp) links(A, [pageLink(wp)]);
        return;
      }
      const fm = faqMatch(r, X, { types: ['wholesale', 'private-label', 'faq', 'product', 'blog-post'] });
      if (wp && wp.summary) quote(A, wp.summary, wp);
      else if (X.site.wholesale) say(A, 'Wholesale and bulk orders are available.');
      if (fm && (!wp || fm.f.a !== wp.summary)) quote(A, fm.f.a, fm.f.pg);
      for (const p of r.products.slice(0, 2)) {
        if (p.bulk_note) quote(A, p.bulk_note, { url: p.url, h1: p.name });
        const bulkBlog = (p.blog || []).map(u => urlPage(X, u)).filter(b => b && /bulk/i.test(b.url));
        if (bulkBlog.length) links(A, bulkBlog.map(b => pageLink(b, 'Read: ' + b.h1)));
      }
      links(A, [pageLink(wp), pageLink(apply), wantsPL && X.site.private_label ? pageLink(pl) : null]);
      if (X.site.wholesale) say(A, 'Terms are confirmed on application.');
      handoffLine(A, X, 'Questions about a large order?');
    },

    trust(r, X, A) {
      const sub = r.sub;
      if (sub === 'research') {
        const ru = findPage(X, p => p.type === 'legal' && /research-use/.test(p.url));
        if (X.site.research_use_label) say(A, 'Every product here is labeled: ' + X.site.research_use_label);
        if (ru && ru.summary) quote(A, ru.summary, ru);
        links(A, [pageLink(ru, 'Research use policy')]);
        return;
      }
      if (sub === 'coa') {
        const lab = findPage(X, p => p.type === 'plan' && p.plan === 'lab-results');
        if (X.site.coa) say(A, 'Certificates of analysis are available for every lot.');
        if (lab && lab.summary) quote(A, lab.summary, lab);
        const fm = faqMatch(r, X, { pageUrl: null });
        if (fm && (!lab || fm.f.a !== lab.summary)) quote(A, fm.f.a, fm.f.pg);
        links(A, [pageLink(lab)]);
        handoffLine(A, X, 'For the certificate of a specific lot, ask our team.');
        return;
      }
      if (sub === 'shipping') {
        const sp = typePage(X, 'shipping');
        const from = X.site.ship_from, to = X.site.ship_to;
        if (to || from) say(A, 'We ship' + (to ? ' ' + to : '') + (from ? ' from ' + from : '') + '.');
        const fm = faqMatch(r, X, {});
        if (fm) quote(A, fm.f.a, fm.f.pg);
        else if (sp && sp.summary) quote(A, sp.summary, sp);
        links(A, [pageLink(sp, 'Shipping policy')]);
        if (!to && !from && !fm && !(sp && sp.summary)) handoffLine(A, X);
        return;
      }
      if (sub === 'returns') {
        const rp = typePage(X, 'returns');
        const fm = faqMatch(r, X, {});
        if (fm) quote(A, fm.f.a, fm.f.pg); else if (rp && rp.summary) quote(A, rp.summary, rp);
        links(A, [pageLink(rp, 'Returns and refunds')]);
        handoffLine(A, X, 'For a damaged or wrong item,');
        return;
      }
      if (sub === 'payment') {
        const fm = faqMatch(r, X, {});
        if (fm) quote(A, fm.f.a, fm.f.pg);
        handoffLine(A, X, fm ? '' : 'For payment questions, our team answers directly.');
        return;
      }
      // reviews and legitimacy
      const lab = findPage(X, p => p.type === 'plan' && p.plan === 'lab-results');
      const rev = findPage(X, p => p.type === 'plan' && p.plan === 'reviews');
      const about = typePage(X, 'about');
      const fm = faqMatch(r, X, {});
      if (fm) quote(A, fm.f.a, fm.f.pg);
      else if (about && about.summary) quote(A, about.summary, about);
      else say(A, 'These pages show who we are and how products are documented:');
      links(A, [pageLink(about), pageLink(lab), pageLink(rev), pageLink(typePage(X, 'review-policy'))]);
    },

    location(r, X, A) {
      const ship = X.site.ship_to ? 'We ship ' + X.site.ship_to + '.' : '';
      const real = X.locations || [];
      const pl = r.places[0];
      const stateName = r.states[0] ? STATE_NAMES[r.states[0]] : null;
      const where = pl ? pl.name + (pl.state ? ', ' + pl.state : '') : stateName;
      const match = real.filter(l => pl && [l.city, l.place, l.name].some(v => v && norm(v).includes(norm(pl.name))));
      if (match.length) {
        say(A, 'Listed location' + (match.length > 1 ? 's' : '') + ' in ' + where + ':');
        A.blocks.push({ t: 'list', items: match.map(l => ({ text: clean(l.name || l.city || ''), url: l.url || null })) });
      } else if (where) {
        say(A, 'There is no store location listed in ' + where + '. ' + ship);
      } else if (real.length) {
        say(A, 'Listed locations:');
        A.blocks.push({ t: 'list', items: real.map(l => ({ text: clean([l.name, l.city, l.state].filter(Boolean).join(', ')), url: l.url || null })) });
      } else {
        say(A, 'There is no store location listed yet. ' + ship);
      }
      for (const p of r.products.slice(0, 2)) productCard(A, p);
      const hubs = pl ? [] : stateName ? (index_places(X).filter(p => p.state === r.states[0] && p.hub && p.url)) : [];
      const lp = typePage(X, 'locations-hub');
      links(A, [pl && pl.url ? { url: pl.url, label: (urlPage(X, pl.url) || {}).h1 || pl.name } : null, ...hubs.map(h => ({ url: h.url, label: (urlPage(X, h.url) || {}).h1 || h.name })), pageLink(lp, 'All locations'), pageLink(typePage(X, 'shipping'), 'Shipping policy')]);
    },

    what(r, X, A) {
      const subs = subjectsOf(r);
      if (!subs.length && r.ambiguous.length) return disambiguate(r, X, A);
      if (r.sub === 'regulatory' && subs.length) {
        for (const s of subs.slice(0, 2)) {
          const prof = profilePage(X, s.slug);
          const fact = prof && (prof.facts || []).find(f => /regulat|fda|approv|status|wada|legal/i.test(f[0]));
          const fm = faqMatch(r, X, {});
          if (fm) quote(A, fm.f.a, fm.f.pg);
          else if (fact) quote(A, fact[0] + ': ' + fact[1], prof);
          else say(A, 'The ' + s.name + ' profile has a sourced regulatory status section.');
          links(A, [pageLink(prof)]);
        }
        vialNote(A, r);
        return;
      }
      if (subs.length) {
        for (const s of subs.slice(0, 2)) {
          const prof = profilePage(X, s.slug);
          const fm = faqMatch(r, X, {});
          if (fm && fm.score > 0.7) quote(A, fm.f.a, fm.f.pg);
          else if (prof && prof.summary) quote(A, prof.summary, prof);
          else if (s.p) {
            const prodPage = urlPage(X, s.p.url);
            if (prodPage && prodPage.summary) quote(A, prodPage.summary, prodPage);
            else say(A, 'Here is what we have on ' + s.name + '.');
          } else say(A, 'Here is what we have on ' + s.name + '.');
          const l = [pageLink(prof)];
          if (s.p && !s.p.research_vial) l.push({ url: s.p.url, label: (s.p.in_stock ? 'Buy ' : 'View ') + s.p.name });
          if (s.p && s.p.research_vial) l.push({ url: s.p.url, label: vialName(s.p) });
          links(A, l);
        }
        vialNote(A, r);
        const s0 = subs[0];
        if (sideEffectsPage(X, s0.slug)) A.chips.push(s0.name + ' side effects');
        if (s0.p) A.chips.push(s0.name + ' price');
        return;
      }
      if (r.term) {
        quote(A, r.term.term + ': ' + r.term.def, typePage(X, 'glossary'));
        if (r.term.link && urlPage(X, r.term.link)) links(A, [pageLink(urlPage(X, r.term.link))]);
        return;
      }
      const t = r.text;
      const pick = /research peptides?/.test(t) ? typePage(X, 'type-hub', p => p.hub === 'research-peptides')
        : /\b(blend|blends|stack|stacks)\b/.test(t) ? typePage(X, 'type-hub', p => p.hub === 'blends-and-stacks')
          : /\bsupplies\b/.test(t) ? typePage(X, 'type-hub', p => p.hub === 'supplies')
            : /\bpeptides?\b/.test(t) ? typePage(X, 'learn-root') : null;
      const fm = faqMatch(r, X, {});
      if (pick) { if (pick.summary) quote(A, pick.summary, pick); else say(A, 'Start here:'); links(A, [pageLink(pick), pageLink(typePage(X, 'peptide-hub'))]); return; }
      if (fm) { quote(A, fm.f.a, fm.f.pg); links(A, [pageLink(fm.f.pg)]); return; }
      BUILD.unknown(r, X, A);
    },

    goal(r, X, A) {
      const goals = r.goals.slice(0, 2);
      if (!goals.length) {
        say(A, 'Our goal pages map what published research reports for each goal. They make no promise and are not advice for any person.');
        A.blocks.push({ t: 'list', items: [...X.goalHubs.values()].map(g => ({ text: clean(g.h1), url: g.url })) });
        return;
      }
      for (const g of goals) {
        const hub = X.goalHubs.get(g);
        const subs = subjectsOf(r);
        if (subs.length) {
          for (const s of subs.slice(0, 2)) {
            const gp = findPage(X, p => p.type === 'goal-peptide' && p.goal === g && p.subject === s.slug);
            const ben = childPage(X, s.slug, 'benefits');
            const src = gp || ben;
            if (src && src.summary) quote(A, src.summary, src);
            else say(A, 'Read what published sources report on ' + s.name + ':');
            links(A, [pageLink(gp), pageLink(ben), pageLink(profilePage(X, s.slug)), pageLink(hub)]);
          }
        } else {
          if (hub.summary) quote(A, hub.summary, hub);
          const gps = [...X.pages.values()].filter(p => p.type === 'goal-peptide' && p.goal === g);
          links(A, [pageLink(hub), ...gps.slice(0, 8).map(p => pageLink(p))]);
        }
      }
      note(A, 'These pages summarize published research. They make no promise and are not advice for any person.');
      if (r.flags.personalDose || r.flags.personalHealth || /\b(should i|for me|recommend)\b/.test(r.text)) handoffLine(A, X, 'I cannot recommend a product for a person.');
    },

    side_effects(r, X, A) {
      const subs = subjectsOf(r);
      if (!subs.length && r.ambiguous.length) return disambiguate(r, X, A);
      if (subs.length) {
        for (const s of subs.slice(0, 2)) {
          const se = sideEffectsPage(X, s.slug);
          const prof = profilePage(X, s.slug);
          const fm = faqMatch(r, X, { types: ['profile-child', 'profile', 'guide', 'type-hub', 'faq'] });
          if (se && se.summary) quote(A, se.summary, se);
          else if (fm) quote(A, fm.f.a, fm.f.pg);
          else if (prof) say(A, 'The ' + s.name + ' profile has a sourced side effects section.');
          else say(A, 'We do not have a side effects page for ' + s.name + ' yet.');
          links(A, [pageLink(se), pageLink(prof), pageLink(guidePage(X, 'safety-basics'))]);
        }
      } else {
        const g = guidePage(X, 'safety-basics');
        const fm = faqMatch(r, X, {});
        if (fm) quote(A, fm.f.a, fm.f.pg); else if (g && g.summary) quote(A, g.summary, g);
        links(A, [pageLink(g)]);
      }
      if (r.sub === 'personal' || r.flags.personalHealth) handoffLine(A, X, 'I cannot give medical advice for a person. Questions about your own health belong with a licensed clinician.');
      else A.chips.push('Talk to a person');
    },

    dosage(r, X, A) {
      const personal = r.sub === 'personal' || r.flags.personalDose;
      const subs = subjectsOf(r);
      if (!subs.length && r.ambiguous.length && !personal) return disambiguate(r, X, A);
      A.noNumbers = personal;
      if (subs.length) {
        for (const s of subs.slice(0, 2)) {
          const dp = childPage(X, s.slug, 'dosage');
          const prof = profilePage(X, s.slug);
          if (!personal && dp && dp.summary) quote(A, dp.summary, dp);
          else if (dp) say(A, 'Published dosing information for ' + s.name + ' is on its dosage page.');
          else if (prof) say(A, 'The ' + s.name + ' profile has a sourced dosage information section.');
          links(A, [pageLink(dp), pageLink(prof), pageLink(guidePage(X, 'dosing-basics'))]);
        }
      } else {
        const g = guidePage(X, 'dosing-basics');
        if (!personal && g && g.summary) quote(A, g.summary, g);
        else say(A, 'How amounts are written (mg, mcg, IU) and how syringe units work is explained here:');
        links(A, [pageLink(g)]);
      }
      if (r.products.some(p => p.kind !== 'supply') && X.site.research_use_label) note(A, X.site.research_use_label);
      handoffLine(A, X, 'I cannot suggest a dose for you or anyone.');
    },

    howto(r, X, A) {
      const sub = r.sub;
      const subs = subjectsOf(r);
      const recon = guidePage(X, 'how-to-reconstitute');
      const calcP = toolPage(X, 'peptide-calculator');
      const calcR = toolPage(X, 'reconstitution-calculator');
      const conv = toolPage(X, 'units-converter');
      if (sub === 'inject') {
        const research = r.products.filter(p => p.kind !== 'supply');
        if (research.length && !r.brands.length) {
          say(A, research.map(p => p.name).join(' and ') + (research.length > 1 ? ' are' : ' is') + ' sold for research use only. I do not give instructions for injecting a research compound.');
          if (X.site.research_use_label) note(A, X.site.research_use_label);
          const ru = findPage(X, p => p.type === 'legal' && /research-use/.test(p.url));
          links(A, [pageLink(ru, 'Research use policy')]);
          handoffLine(A, X);
          return;
        }
        if (r.brands.length) {
          for (const b of r.brands.slice(0, 2)) {
            const pen = childPage(X, b.slug, 'reconstitution');
            if (pen && pen.summary) quote(A, pen.summary, pen);
            links(A, [pageLink(pen), pageLink(profilePage(X, b.slug))]);
          }
          links(A, [pageLink(guidePage(X, 'how-to-inject'))]);
          return;
        }
        const g = guidePage(X, 'how-to-inject');
        if (g && g.summary) quote(A, g.summary, g);
        links(A, [pageLink(g), pageLink(typePage(X, 'supplies-hub'), 'Supplies')]);
        return;
      }
      if (sub === 'store') {
        let any = false;
        for (const p of r.products.slice(0, 2)) if (p.storage) { quote(A, p.storage, { url: p.url, h1: p.name }); any = true; }
        for (const b of r.brands.slice(0, 1)) { const pen = childPage(X, b.slug, 'reconstitution'); if (pen && pen.summary) { quote(A, pen.summary, pen); any = true; } }
        const g = guidePage(X, 'how-to-store');
        if (!any) { const fm = faqMatch(r, X, {}); if (fm) quote(A, fm.f.a, fm.f.pg); else if (g && g.summary) quote(A, g.summary, g); }
        links(A, [pageLink(g)]);
        return;
      }
      if (sub === 'calculate' || calcReady(r.amounts)) {
        const done = !r.flags.personalDose && arithmetic(r, A);
        if (!done) say(A, 'The calculators do the arithmetic: enter the amount in the vial, the water added and the amount to measure, and they show the concentration, the volume and the U-100 syringe units with the formula.');
        links(A, [pageLink(calcP), pageLink(calcR), pageLink(conv)]);
        return;
      }
      // reconstitute
      let any = false;
      for (const s of subs.slice(0, 2)) {
        const rc = childPage(X, s.slug, 'reconstitution');
        if (rc && rc.summary) { quote(A, rc.summary, rc); any = true; }
        if (rc) links(A, [pageLink(rc)]);
      }
      if (calcReady(r.amounts)) any = arithmetic(r, A) || any;
      else if (r.amounts.some(a => a.u === 'mg' || a.u === 'mcg' || a.u === 'iu')) {
        say(A, 'The amount of water you add sets the concentration: concentration = amount in the vial / water added. The reconstitution calculator shows the result for any volume.');
        any = true;
      }
      if (!any && recon && recon.summary) quote(A, recon.summary, recon);
      const bw = X.products.get('bacteriostatic-water');
      links(A, [pageLink(recon), pageLink(calcR), pageLink(calcP), bw ? { url: bw.url, label: bw.name + ' ' + money(bw.price_from) } : null]);
    },

    compare(r, X, A) {
      const subs = subjectsOf(r);
      const slugs = subs.map(s => s.slug);
      let cp = null;
      for (let i = 0; i < slugs.length && !cp; i++) for (let j = 0; j < slugs.length && !cp; j++) {
        if (i === j) continue;
        cp = findPage(X, p => p.type === 'compare' && p.a === slugs[i] && p.b === slugs[j]);
      }
      if (cp) {
        if (cp.summary) quote(A, cp.summary, cp); else say(A, 'Side by side:');
        links(A, [pageLink(cp)]);
      } else if (subs.length >= 2) {
        say(A, 'There is no side by side page for ' + subs.slice(0, 2).map(entName).join(' and ') + '. Each profile:');
        links(A, subs.slice(0, 3).map(s => pageLink(profilePage(X, s.slug))));
      } else {
        const hub = typePage(X, 'compare-hub');
        say(A, 'Name two products or medicines to compare.');
        links(A, [pageLink(hub)]);
      }
      glpGuard(r, X, A);
      if (!r.brands.length) for (const p of r.products.slice(0, 2)) if (!p.research_vial && p.kind !== 'supply') A.chips.push(p.name + ' price');
    },

    brand(r, X, A) {
      // a brand-name medicine (or a GLP-1 research vial asked about as a prescription): no vial, price or product link
      if (r.sub === 'glp') {
        const vials = r.products.filter(p => p.research_vial);
        say(A, vials.map(vialName).join(' and ') + (vials.length > 1 ? ' are' : ' is') + ' labeled for research use only. ' + (vials.length > 1 ? 'They are' : 'It is') + ' not a prescription, compounded or generic medicine and not a substitute for one, and we do not handle prescription, insurance or clinic questions.');
        if (X.site.research_use_label) note(A, X.site.research_use_label);
        links(A, vials.map(p => pageLink(profilePage(X, p.slug))));
        handoffLine(A, X);
        return;
      }
      const names = r.brands.map(b => b.name);
      say(A, (X.site.brand || 'We') + ' does not sell ' + names.join(' or ') + '. Research vials sold here are labeled for research use only and are not prescription medicines, generics or substitutes for ' + names.join(' or ') + '.');
      links(A, r.brands.map(b => pageLink(profilePage(X, b.slug), 'What is ' + b.name + '?')));
      handoffLine(A, X);
    },

    handoff(r, X, A) {
      if (r.sub === 'legal') {
        say(A, 'I cannot give an opinion on legal or prescription status.');
        const subs = subjectsOf(r);
        const ru = findPage(X, p => p.type === 'legal' && /research-use/.test(p.url));
        links(A, [...subs.slice(0, 2).map(s => pageLink(profilePage(X, s.slug))), pageLink(ru, 'Research use policy')]);
        handoffLine(A, X);
        return;
      }
      const t = r.text;
      if (/\b(damaged|wrong item|refund|return)\b/.test(t)) links(A, [pageLink(typePage(X, 'returns'), 'Returns and refunds')]);
      handoffLine(A, X, /\b(order|package|shipment|tracking)\b/.test(t) ? 'For an order question, our team can look it up.' : '');
    },

    unknown(r, X, A) {
      const fm = faqMatch(r, X, { min: 0.6 });
      if (fm) { quote(A, fm.f.a, fm.f.pg); links(A, [pageLink(fm.f.pg)]); A.intent = 'faq'; return; }
      say(A, 'I could not find an answer to that in our catalog or pages. I can help with products, prices, supplies, shipping, certificates, wholesale and the topics our pages cover.');
      links(A, [searchLink(r), pageLink(typePage(X, 'faq'), 'Questions and answers')]);
      handoffLine(A, X);
      A.chips.push(...starterChips(X).slice(0, 3));
    },
  };

  function index_places(X) { return (X.index.places || []); }

  function disambiguate(r, X, A) {
    const opts = []; const seen = new Set();
    for (const a of r.ambiguous) for (const o of a.options) {
      const k = o.kind + ':' + o.id; if (seen.has(k)) continue; seen.add(k);
      const p = o.kind === 'p' ? X.products.get(o.id) : null;
      if (p) opts.push(p);
    }
    if (!opts.length) return BUILD.unknown(r, X, A);
    A.intent = r.intent === 'unknown' ? 'buy' : r.intent;
    say(A, 'Which one do you mean?');
    A.blocks.push({ t: 'list', items: opts.map(p => ({ text: clean(p.name) + ': ' + (p.price_from !== p.price_to ? 'from ' : '') + money(p.price_from), url: p.url })) });
    A.chips.push(...opts.slice(0, 4).map(p => p.name));
  }

  // a GLP-1 research vial named next to sourced facts about the approved medicine: say what the vial is
  function vialNote(A, r) {
    for (const p of r.products.filter(x => x.research_vial).slice(0, 2)) note(A, 'The ' + p.name + ' research vial sold here is labeled for research use only. It is not a prescription medicine.');
  }

  function glpGuard(r, X, A) {
    const vials = r.products.filter(p => p.research_vial);
    if (!vials.length || !(r.brands.length || r.flags.rx || r.flags.substitution)) return;
    const brandNames = r.brands.map(b => b.name);
    for (const v of vials) {
      note(A, 'The ' + v.name + ' research vial sold here is labeled for research use only. It is not a prescription medicine and not a substitute for ' + (brandNames.length ? brandNames.join(' or ') : 'any prescription medicine') + '.');
    }
    A.noVial = true;
  }

  function arithmetic(r, A) {
    const am = r.amounts.filter(a => !a.syringe);
    const water = am.find(a => a.u === 'ml' && a.water) || am.find(a => a.u === 'ml');
    const masses = am.filter(a => a.u === 'mg' || a.u === 'mcg');
    const ius = am.filter(a => a.u === 'iu');
    const unitsT = am.find(a => a.u === 'units');
    if (!water || !(water.v > 0)) return false;
    const lines = [];
    if (ius.length && !masses.length) {
      const vial = ius.find(a => a.vial) || ius.reduce((a, b) => (b.v > a.v ? b : a));
      const target = ius.find(a => a !== vial);
      const conc = vial.v / water.v;
      lines.push('Concentration: ' + fmt(vial.v) + ' IU / ' + fmt(water.v) + ' mL = ' + fmt(conc) + ' IU per mL');
      lines.push('Per 10 units on a U-100 syringe (0.1 mL): ' + fmt(conc * 0.1) + ' IU');
      if (target) { const vol = target.v / conc; lines.push('Volume for ' + fmt(target.v) + ' IU: ' + fmt(target.v) + ' / ' + fmt(conc) + ' = ' + fmt(vol) + ' mL = ' + fmt(vol * 100, 1) + ' units'); }
    } else if (masses.length) {
      const toMg = a => (a.u === 'mcg' ? a.v / 1000 : a.v);
      const vial = masses.find(a => a.vial) || masses.reduce((a, b) => (toMg(b) > toMg(a) ? b : a));
      const target = masses.find(a => a !== vial);
      const vialMg = toMg(vial);
      if (!(vialMg > 0)) return false;
      const conc = vialMg / water.v;
      lines.push('Concentration: ' + fmt(vialMg) + ' mg / ' + fmt(water.v) + ' mL = ' + fmt(conc) + ' mg/mL (' + fmt(conc * 1000) + ' mcg/mL)');
      lines.push('Each unit on a U-100 syringe holds 0.01 mL: ' + fmt(conc * 10) + ' mcg per unit');
      if (target) {
        const tMg = toMg(target);
        if (tMg > vialMg) { lines.push('The amount to measure (' + fmt(target.v) + ' ' + target.u + ') is more than the vial holds.'); }
        else {
          const vol = tMg / conc;
          lines.push('Volume for ' + fmt(target.v) + ' ' + target.u + ': ' + fmt(tMg) + ' mg / ' + fmt(conc) + ' mg/mL = ' + fmt(vol) + ' mL');
          lines.push('On a U-100 syringe: ' + fmt(vol) + ' mL x 100 = ' + fmt(vol * 100, 1) + ' units');
        }
      } else if (unitsT) {
        const vol = unitsT.v / 100;
        lines.push(fmt(unitsT.v) + ' units = ' + fmt(vol) + ' mL, which holds ' + fmt(conc * vol) + ' mg (' + fmt(conc * vol * 1000) + ' mcg)');
      }
    } else return false;
    A.blocks.push({ t: 'calc', lines: lines.map(clean) });
    note(A, 'Arithmetic only, from the numbers you gave. It is not a dose or a recommendation.');
    return true;
  }

  function searchLink(r) {
    const q = String(r.text || '').slice(0, 80);
    return q ? { url: '/d2cpeptides-redesign/search/?q=' + encodeURIComponent(q), label: 'Search the site for "' + clean(q) + '"' } : null;
  }

  function starterChips(X) {
    const c = [];
    const first = [...X.products.values()].find(p => p.kind !== 'supply' && p.in_stock);
    if (first) c.push(first.name + ' price');
    c.push('What do I need with a vial?');
    if (X.site.wholesale) c.push('Do you sell in bulk?');
    c.push('Certificates of analysis');
    c.push('Shipping');
    c.push('Talk to a person');
    return c;
  }

  function finish(A, X, r) {
    // links only to pages in the index; de-duplicate links across blocks
    const seen = new Set();
    for (const b of A.blocks) {
      if (b.t !== 'links') continue;
      b.items = b.items.filter(it => {
        const ok = it.url && (X.pages.has(it.url.split('#')[0]) || /^\/d2cpeptides\/search\/\?q=/.test(it.url) || [...X.products.values()].some(p => p.url === it.url));
        if (!ok || seen.has(it.url)) return false;
        seen.add(it.url); return true;
      });
    }
    A.blocks = A.blocks.filter(b => b.t !== 'links' || b.items.length);
    // brand answers and GLP guard answers never carry a research vial
    if (r.brands.length || A.intent === 'brand' || A.noVial) {
      const vialUrls = new Set([...X.products.values()].filter(p => p.research_vial).map(p => p.url));
      A.blocks = A.blocks.filter(b => !(b.t === 'product' && vialUrls.has(b.url)));
      for (const b of A.blocks) if (b.t === 'links') b.items = b.items.filter(it => !vialUrls.has(it.url));
      for (const b of A.blocks) if (b.t === 'list') b.items = b.items.filter(it => !vialUrls.has(it.url));
      A.blocks = A.blocks.filter(b => !(b.t === 'links' || b.t === 'list') || b.items.length);
    }
    // a question about the asker's own dose never gets a number back (quoted text included)
    if (A.noNumbers) {
      A.blocks = A.blocks.filter(b => !(b.t === 'quote' && /\d/.test(b.text.replace(/\b[a-z]+[- ]?\d+\b/gi, ''))));
    }
    A.chips = [...new Set(A.chips)].slice(0, 4);
    A.text = answerText(A);
    A.links = answerLinks(A);
  }

  function answerText(A) {
    const out = [];
    for (const b of A.blocks) {
      if (b.t === 'p' || b.t === 'note') out.push(b.text);
      else if (b.t === 'quote') out.push(b.text + (b.label ? ' (' + b.label + ')' : ''));
      else if (b.t === 'product') out.push(b.name + ': ' + b.lines.join('; ') + '. ' + b.stock + '.');
      else if (b.t === 'list') out.push(b.items.map(i => i.text).join('; '));
      else if (b.t === 'links') out.push(b.items.map(i => i.label).join('; '));
      else if (b.t === 'calc') out.push(b.lines.join('; '));
    }
    return out.join('\n');
  }
  function answerLinks(A) {
    const out = [];
    for (const b of A.blocks) {
      if (b.t === 'links' || b.t === 'list') for (const i of b.items) if (i.url) out.push(i.url);
      if (b.t === 'product' && b.url) out.push(b.url);
      if (b.t === 'quote' && b.url) out.push(b.url);
    }
    return out;
  }

  const Engine = { version: 1, loaded: true, prepare, route, answer, norm, parseAmounts, findEntities, money, fmt };
  G.D2CChatEngine = Engine;

  // =====================================================================================================
  // UI (browser only)
  // =====================================================================================================
  if (typeof document === 'undefined') return;

  const ME = document.currentScript; // only set while this file runs synchronously
  const INDEX_URL = G.D2C_CHAT_INDEX_URL || (ME && ME.dataset && ME.dataset.index) || '/d2cpeptides-redesign/chat-index.json';
  const PANEL_ID = 'chat-panel';
  let panel = null, log = null, input = null, chipsEl = null, launcher = null, lastFocus = null;
  let indexData = null, loading = null, convo = { pageUrl: location.pathname, last: [] };

  const pageType = () => (document.body && document.body.getAttribute('data-type')) || '';
  function track(event, params) {
    try {
      if (G.D2C && typeof G.D2C.track === 'function') G.D2C.track(event, params);
      else if (Array.isArray(G.dataLayer)) G.dataLayer.push(Object.assign({ event }, params));
    } catch (e) { /* analytics never breaks the panel */ }
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function injectStyles() {
    if (document.getElementById('d2c-chat-css')) return;
    const s = document.createElement('style');
    s.id = 'd2c-chat-css';
    // zero-specificity defaults (:where) so public/css/site.css always wins where it styles these classes
    s.textContent = [
      ':where(.chat-panel){position:fixed;right:20px;bottom:20px;z-index:900;width:min(400px,calc(100vw - 32px));height:min(640px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--white,#fff);color:var(--ink,#0a1220);border-radius:14px;box-shadow:0 24px 64px -20px rgba(10,18,32,.45),0 0 0 1px var(--line,rgba(10,18,32,.10));font:15px/1.5 Inter,system-ui,sans-serif;overflow:hidden}',
      ':where(.chat-panel[hidden]){display:none}',
      // a bottom sheet; never set top here, or it would override site.css's bottom-anchored panel on phones
      '@media (max-width:600px){:where(.chat-panel){left:0;right:0;bottom:0;width:100%;height:88vh;border-radius:14px 14px 0 0}}',
      ':where(.chat-panel__head){display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:var(--navy,#0a1220);color:var(--cream,#f6f1e7)}',
      ':where(.chat-panel__title){margin:0;font:600 17px/1.3 Fraunces,Georgia,serif;color:inherit}',
      ':where(.chat-panel__close){min-width:44px;min-height:44px;border:0;border-radius:999px;background:transparent;color:inherit;font-size:26px;line-height:1;cursor:pointer}',
      ':where(.chat-panel__close:hover){background:rgba(255,255,255,.12)}',
      ':where(.chat-panel__note){margin:0;padding:8px 16px;font-size:12.5px;color:var(--muted,#5b6b86);background:var(--cream,#f6f1e7);border-bottom:1px solid var(--line,rgba(10,18,32,.10))}',
      ':where(.chat-panel__log){flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}',
      ':where(.chat-msg){max-width:92%;padding:10px 12px;border-radius:14px;word-wrap:break-word}',
      ':where(.chat-msg p){margin:0 0 6px}:where(.chat-msg p:last-child){margin-bottom:0}',
      ':where(.chat-msg--user){align-self:flex-end;background:var(--navy-3,#14213d);color:#fff;border-bottom-right-radius:4px}',
      ':where(.chat-msg--bot){align-self:flex-start;background:var(--cream,#f6f1e7);border-bottom-left-radius:4px}',
      ':where(.chat-msg a){color:var(--red,#da303d);font-weight:600;text-underline-offset:2px}',
      ':where(.chat-quote){margin:6px 0;padding:8px 10px;border-left:3px solid var(--red,#da303d);background:var(--white,#fff);border-radius:0 8px 8px 0}',
      ':where(.chat-quote footer){margin-top:4px;font-size:12.5px;color:var(--muted,#5b6b86)}',
      ':where(.chat-card){margin:6px 0;padding:10px 12px;background:var(--white,#fff);border:1px solid var(--line,rgba(10,18,32,.10));border-radius:12px}',
      ':where(.chat-card__name){display:block;font-weight:700;color:var(--ink,#0a1220)}',
      ':where(.chat-card__lines){margin:4px 0;padding:0;list-style:none;font-size:14px}',
      ':where(.chat-card__stock){font-size:12.5px;font-weight:600;color:#1b7a43}:where(.chat-card__stock--oos){color:var(--red,#da303d)}',
      ':where(.chat-card__cta){display:inline-block;margin-top:6px}',
      ':where(.chat-list,.chat-links){margin:6px 0;padding-left:18px}:where(.chat-list li,.chat-links li){margin:2px 0}',
      ':where(.chat-calc){margin:6px 0;padding:8px 10px;background:var(--white,#fff);border-radius:8px;font:13.5px/1.55 ui-monospace,Menlo,Consolas,monospace}',
      ':where(.chat-note){font-size:12.5px;color:var(--muted,#5b6b86)}',
      ':where(.chat-panel__chips){display:flex;flex-wrap:wrap;gap:6px;padding:6px 14px}',
      ':where(.chat-chip){min-height:36px;padding:6px 12px;border:1px solid var(--line,rgba(10,18,32,.18));border-radius:999px;background:var(--white,#fff);color:var(--ink,#0a1220);font:500 13px/1.2 Inter,system-ui,sans-serif;cursor:pointer}',
      ':where(.chat-chip:hover){border-color:var(--red,#da303d)}',
      ':where(.chat-panel__form){display:flex;gap:8px;padding:10px 14px 14px;border-top:1px solid var(--line,rgba(10,18,32,.10))}',
      ':where(.chat-panel__label){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      ':where(.chat-panel__input){flex:1;min-width:0;min-height:44px;padding:8px 14px;border:1px solid var(--line,rgba(10,18,32,.25));border-radius:999px;font:15px Inter,system-ui,sans-serif;color:var(--ink,#0a1220);background:#fff}',
      ':where(.chat-panel__send){min-height:44px;padding:0 18px;border:0;border-radius:999px;background:var(--red,#da303d);color:#fff;font:600 15px Inter,system-ui,sans-serif;cursor:pointer}',
      ':where(.chat-panel__send:hover){background:var(--red-hi,#e84450)}',
      ':where(.chat-panel :focus-visible){outline:3px solid var(--red,#da303d);outline-offset:2px}',
      ':where(.chat-typing){font-size:13px;color:var(--muted,#5b6b86)}',
      '@media (max-width:600px){:where(html.chat-open body){overflow:hidden}}',
      '@media (prefers-reduced-motion:no-preference){:where(.chat-msg){animation:d2cChatIn .18s ease-out}}',
      '@keyframes d2cChatIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function build() {
    if (panel) return;
    injectStyles();
    panel = el('div', 'chat-panel');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', PANEL_ID + '-title');
    panel.hidden = true;
    const head = el('div', 'chat-panel__head');
    const title = el('h2', 'chat-panel__title', 'Questions and product finder');
    title.id = PANEL_ID + '-title';
    const close = el('button', 'chat-panel__close', '\u00d7');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closePanel);
    head.append(title, close);
    const noteEl = el('p', 'chat-panel__note', 'Answers come from our catalog and site pages. No medical or dosing advice.');
    log = el('div', 'chat-panel__log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions');
    log.tabIndex = 0;
    log.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const msg = a.closest('.chat-msg');
      track('chatbot_link', { intent: (msg && msg.getAttribute('data-intent')) || '', to_url: (a.getAttribute('href') || '').split(/[?#]/)[0] });
    });
    chipsEl = el('div', 'chat-panel__chips');
    const form = el('form', 'chat-panel__form');
    form.setAttribute('novalidate', '');
    const label = el('label', 'chat-panel__label', 'Your question');
    label.htmlFor = PANEL_ID + '-input';
    input = el('input', 'chat-panel__input');
    input.id = PANEL_ID + '-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.maxLength = 300;
    input.placeholder = 'Ask about a product, price or shipping';
    const send = el('button', 'chat-panel__send', 'Send');
    send.type = 'submit';
    form.append(label, input, send);
    form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
    panel.append(head, noteEl, log, chipsEl, form);
    panel.addEventListener('keydown', onKey);
    document.body.appendChild(panel);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function loadIndex() {
    if (indexData) return Promise.resolve(indexData);
    if (loading) return loading;
    loading = fetch(INDEX_URL, { credentials: 'same-origin' })
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(json => { indexData = json; Engine.prepare(json); return json; })
      .catch(err => { loading = null; throw err; });
    return loading;
  }

  function openPanel() {
    build();
    if (!panel.hidden) { input.focus(); return; }
    lastFocus = document.activeElement;
    panel.hidden = false;
    document.documentElement.classList.add('chat-open');
    setExpanded(true);
    track('chatbot_open', { page_type: pageType() });
    if (!log.childElementCount) {
      const wait = el('p', 'chat-typing', 'Loading answers...');
      log.appendChild(wait);
      loadIndex().then(idx => {
        wait.remove();
        if (idx.mode === 'staging') botNote('Staging preview: answers quote pages that are pending qualified review.');
        render(Engine.answer('hi', idx, convo));
      }).catch(() => {
        wait.remove();
        const m = el('div', 'chat-msg chat-msg--bot');
        const p = el('p', null, 'The answers could not load. Please try again, or contact us.');
        const a = el('a', null, 'Contact us'); a.href = '/d2cpeptides-redesign/contact/';
        m.append(p, a); log.appendChild(m);
      });
    }
    setTimeout(() => input.focus(), 0);
  }

  // Focus goes back to something the reader can see: the launcher that opened the panel, else what had focus before,
  // else the first visible launcher (pages carry two; the header one is hidden under 860px, the tab one above it).
  const canFocus = n => !!(n && n.isConnected && n !== document.body && n !== document.documentElement && typeof n.focus === 'function' && n.getClientRects().length);

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.documentElement.classList.remove('chat-open');
    setExpanded(false);
    const back = [launcher, lastFocus, ...document.querySelectorAll('.chat-launcher')].find(canFocus);
    launcher = null;
    if (back) back.focus();
  }

  function setExpanded(v) {
    document.querySelectorAll('.chat-launcher').forEach(b => { b.setAttribute('aria-expanded', v ? 'true' : 'false'); b.setAttribute('aria-controls', PANEL_ID); });
  }

  function botNote(text) { const m = el('div', 'chat-msg chat-msg--bot'); m.appendChild(el('p', 'chat-note', text)); log.appendChild(m); }

  function ask(q) {
    const text = String(q || '').replace(/[\u2013\u2014]/g, '-').trim();
    if (!text) return;
    input.value = '';
    const um = el('div', 'chat-msg chat-msg--user'); um.appendChild(el('p', null, text)); log.appendChild(um);
    scrollDown();
    loadIndex().then(idx => {
      const res = Engine.answer(text, idx, convo);
      convo = res.state;
      track('chatbot_intent', { page_type: pageType(), intent: res.intent });
      if (res.handoff) track('chatbot_handoff', { intent: res.intent });
      render(res);
    }).catch(() => botNote('The answers could not load. Please try again.'));
  }

  function linkEl(url, label) { const a = el('a', null, label); a.href = url; return a; }

  function render(res) {
    const m = el('div', 'chat-msg chat-msg--bot');
    m.setAttribute('data-intent', res.intent || '');
    for (const b of res.blocks) {
      if (b.t === 'p') m.appendChild(el('p', null, b.text));
      else if (b.t === 'note') m.appendChild(el('p', 'chat-note', b.text));
      else if (b.t === 'quote') {
        const bq = el('blockquote', 'chat-quote');
        bq.appendChild(el('p', null, b.text));
        if (b.url) { const ft = el('footer', null, 'From '); ft.appendChild(linkEl(b.url, b.label || 'this page')); bq.appendChild(ft); }
        m.appendChild(bq);
      } else if (b.t === 'product') {
        const c = el('div', 'chat-card');
        const name = linkEl(b.url, b.name); name.className = 'chat-card__name'; c.appendChild(name);
        const ul = el('ul', 'chat-card__lines');
        for (const l of b.lines) { const li = el('li', null, l); if (b.highlight && l.indexOf(b.highlight + ':') === 0) li.style.fontWeight = '700'; ul.appendChild(li); }
        c.appendChild(ul);
        c.appendChild(el('span', 'chat-card__stock' + (b.stock === 'In stock' ? '' : ' chat-card__stock--oos'), b.stock));
        const cta = linkEl(b.url, b.cta); cta.className = 'chat-card__cta'; c.appendChild(document.createTextNode(' ')); c.appendChild(cta);
        m.appendChild(c);
      } else if (b.t === 'list' || b.t === 'links') {
        const ul = el('ul', b.t === 'list' ? 'chat-list' : 'chat-links');
        for (const it of b.items) { const li = el('li'); if (it.url) li.appendChild(linkEl(it.url, b.t === 'list' ? it.text : it.label)); else li.textContent = it.text || it.label; ul.appendChild(li); }
        m.appendChild(ul);
      } else if (b.t === 'calc') {
        const d = el('div', 'chat-calc');
        for (const l of b.lines) d.appendChild(el('div', null, l));
        m.appendChild(d);
      }
    }
    log.appendChild(m);
    chipsEl.textContent = '';
    for (const c of res.chips || []) {
      const b = el('button', 'chat-chip', c); b.type = 'button';
      b.addEventListener('click', () => { ask(c); input.focus(); });
      chipsEl.appendChild(b);
    }
    scrollDown();
  }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function bindLaunchers() {
    document.querySelectorAll('.chat-launcher').forEach(b => {
      if (b.dataset.chatBound) return;
      b.dataset.chatBound = '1';
      b.setAttribute('aria-haspopup', 'dialog');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', e => { e.preventDefault(); launcher = b; if (panel && !panel.hidden) closePanel(); else openPanel(); });
      b.addEventListener('pointerenter', () => { loadIndex().catch(() => {}); }, { once: true });
    });
  }

  function init() {
    bindLaunchers();
    document.addEventListener('d2c:chat-open', () => openPanel());
    const want = G.__d2cChatOpen === true || (ME && ME.dataset && ME.dataset.open !== undefined) || location.hash === '#chat' ||
      [...document.querySelectorAll('.chat-launcher')].some(b => b.getAttribute('aria-expanded') === 'true' || b.dataset.open === 'true');
    G.__d2cChatOpen = false;
    if (want) openPanel();
  }

  G.D2CChat = { open: openPanel, close: closePanel, ask: q => { openPanel(); ask(q); }, engine: Engine };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
