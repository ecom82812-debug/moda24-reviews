/*
 * moda24.online — оцінки з відгуків у каталозі та на сторінці товару.
 *   • картка товару: невеликий бейдж на фото «★ 4,8 · 12» (лише якщо є відгуки);
 *   • сторінка товару: рядок під назвою «★ 4,8 · 12 відгуків», натиск веде до блоку відгуків.
 * Дані — один маленький файл ratings.json зі сховища review-cache (база не задіяна),
 * у браузері зберігається 3 хвилини.
 */
(function () {
  if (window.__m24rc) return; window.__m24rc = 1;

  var URL_R = 'https://lvyssuomgbccjmksetof.supabase.co/storage/v1/object/public/review-cache/v1/ratings.json';
  var KEY = 'm24r:ratings', TTL = 3 * 60 * 1000;
  var map = null, pending = null;

  var css = document.createElement('style');
  css.textContent =
    '.m24rc-b{position:absolute;left:8px;bottom:8px;z-index:3;display:inline-flex;align-items:center;gap:4px;padding:4px 8px 4px 7px;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 1px 4px rgba(30,26,27,.08);font:600 11px/1 Manrope,Arial,sans-serif;color:#1E1A1B;pointer-events:none}' +
    '.m24rc-b svg,.m24rc-p svg{width:12px;height:12px;color:#1E1A1B;flex:none}' +
    '.m24rc-b small{font-size:11px;font-weight:500;color:#8E8186}' +
    '.m24rc-p{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:7px;margin:10px 0 2px;font:500 13px/1.2 Manrope,Arial,sans-serif;color:#1E1A1B}' +
    '.m24rc-p svg{width:15px;height:15px}' +
    '.m24rc-p b{font-weight:700}' +
    '.m24rc-p span{color:#8E8186;border-bottom:1px solid #D4D4D2;padding-bottom:1px}' +
    '.m24rc-p:hover span{color:#1E1A1B;border-color:#1E1A1B}' +
    '@media (min-width:981px){.m24rc-b{left:10px;bottom:10px;font-size:12px;padding:5px 9px 5px 8px}}';
  document.head.appendChild(css);

  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.8c.4 0 .7.2.9.6l2.3 4.7 5.2.8c.8.1 1.1 1.1.5 1.7l-3.8 3.7.9 5.2c.1.8-.7 1.4-1.4 1L12 18l-4.6 2.5c-.7.4-1.6-.2-1.4-1l.9-5.2-3.8-3.7c-.6-.6-.3-1.6.5-1.7l5.2-.8 2.3-4.7c.2-.4.5-.6.9-.6z"/></svg>';
  function num(x) { return (+x).toFixed(1).replace('.', ','); }
  function plural(n, a, b, c) { var m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c); }

  function ratings() {
    if (map) return Promise.resolve(map);
    if (pending) return pending;
    var c = null;
    try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (c && Date.now() - c.t < TTL) { map = c.d; return Promise.resolve(map); }
    var ctl = window.AbortController ? new AbortController() : null;
    var tm = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    pending = fetch(URL_R + '?t=' + Math.floor(Date.now() / 60000), ctl ? { signal: ctl.signal } : {})
      .then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        map = d.r || {};
        try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: map })); } catch (e) {}
        return map;
      })
      .catch(function () { map = c ? c.d : {}; return map; });
    return pending;
  }

  /* картки каталогу (категорії, «З цим також купують», «Ви переглядали», пошук) */
  function cards() {
    var list = document.querySelectorAll('.t-catalog__card[data-product-gen-uid]:not([data-m24rc]), .t-store__card[data-product-gen-uid]:not([data-m24rc])');
    if (!list.length) return;
    ratings().then(function (m) {
      list.forEach(function (card) {
        if (card.getAttribute('data-m24rc')) return;
        card.setAttribute('data-m24rc', '1');
        var x = m[card.getAttribute('data-product-gen-uid')];
        if (!x || !x[1]) return;
        var wrap = card.querySelector('.t-catalog__card__imgwrapper, .t-store__card__imgwrapper');
        if (!wrap) return;
        var b = document.createElement('span');
        b.className = 'm24rc-b';
        b.setAttribute('aria-label', 'Оцінка ' + num(x[0]) + ' з 5, відгуків: ' + x[1]);
        b.innerHTML = STAR + num(x[0]) + '<small>· ' + x[1] + '</small>';
        wrap.appendChild(b);
      });
    });
  }

  /* рядок під назвою на сторінці товару */
  function product() {
    var u = location.pathname.match(/tproduct[\/-](\d{6,})/);
    if (!u || document.querySelector('.m24rc-p')) return;
    var h = document.querySelector('h1.js-catalog-prod-name, .t-catalog__prod-popup__name, .t-store__prod-popup__name');
    if (!h) return;
    ratings().then(function (m) {
      var x = m[u[1]];
      if (!x || !x[1] || document.querySelector('.m24rc-p')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'm24rc-p';
      b.innerHTML = STAR + '<b>' + num(x[0]) + '</b><span>' + x[1] + ' ' + plural(x[1], 'відгук', 'відгуки', 'відгуків') + '</span>';
      b.addEventListener('click', function () {
        var w = document.getElementById('m24-reviews');
        if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      h.parentNode.insertBefore(b, h.nextSibling);
    });
  }

  var timer = null;
  function run() { timer = null; cards(); product(); }
  function schedule() { if (!timer) timer = setTimeout(run, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  if ('MutationObserver' in window) new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
