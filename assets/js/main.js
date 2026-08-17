/* ==========================================================================
   Stride Guide — landing page behaviour
   Vanilla, no dependencies. Everything degrades to a readable static page.
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- header */
  var header = document.getElementById('site-header');
  var nav = document.getElementById('site-nav');
  var toggle = document.getElementById('nav-toggle');
  var mobileCta = document.getElementById('mobile-cta');
  var hero = document.querySelector('.hero');
  var early = document.getElementById('early-access');

  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        closeNav();
        toggle.focus();
      }
    });
  }

  var onScroll = function () {
    if (header) header.classList.toggle('is-stuck', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Compact sticky CTA on mobile: show once the hero is behind us, hide again
     while the early-access form itself is on screen. */
  if (mobileCta && 'IntersectionObserver' in window) {
    var heroPassed = false;
    var formVisible = false;

    var sync = function () {
      var show = heroPassed && !formVisible;
      if (show) mobileCta.hidden = false;
      mobileCta.classList.toggle('is-visible', show);
    };

    if (hero) {
      new IntersectionObserver(function (entries) {
        heroPassed = !entries[0].isIntersecting;
        sync();
      }, { rootMargin: '-40% 0px 0px 0px' }).observe(hero);
    }
    if (early) {
      new IntersectionObserver(function (entries) {
        formVisible = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.08 }).observe(early);
    }
  }

  /* -------------------------------------------------------- scroll reveals */
  var revealables = document.querySelectorAll('.reveal, .hw__viz');

  function revealAll() {
    Array.prototype.forEach.call(revealables, function (el) { el.classList.add('is-in'); });
  }

  if (!('IntersectionObserver' in window) || reduceMotion) {
    revealAll();
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    /* Anything already on the first screen is shown straight away — the
       observer only handles content the visitor scrolls down to. */
    Array.prototype.forEach.call(revealables, function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.classList.add('is-in');
      } else {
        revealObserver.observe(el);
      }
    });

    /* Safety net: never leave copy hidden if observer callbacks don't run. */
    setTimeout(revealAll, 2500);
  }

  /* ------------------------------------------------- dashboard count-up KPIs */
  var counters = document.querySelectorAll('[data-count]');

  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    if (isNaN(target)) return;
    if (reduceMotion) { el.textContent = target + suffix; return; }

    var duration = 1100;
    var start = null;

    var tick = function (now) {
      if (start === null) start = now;
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };

    el.textContent = '0' + suffix;
    requestAnimationFrame(tick);
  }

  if (counters.length) {
    if (!('IntersectionObserver' in window)) {
      // Leave the server-rendered values in place.
    } else {
      var countObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            countUp(entry.target);
            countObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });
      Array.prototype.forEach.call(counters, function (el) { countObserver.observe(el); });
    }
  }

  /* ------------------------------------------------------------ pilot form */
  var form = document.getElementById('pilot-form');
  var status = document.getElementById('form-status');
  /* Set data-endpoint on the <form> to POST somewhere real; without it we hand
     the enquiry to the visitor's mail client rather than pretending to send. */
  var CONTACT = 'pilots@strideguide.co';

  function setError(input, message) {
    input.setAttribute('aria-invalid', 'true');
    var existing = input.parentNode.querySelector('.field__error');
    if (!existing) {
      existing = document.createElement('span');
      existing.className = 'field__error';
      input.parentNode.appendChild(existing);
    }
    existing.textContent = message;
  }

  function clearError(input) {
    input.removeAttribute('aria-invalid');
    var existing = input.parentNode.querySelector('.field__error');
    if (existing) existing.remove();
  }

  if (form) {
    form.addEventListener('input', function (e) {
      if (e.target.matches('input, select, textarea')) clearError(e.target);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var valid = true;

      Array.prototype.forEach.call(form.querySelectorAll('[required]'), function (input) {
        var value = input.value.trim();
        if (!value) {
          setError(input, 'This field is required.');
          valid = false;
        } else if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
          setError(input, 'Please enter a valid email address.');
          valid = false;
        }
      });

      if (!valid) {
        status.textContent = 'Please check the highlighted fields.';
        status.classList.add('is-error');
        var firstBad = form.querySelector('[aria-invalid="true"]');
        if (firstBad) firstBad.focus();
        return;
      }

      status.classList.remove('is-error');
      var data = new FormData(form);
      var endpoint = form.getAttribute('data-endpoint');

      if (endpoint) {
        status.textContent = 'Sending your pilot application…';
        fetch(endpoint, { method: 'POST', body: data })
          .then(function (res) {
            if (!res.ok) throw new Error('Request failed');
            form.reset();
            status.textContent = 'Thanks — we’ll be in touch about a pilot shortly.';
          })
          .catch(function () {
            status.classList.add('is-error');
            status.textContent = 'Something went wrong. Email ' + CONTACT + ' and we’ll pick it up from there.';
          });
        return;
      }

      var body = [
        'Store: ' + data.get('store'),
        'Contact: ' + data.get('name'),
        'Email: ' + data.get('email'),
        'Store type: ' + data.get('type'),
        '',
        (data.get('notes') || '').toString()
      ].join('\n');

      window.location.href = 'mailto:' + CONTACT +
        '?subject=' + encodeURIComponent('Early Store Pilot — ' + data.get('store')) +
        '&body=' + encodeURIComponent(body);

      status.textContent = 'Opening your email app with the details filled in — send it and we’ll reply.';
    });
  }

  /* --------------------------------------------------------------- details */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
