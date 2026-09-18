/*
 * Måling for vestfoldbilsalg.no – Google Analytics 4 (G-V4670QFVJ5).
 *
 * Lastes fra <head> på alle sider. Forsiden (index.html) er en pakket
 * fil som bytter ut hele dokumentet etter lasting; derfor henger alt
 * her på window og document, som overlever byttet – og selve
 * gtag.js-biblioteket legges først inn når det nye dokumentet står.
 *
 * Samtykke: Google Consent Mode v2. Ingen informasjonskapsler før den
 * besøkende har sagt ja. Valget huskes i localStorage («vb_samtykke»).
 *
 * Hendelser som sendes:
 *   verdivurdering  – skjemaet for gratis verdivurdering er sendt (formsubmit.co)
 *   telefon_klikk   – klikk på et telefonnummer
 *   epost_klikk     – klikk på en e-postadresse
 *   finn_klikk      – klikk til FINN.no
 *   anmeldelse_klikk – klikk på «Skriv en anmeldelse» (Google)
 */
(function () {
  var ID = 'G-V4670QFVJ5';
  var NOKKEL = 'vb_samtykke';

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  var lagret = null;
  try { lagret = localStorage.getItem(NOKKEL); } catch (e) {}

  gtag('consent', 'default', {
    analytics_storage: lagret === 'ja' ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });
  gtag('js', new Date());
  gtag('config', ID, { send_page_view: true });

  function hendelse(navn, data) {
    try { gtag('event', navn, data || {}); } catch (e) {}
  }

  // ── Klikk på telefon, e-post, FINN og anmeldelseslenke ──────────────
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) hendelse('telefon_klikk', { side: location.pathname });
    else if (href.indexOf('mailto:') === 0) hendelse('epost_klikk', { side: location.pathname });
    else if (href.indexOf('finn.no') !== -1) hendelse('finn_klikk', { side: location.pathname });
    else if (href.indexOf('g.page') !== -1) hendelse('anmeldelse_klikk', { side: location.pathname });
  }, true);

  // ── Verdivurdering: skjemaet sendes til formsubmit.co med fetch ─────
  var opprinneligFetch = window.fetch;
  if (opprinneligFetch) {
    window.fetch = function (inn, valg) {
      var url = typeof inn === 'string' ? inn : (inn && inn.url) || '';
      var p = opprinneligFetch.apply(this, arguments);
      if (url.indexOf('formsubmit.co') !== -1) {
        p.then(function (svar) {
          if (svar && svar.ok) hendelse('verdivurdering', { side: location.pathname });
        }).catch(function () {});
      }
      return p;
    };
  }

  // ── Samtykkebanner ───────────────────────────────────────────────────
  function visBanner() {
    if (lagret === 'ja' || lagret === 'nei') return;
    var b = document.createElement('div');
    b.id = 'vb-samtykke';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Informasjonskapsler');
    b.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;' +
      'background:#181716;color:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.35);' +
      'font:15px/1.5 Barlow,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;gap:14px;align-items:center;flex-wrap:wrap';
    b.innerHTML =
      '<span style="flex:1;min-width:220px">Vi bruker informasjonskapsler for å måle hvordan nettsiden brukes, så vi kan gjøre den bedre. Ingen annonsering.</span>' +
      '<span style="display:flex;gap:8px">' +
      '<button type="button" data-valg="nei" style="background:none;border:1px solid #c9c6c2;color:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer">Nei takk</button>' +
      '<button type="button" data-valg="ja" style="background:#c80205;border:none;color:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer">Greit</button>' +
      '</span>';
    b.addEventListener('click', function (e) {
      var k = e.target.closest ? e.target.closest('button[data-valg]') : null;
      if (!k) return;
      var valg = k.getAttribute('data-valg');
      try { localStorage.setItem(NOKKEL, valg); } catch (err) {}
      lagret = valg;
      gtag('consent', 'update', { analytics_storage: valg === 'ja' ? 'granted' : 'denied' });
      b.remove();
    });
    document.body.appendChild(b);
  }

  function lastGtag() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.appendChild(s);
  }

  // Forsiden bytter ut dokumentet et øyeblikk etter DOMContentLoaded;
  // vent til det er gjort før biblioteket og banneret legges inn,
  // ellers forsvinner de sammen med det gamle dokumentet.
  function nårKlar() {
    var forsøk = 0;
    (function sjekk() {
      var pakket = document.getElementById('__bundler_loading');
      if (pakket && forsøk++ < 100) return setTimeout(sjekk, 100);
      if (!document.body) return setTimeout(sjekk, 100);
      lastGtag();
      visBanner();
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nårKlar);
  else nårKlar();
})();
