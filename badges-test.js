/*
 * moda24.online — ТЕСТ нових плашок у правому куті.
 *   ?badges=test  — палітра 3: блідий фон, кольоровий текст;
 *   ?badges=test2 — палітра 2: приглушені суцільні кольори;
 *   ?badges=off   — вимкнути. Діє лише у своїй вкладці, до її закриття.
 * Перші 6 карток каталогу отримують тестові плашки; дані товарів у Тільді не змінюються.
 */
(function () {
  if (window.__m24bt) return; window.__m24bt = 1;
  document.documentElement.classList.add('m24bt');
  var pal = '3';
  try {
    var q = (location.search.match(/[?&]badges=(\w+)/) || [])[1];
    if (q === 'test2' || q === 'test') sessionStorage.setItem('m24bt', q === 'test2' ? '2' : '3');
    pal = sessionStorage.getItem('m24bt') === '2' ? '2' : '3';
  } catch (e) {}

  var S = 'html.m24bt body .t-catalog__card ';
  var css = document.createElement('style');
  css.textContent =
    S + '.t-catalog__card__mark-wrapper{inset:6px 6px auto auto!important;left:auto!important}' +
    S + '.t-catalog__card__mark{gap:4px!important;align-items:flex-end!important}' +
    S + '.mblok-badge{padding:5px 7px 4px!important;border-radius:4px!important;font:700 10px/1 Manrope,Arial,sans-serif!important;letter-spacing:.06em!important;box-shadow:0 1px 2px rgba(30,26,27,.06)!important}' +
    (pal === '2'
      ? S + '.mblok-badge--hit,' + S + '.mblok-badge--vip,' + S + '.mblok-badge--dark{background:#1E1A1B!important;color:#fff!important}' +
        S + '.mblok-badge--new{background:#4F7A57!important;color:#fff!important}' +
        S + '.mblok-badge--sale,' + S + '.mblok-badge--disc{background:#B5303F!important;color:#fff!important}' +
        S + '.mblok-badge--out{background:#8E2433!important;color:#fff!important}'
      : S + '.mblok-badge--hit{background:#fff!important;color:#1E1A1B!important}' +
        S + '.mblok-badge--new{background:#E3F1E6!important;color:#22633A!important}' +
        S + '.mblok-badge--sale,' + S + '.mblok-badge--disc{background:#FBE6E8!important;color:#B0233A!important}' +
        S + '.mblok-badge--vip,' + S + '.mblok-badge--dark{background:#EFEDEC!important;color:#1E1A1B!important}') +
    '@media (min-width:961px){' + S + '.t-catalog__card__mark-wrapper{inset:10px 10px auto auto!important}' + S + '.mblok-badge{font-size:11px!important;padding:6px 9px 5px!important}}';
  document.head.appendChild(css);

  var RAW = ['top', 'новинка', 'знижка, %', 'top, %', 'розпродаж', 'новинка, %'];

  function run() {
    var cards = document.querySelectorAll('.t-catalog__card');
    for (var i = 0; i < Math.min(6, cards.length); i++) {
      var card = cards[i];
      if (card.getAttribute('data-m24bt')) continue;
      var wrap = card.querySelector('.t-catalog__card__imgwrapper');
      if (!wrap) continue;
      card.setAttribute('data-m24bt', '1');
      var mark = card.querySelector('.t-catalog__card__mark');
      if (!mark) {
        var mw = document.createElement('div');
        mw.className = 't-catalog__card__mark-wrapper';
        mark = document.createElement('div');
        mark.className = 't-catalog__card__mark';
        mw.appendChild(mark);
        wrap.appendChild(mw);
      }
      // далі плашки малює звичайний скрипт сайту (mblok) з цього тексту
      mark.textContent = RAW[i];
      mark.removeAttribute('data-mblok-done');
      mark.removeAttribute('data-mblok-raw');
    }
  }
  // РОЗПРОДАЖ має свій відтінок (у скрипті сайту він того ж типу, що й ЗНИЖКА)
  function out() {
    document.querySelectorAll('.mblok-badge--sale:not(.mblok-badge--out)').forEach(function (b) {
      if (b.textContent.trim() === 'РОЗПРОДАЖ') b.classList.add('mblok-badge--out');
    });
  }
  run(); out();
  setInterval(function () { run(); out(); }, 500);
})();
