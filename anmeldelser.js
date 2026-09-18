/*
 * Viser Google-anmeldelsene fra anmeldelser.json på forsiden.
 *
 * Fila fylles av bin/hent-anmeldelser.mjs (GitHub Actions, hver natt) og
 * inneholder bare anmeldelser med 5 stjerner. Er fila tom, holdes hele
 * seksjonen skjult – ingen tomme kort, ingen eksempeltekst.
 *
 * Forsiden er pakket og bytter ut dokumentet etter lasting, så vi venter
 * til seksjonen finnes før vi tegner.
 */
(function () {
  function stjerner() {
    return '<span aria-label="5 av 5 stjerner" style="color:#f4b400;letter-spacing:2px;font-size:18px">★★★★★</span>';
  }

  function tekstHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function kort(a) {
    var lang = a.tekst.length > 320;
    var vist = lang ? a.tekst.slice(0, 300).replace(/\s+\S*$/, '') + '…' : a.tekst;
    return '<article style="background:var(--white,#fff);border:1px solid var(--border-default,#e4e2df);border-radius:12px;' +
      'box-shadow:var(--shadow-card,0 1px 4px rgba(0,0,0,.06));padding:26px 24px;display:flex;flex-direction:column;gap:12px">' +
      '<div>' + stjerner() + '</div>' +
      '<p style="margin:0;color:var(--ink-900,#181716);font-size:17px;line-height:1.55" data-full="' + tekstHtml(a.tekst).replace(/"/g, '&quot;') + '">' +
      tekstHtml(vist) + (lang ? ' <button type="button" data-mer style="background:none;border:none;padding:0;color:var(--red-600,#c80205);font:inherit;font-weight:600;cursor:pointer">Les mer</button>' : '') +
      '</p>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:auto;font-size:14px;color:var(--ink-700,#454340)">' +
      (a.bilde ? '<img src="' + a.bilde + '" alt="" width="32" height="32" loading="lazy" referrerpolicy="no-referrer" style="border-radius:50%">' : '') +
      '<span><strong style="color:var(--ink-900,#181716)">' + tekstHtml(a.navn) + '</strong>' + (a.tid ? ' · ' + tekstHtml(a.tid) : '') + '</span>' +
      '</div></article>';
  }

  function tegn(data) {
    var seksjon = document.getElementById('anmeldelser');
    var liste = document.getElementById('vb-google-anmeldelser');
    var sum = document.getElementById('vb-anmeldelser-sum');
    if (!seksjon || !liste) return false;
    var alle = (data && data.anmeldelser) || [];
    if (!alle.length) { seksjon.style.display = 'none'; return true; }
    liste.innerHTML = alle.slice(0, 6).map(kort).join('');
    if (sum && data.vurdering) {
      sum.innerHTML = '<strong style="font-size:22px;color:var(--ink-900,#181716)">' + Number(data.vurdering).toFixed(1).replace('.', ',') + '</strong> ' +
        stjerner() + ' <span>på Google' + (data.antall ? ' · ' + data.antall + ' anmeldelser' : '') + '</span>';
    }
    liste.addEventListener('click', function (e) {
      var k = e.target.closest ? e.target.closest('button[data-mer]') : null;
      if (!k) return;
      var p = k.parentElement;
      p.innerHTML = p.getAttribute('data-full');
    });
    seksjon.style.display = '';
    return true;
  }

  function start() {
    fetch('anmeldelser.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var forsøk = 0;
        (function prøv() {
          if (tegn(data)) return;
          if (forsøk++ < 100) setTimeout(prøv, 100);
        })();
      })
      .catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
