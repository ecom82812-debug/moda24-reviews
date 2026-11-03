/*
 * moda24.online — ТЕСТ нових плашок (палітра 3: блідий фон, кольоровий текст, правий кут).
 * Бачить лише той, хто відкрив сторінку з ?badges=test (до закриття вкладки); ?badges=off — вимкнути.
 * Перші 6 карток каталогу отримують тестові плашки; дані товарів у Тільді не змінюються.
 */
(function () {
  if (window.__m24bt) return; window.__m24bt = 1;
  document.documentElement.classList.add('m24bt');

  var S = 'html.m24bt body .t-catalog__card ';
  var css = document.createElement('style');
  css.textContent =
    S + '.t-catalog__card__mark-wrapper{inset:6px 6px auto auto!important;left:auto!important}' +
    S + '.t-catalog__card__mark{gap:4px!important;align-items:flex-end!important}' +
    S + '.mblok-badge{padding:5px 7px 4px!important;border-radius:4px!important;font:700 10px/1 Manrope,Arial,sans-serif!important;letter-spacing:.06em!important;box-shadow:0 1px 2px rgba(30,26,27,.06)!important}' +
    S + '.mblok-badge--hit{background:#fff!important;color:#1E1A1B!important}' +
    S + '.mblok-badge--new{background:#E3F1E6!important;color:#22633A!important}' +
    S + '.mblok-badge--sale,' + S + '.mblok-badge--disc{background:#FBE6E8!important;color:#B0233A!important}' +
    S + '.mblok-badge--vip,' + S + '.mblok-badge--dark{background:#EFEDEC!important;color:#1E1A1B!important}' +
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
  run();
  setInterval(run, 500);
})();
