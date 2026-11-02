/*
 * Завантажувач віджетів відгуків moda24.online
 * У Тільді лежить лише:  <div data-m24-widget="product"></div>
 *                        <script src="https://ecom82812-debug.github.io/moda24-reviews/widgets/loader.js?v=1" defer></script>
 * Сам віджет (розмітка, стилі, код) береться з GitHub — оновлюється без Тільди.
 */
(function () {
  if (window.__m24Loader) { window.__m24Loader(); return; }
  var BASE = 'https://ecom82812-debug.github.io/moda24-reviews/widgets/';
  var VERSION = '11'; // міняється при кожному оновленні віджетів

  function mount(host) {
    if (host.dataset.mounted) return;
    host.dataset.mounted = '1';
    var name = host.getAttribute('data-m24-widget');
    if (!/^[a-z-]+$/.test(name)) return;
    fetch(BASE + name + '.html?v=' + VERSION)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // стилі та шрифти — у <head> сторінки, один раз
        doc.head.querySelectorAll('style, link[rel="stylesheet"], link[rel="preconnect"]').forEach(function (el) {
          var key = 'm24w-' + name + '-' + (el.href || el.textContent.length);
          if (document.querySelector('[data-m24w="' + key + '"]')) return;
          var c = el.cloneNode(true);
          c.setAttribute('data-m24w', key);
          document.head.appendChild(c);
        });
        // розмітка
        var scripts = [];
        Array.prototype.slice.call(doc.body.childNodes).forEach(function (n) {
          if (n.nodeName === 'SCRIPT') { scripts.push(n); return; }
          host.appendChild(document.importNode(n, true));
        });
        // код — виконується після вставки розмітки
        scripts.forEach(function (s) {
          var el = document.createElement('script');
          el.textContent = s.textContent;
          host.appendChild(el);
        });
      })
      .catch(function (e) { host.dataset.mounted = ''; console.warn('m24 widget', name, e); });
  }

  function run() { document.querySelectorAll('[data-m24-widget]').forEach(mount); }
  window.__m24Loader = run;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
