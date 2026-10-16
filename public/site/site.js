/* ScrubHub marketing site scripts */
(function () {
  // 1) Logged-in users who land on the home page (e.g. opening the installed app)
  //    get sent into the app instead of the marketing page.
  function hasSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.slice(-11) === '-auth-token') {
          var v = localStorage.getItem(k);
          if (v && v.length > 20) return true;
        }
      }
    } catch (e) {}
    return false;
  }
  var loggedIn = hasSession();
  var isHome = location.pathname === '/' || location.pathname === '/site/' || location.pathname === '/site/index.html';
  if (loggedIn && isHome && !/[?&]site=1/.test(location.search)) {
    location.replace('/login');
    return;
  }
  if (loggedIn) {
    document.querySelectorAll('[data-signin]').forEach(function (a) {
      a.textContent = 'Open app';
      a.setAttribute('href', '/login');
    });
  }

  // 2) Mobile menu
  var btn = document.querySelector('.menu-btn');
  var menu = document.getElementById('mobile-menu');
  if (btn && menu) {
    btn.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // 3) Monthly / yearly pricing toggle
  var toggle = document.querySelectorAll('[data-billing]');
  function setBilling(mode) {
    toggle.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.billing === mode ? 'true' : 'false'); });
    document.querySelectorAll('[data-plan]').forEach(function (card) {
      var p = window.SCRUBHUB_PRICING[card.dataset.plan];
      if (!p) return;
      var amt = card.querySelector('.amt');
      var per = card.querySelector('.per');
      var note = card.querySelector('.price-note');
      var cta = card.querySelector('.plan-cta');
      if (mode === 'yearly') {
        amt.textContent = '$' + Math.round(p.yearly / 12);
        per.textContent = '/mo';
        note.textContent = '$' + p.yearly.toLocaleString() + ' billed yearly. 2 months free.';
      } else {
        amt.textContent = '$' + p.monthly;
        per.textContent = '/mo';
        note.textContent = 'Billed monthly. Cancel anytime.';
      }
      if (cta) cta.setAttribute('href', '/signup?plan=' + card.dataset.plan + '&billing=' + mode);
    });
  }
  if (toggle.length && window.SCRUBHUB_PRICING) {
    toggle.forEach(function (b) { b.addEventListener('click', function () { setBilling(b.dataset.billing); }); });
    setBilling('monthly');
  }

  // 4) Footer year
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
