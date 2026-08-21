/* =============================================================================
 * Stride Guide kiosk client.
 *
 * ES5 syntax throughout — no const, no let, no arrow functions, no template
 * literals, no destructuring, no optional chaining. Not because WebKit 12.1
 * lacks all of those (it has most of them), but because "ES5 only" is a rule a
 * parser can check, and src/lib/kiosk/compat.ts checks it on every test run.
 * "Whatever Safari 12.1 happens to support" is not a rule anyone can check.
 *
 * Three things this file is responsible for, and nothing else:
 *
 *   1. Enforce the transition table it was handed. It does not contain a copy
 *      of the flow; the flow arrives as JSON from src/lib/kiosk/machine.ts.
 *   2. Hold the customer's answers in exactly one object, so that clearing them
 *      is one assignment rather than a checklist.
 *   3. Show one screen at a time by toggling a class. It never builds a screen,
 *      and it never assigns innerHTML from server data.
 *
 * -- On the reset guarantee ----------------------------------------------------
 *
 * `resetSession()` is the only way back to IDLE. Every path out of the flow goes
 * through it: finishing, declining, timing out, an error, an associate's reset,
 * a bfcache restore, a popstate, a reload. It nulls the state object, blanks
 * every input in the document, clears every timer, and tells the server to void
 * the fitting. Navigating to /kiosk is NOT a reset and is never used as one.
 * ========================================================================== */
(function () {
  'use strict';

  var BOOT = JSON.parse(document.getElementById('kiosk-bootstrap').textContent);
  var T = BOOT.transitions;
  var CFG = BOOT.config;
  var MSG = BOOT.messages;

  /* ── machine ──────────────────────────────────────────────────────────── */

  var machine = { state: BOOT.enrolled ? 'IDLE' : 'UNENROLLED', resumeFrom: null };

  /** Apply an event. Returns true if it was legal; false is a no-op, never a throw. */
  function fire(event) {
    var next;
    if (event === 'NETWORK_BACK') {
      if (machine.state !== 'NETWORK_OFFLINE' || !machine.resumeFrom) return false;
      next = machine.resumeFrom;
      machine = { state: next, resumeFrom: null };
      render();
      return true;
    }
    var row = T[machine.state];
    next = row ? row[event] : null;
    if (!next) return false;
    machine = { state: next, resumeFrom: event === 'NETWORK_LOST' ? machine.state : null };
    render();
    return true;
  }

  /* ── the one place customer data lives ────────────────────────────────── */

  function blankSession() {
    return {
      phone: '', firstName: '', lastName: '',
      consentReport: false, guest: false,
      sessionId: null, visitNumber: 1, returning: false,
      questions: [], questionIndex: 0, answers: {},
      results: null, canDeliver: false, maskedPhone: null
    };
  }
  var S = blankSession();

  var timers = {};
  function stopTimer(name) {
    if (timers[name]) { clearTimeout(timers[name]); clearInterval(timers[name]); timers[name] = null; }
  }
  function stopAllTimers() {
    for (var k in timers) { if (Object.prototype.hasOwnProperty.call(timers, k)) stopTimer(k); }
  }

  /* ── DOM helpers ──────────────────────────────────────────────────────── */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function screenEl(state) { return $('[data-screen="' + state + '"]'); }
  function role(name, root) { return $('[data-role="' + name + '"]', root); }
  function setText(el, text) { if (el) el.textContent = text == null ? '' : String(text); }
  function show(el, visible) { if (el) { if (visible) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); } }
  function enable(el, on) { if (el) { if (on) el.removeAttribute('disabled'); else el.setAttribute('disabled', 'disabled'); } }
  function clearChildren(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /* ── network ──────────────────────────────────────────────────────────── */

  var REQUEST_TIMEOUT_MS = 15000;
  /* Completion runs the whole recommendation pipeline server-side. It is slow
     on purpose and must never be cut short by a client timer. */
  var COMPLETE_TIMEOUT_MS = 60000;

  /**
   * POST/GET JSON. Rejects with { code: ... } — always a code from
   * src/lib/kiosk/errors.ts, never a message from a server exception.
   */
  function api(method, path, body, timeoutMs) {
    var settled = false;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject({ code: 'network' });
      }, timeoutMs || REQUEST_TIMEOUT_MS);

      var opts = {
        method: method,
        credentials: 'same-origin',
        headers: { 'accept': 'application/json' }
      };
      if (body) {
        opts.headers['content-type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }

      fetch(path, opts).then(function (res) {
        return res.json().then(function (data) { return { status: res.status, data: data }; },
          function () { return { status: res.status, data: {} }; });
      }).then(function (out) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (out.data && out.data.ok) resolve(out.data);
        else reject({ code: (out.data && out.data.code) || 'unavailable', status: out.status });
      })['catch'](function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject({ code: 'network' });
      });
    });
  }

  /** Route a rejected API call to the right state. One place, so it cannot drift. */
  function handleFailure(err) {
    var code = (err && err.code) || 'unavailable';
    if (code === 'network') { fire('NETWORK_LOST'); return; }
    if (code === 'not_enrolled') { fire('REVOKED'); return; }
    if (code === 'hardware_offline') { fire('HARDWARE_LOST'); return; }
    if (code === 'calibration_required') { fire('CALIBRATION_INVALID'); return; }
    if (code === 'scan_failed' || code === 'not_ready') { fire('CAPTURE_FAILED') || fire('PROCESSING_FAILED'); return; }
    /* Anything else is not something the customer can act on from here. */
    if (!fire('PROCESSING_FAILED')) fire('RESET');
  }

  /* ── the reset guarantee ──────────────────────────────────────────────── */

  /**
   * Clear everything belonging to the customer who was just here.
   *
   * Server first (best effort, and never awaited): a fitting that never reached
   * a recommendation is voided rather than left in_progress forever. Client
   * unconditionally: a failed network call must not be a reason the next
   * customer sees a name on the screen.
   */
  function resetSession(reason) {
    var sessionId = S.sessionId;
    if (sessionId) {
      api('POST', '/api/kiosk/session/abandon',
        { sessionId: sessionId, reason: reason || 'customer_withdrew' })
        ['catch'](function () { /* the client-side wipe below is what matters */ });
    }

    stopAllTimers();

    /* One assignment. Everything the customer typed, chose, or was shown lived
       in that object and now does not exist. */
    S = blankSession();

    /* And the document, because a value in an input is state too. */
    $$('input').forEach(function (input) {
      if (input.type === 'checkbox' || input.type === 'radio') input.checked = false;
      else input.value = '';
    });
    setText(role('phone-display'), EMPTY_PHONE);
    setText(role('pin-display'), '');
    show(role('enroll-error'), false);
    show(role('delivery-error'), false);
    show(role('pin-error'), false);
    clearChildren(role('result-profile'));
    clearChildren(role('result-products'));
    clearChildren(role('service-rows'));
    setText(role('result-headline'), '');
    setText(role('result-subhead'), '');
    setText(role('result-why'), '');
    setText(role('result-disclaimer'), '');
    setText(role('delivery-target'), '');
    setText(role('service-summary'), '');
    show($('#timeout-overlay'), false);
    show(role('service-panel'), false);
    show(role('service-gate'), true);

    /* No customer-identifying value is written to localStorage or
       sessionStorage anywhere in this file, so there is nothing to purge —
       but a stray key from an earlier build would outlive a deploy. */
    try {
      if (window.sessionStorage) window.sessionStorage.clear();
    } catch (e) { /* private mode throws; there was nothing there to clear */ }

    /* And the history entry, so a swipe cannot land on a URL that named a
       session. The kiosk is one URL by design; this keeps it that way. */
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({ kiosk: 1 }, '', '/kiosk');
      }
    } catch (e) { /* nothing to do */ }
  }

  var EMPTY_PHONE = '(   )   -    ';

  /** Leave the flow, wipe, and come back to IDLE through RESETTING. */
  function goIdle(reason) {
    resetSession(reason);
    if (machine.state !== 'RESETTING') {
      machine = { state: 'RESETTING', resumeFrom: null };
    }
    render();
    timers.reset = setTimeout(function () { fire('RESET_DONE'); }, 900);
  }

  /* ── inactivity ───────────────────────────────────────────────────────── */

  /**
   * Restart the inactivity clock.
   *
   * PROCESSING is exempt: the backend is working and a customer standing still
   * while it does has not walked away. Every other customer-facing state gets
   * a warning, then a wipe.
   */
  function armIdle() {
    stopTimer('idle'); stopTimer('warn'); stopTimer('warnTick');
    show($('#timeout-overlay'), false);
    if (!holdsCustomerData(machine.state)) return;
    if (machine.state === 'PROCESSING') return;

    timers.idle = setTimeout(function () {
      var remaining = Math.round(CFG.idleWarningMs / 1000);
      setText(role('timeout-count'), remaining);
      show($('#timeout-overlay'), true);
      timers.warnTick = setInterval(function () {
        remaining -= 1;
        setText(role('timeout-count'), remaining > 0 ? remaining : 0);
      }, 1000);
      timers.warn = setTimeout(function () {
        show($('#timeout-overlay'), false);
        stopTimer('warnTick');
        if (fire('TIMEOUT')) resetSession('customer_withdrew');
      }, CFG.idleWarningMs);
    }, CFG.idleTimeoutMs);
  }

  function holdsCustomerData(state) {
    return ['IDENTIFICATION', 'CONSENT', 'INTAKE', 'HARDWARE_READY', 'CAPTURING',
            'PROCESSING', 'RESULTS', 'DELIVERY', 'COMPLETE', 'NETWORK_OFFLINE',
            'SESSION_TIMEOUT'].indexOf(state) >= 0;
  }

  /* ── hardware polling ─────────────────────────────────────────────────── */

  /**
   * 2 Hz, and only while a customer is being positioned or scanned.
   *
   * The pressure matrix runs far faster than this and the iPad never sees it.
   * What the customer needs to know is whether their feet are in the right
   * place — a fact that changes about once a second. Redrawing three tick marks
   * any harder than this is main-thread time an A7 does not have to spare.
   */
  function startHardwarePolling() {
    stopTimer('hw');
    pollHardware();
    timers.hw = setInterval(pollHardware, CFG.hardwarePollMs);
  }

  function pollHardware() {
    if (machine.state !== 'HARDWARE_READY' && machine.state !== 'CAPTURING') {
      stopTimer('hw');
      return;
    }
    api('GET', '/api/kiosk/hardware', null).then(function (data) {
      var hw = data.hardware;
      paintChecklist(hw);
      if (data.event === 'HARDWARE_LOST') { fire('HARDWARE_LOST'); return; }
      if (data.event === 'CALIBRATION_INVALID') { fire('CALIBRATION_INVALID'); return; }
      if (machine.state === 'HARDWARE_READY') {
        enable($('[data-action="capture"]'), hw.ready);
      } else if (machine.state === 'CAPTURING' && !hw.ready) {
        /* A foot left the plate mid-count. Say so rather than capturing
           whatever was there. */
        fire('CAPTURE_FAILED');
      }
    })['catch'](function (err) {
      if (err && err.code === 'network') fire('NETWORK_LOST');
    });
  }

  function paintChecklist(hw) {
    var rows = [['left', hw.leftFootDetected, 'Left foot'],
                ['right', hw.rightFootDetected, 'Right foot'],
                ['weight', hw.weightStable, 'Weight']];
    for (var i = 0; i < rows.length; i++) {
      var li = $('[data-check="' + rows[i][0] + '"]');
      if (!li) continue;
      var ok = rows[i][1] === true;
      if (ok) li.className = 'is-ok'; else li.className = '';
      setText($('.check-value', li), ok ? 'Ready' : 'Waiting');
    }
  }

  /* ── screens ──────────────────────────────────────────────────────────── */

  function render() {
    var states = BOOT.states;
    for (var i = 0; i < states.length; i++) {
      var node = screenEl(states[i]);
      if (!node) continue;
      var active = states[i] === machine.state;
      node.className = node.className.replace(/\s*is-active/, '') + (active ? ' is-active' : '');
      node.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
    show($('#offline-strip'), machine.state === 'NETWORK_OFFLINE');
    armIdle();
    onEnter(machine.state);
  }

  function onEnter(state) {
    if (state === 'IDLE') {
      setText(role('idle-location'), BOOT.locationName || '');
      stopTimer('hw');
    } else if (state === 'IDENTIFICATION') {
      showIdentificationStep('phone');
    } else if (state === 'CONSENT') {
      show(role('report-consent-line'), !S.guest);
    } else if (state === 'INTAKE') {
      paintQuestion();
    } else if (state === 'HARDWARE_READY') {
      enable($('[data-action="capture"]'), false);
      paintChecklist({});
      startHardwarePolling();
    } else if (state === 'CAPTURING') {
      runCountdown();
    } else if (state === 'PROCESSING') {
      runProcessing();
    } else if (state === 'RESULTS') {
      paintResults();
    } else if (state === 'DELIVERY') {
      setText(role('delivery-target'),
        S.maskedPhone ? 'We’ll use the number ending ' + S.maskedPhone.slice(-4) + '.' : '');
      show(role('delivery-error'), false);
    } else if (state === 'NETWORK_OFFLINE') {
      startReconnect();
    } else if (state === 'RESETTING') {
      stopTimer('hw');
    } else if (state === 'SERVICE') {
      stopTimer('hw');
    }
  }

  function showIdentificationStep(step) {
    $$('[data-screen="IDENTIFICATION"] .panel').forEach(function (panel) {
      show(panel, panel.getAttribute('data-step') === step);
    });
  }

  /* ── identification ───────────────────────────────────────────────────── */

  function formatPhone(digits) {
    var pad = function (s, n) { while (s.length < n) s += ' '; return s; };
    var a = pad(digits.slice(0, 3), 3);
    var b = pad(digits.slice(3, 6), 3);
    var c = pad(digits.slice(6, 10), 4);
    return '(' + a + ') ' + b + '-' + c;
  }

  function onKey(key, target) {
    var isPin = target === 'pin';
    var current = isPin ? (S.pin || '') : S.phone;
    if (key === 'clear') current = '';
    else if (key === 'back') current = current.slice(0, -1);
    else if (current.length < (isPin ? 8 : 10)) current += key;

    if (isPin) {
      S.pin = current;
      var masked = '';
      for (var i = 0; i < current.length; i++) masked += '•';
      setText(role('pin-display'), masked || '••••');
    } else {
      S.phone = current;
      setText(role('phone-display'), formatPhone(current));
      enable($('[data-action="phone-next"]'), current.length === 10);
    }
  }

  function checkNameReady() {
    var first = $('#first-name').value.replace(/^\s+|\s+$/g, '');
    var last = $('#last-name').value.replace(/^\s+|\s+$/g, '');
    enable($('[data-action="name-next"]'), first.length > 0 && last.length > 0);
  }

  /* ── consent → session start ──────────────────────────────────────────── */

  function acceptConsent() {
    S.consentReport = !!($('#consent-report') && $('#consent-report').checked);
    var payload = S.guest
      ? { mode: 'guest', consentFitHistory: true }
      : { mode: 'identified', phone: S.phone, firstName: S.firstName, lastName: S.lastName,
          consentFitHistory: true, consentReceiveReport: S.consentReport };

    api('POST', '/api/kiosk/session', payload).then(function (data) {
      S.sessionId = data.sessionId;
      S.visitNumber = data.visitNumber;
      S.returning = data.returning;
      S.questions = data.returning ? BOOT.questions.returning : BOOT.questions['new'];
      S.questionIndex = 0;
      fire('CONSENT_GRANTED');
    })['catch'](handleFailure);
  }

  /* ── intake ───────────────────────────────────────────────────────────── */

  function paintQuestion() {
    var q = S.questions[S.questionIndex];
    if (!q) return;
    setText(role('intake-step'),
      'Question ' + (S.questionIndex + 1) + ' of ' + S.questions.length);
    setText(role('intake-prompt'), q.prompt);
  }

  function answerQuestion(value) {
    var q = S.questions[S.questionIndex];
    if (!q) return;
    S.answers[q.field] = value;
    S.questionIndex += 1;
    if (S.questionIndex < S.questions.length) { paintQuestion(); armIdle(); return; }

    api('POST', '/api/kiosk/session/intake',
      { sessionId: S.sessionId, answers: S.answers })
      .then(function () { fire('INTAKE_DONE'); })
      ['catch'](handleFailure);
  }

  /* ── capture ──────────────────────────────────────────────────────────── */

  function runCountdown() {
    var remaining = CFG.captureHoldSeconds;
    setText(role('count'), remaining);
    stopTimer('count');
    timers.count = setInterval(function () {
      remaining -= 1;
      if (remaining > 0) { setText(role('count'), remaining); return; }
      stopTimer('count');
      setText(role('count'), ' ');
      api('POST', '/api/kiosk/session/capture', { sessionId: S.sessionId })
        .then(function () { stopTimer('hw'); fire('CAPTURE_OK'); })
        ['catch'](handleFailure);
    }, 1000);
  }

  function runProcessing() {
    /* A width transition, not a spinner: one compositor-friendly property, no
       per-frame JavaScript, and it stops the moment the answer arrives. */
    var bar = role('bar');
    var width = 12;
    stopTimer('bar');
    timers.bar = setInterval(function () {
      width = width + (92 - width) * 0.12;
      if (bar) bar.style.width = width.toFixed(1) + '%';
    }, 400);

    api('POST', '/api/kiosk/session/complete', { sessionId: S.sessionId }, COMPLETE_TIMEOUT_MS)
      .then(function (data) {
        stopTimer('bar');
        if (bar) bar.style.width = '100%';
        S.results = data.results;
        S.canDeliver = data.canDeliver === true;
        S.maskedPhone = data.maskedPhone;
        fire('PROCESSING_OK');
      })['catch'](function (err) {
        stopTimer('bar');
        handleFailure(err);
      });
  }

  /* ── results ──────────────────────────────────────────────────────────── */

  function paintResults() {
    var r = S.results;
    if (!r) return;
    setText(role('result-headline'), r.headline);
    setText(role('result-subhead'), r.subhead);
    setText(role('result-why'), r.why);
    setText(role('result-disclaimer'), r.disclaimer);

    var rows = role('result-profile');
    clearChildren(rows);
    for (var i = 0; i < r.profile.length; i++) {
      var item = r.profile[i];
      var row = el('div', 'fitrow');
      row.appendChild(el('dt', 'fitrow-label', item.label));
      var dd = el('dd', 'fitrow-value');
      if (item.filled && item.of) {
        var pips = '';
        for (var j = 0; j < item.of; j++) pips += (j < item.filled ? '●' : '○');
        dd.appendChild(el('span', 'pips', pips));
      }
      dd.appendChild(document.createTextNode(item.value));
      row.appendChild(dd);
      rows.appendChild(row);
    }

    var list = role('result-products');
    clearChildren(list);
    for (var k = 0; k < r.products.length; k++) {
      var p = r.products[k];
      var li = document.createElement('li');
      li.appendChild(el('p', 'product-name', p.brand + ' ' + p.model));
      if (p.reasons.length) li.appendChild(el('p', 'product-why', p.reasons.join(' · ')));
      list.appendChild(li);
    }
    show(role('products-heading'), r.products.length > 0);
    show($('[data-action="deliver-open"]'), S.canDeliver);
  }

  /* ── delivery ─────────────────────────────────────────────────────────── */

  function sendResults() {
    api('POST', '/api/kiosk/session/deliver', { sessionId: S.sessionId })
      .then(function (data) {
        setText(role('complete-note'),
          data.maskedPhone
            ? 'Your fit report is saved. Your associate will send the link to ' + data.maskedPhone + '.'
            : 'Your fit report is saved.');
        fire('DELIVER_DONE');
      })['catch'](function (err) {
        var code = (err && err.code) || 'unavailable';
        if (code === 'network') { fire('NETWORK_LOST'); return; }
        var m = MSG[code] || MSG.unavailable;
        setText(role('delivery-error'), m.title + ' ' + m.body);
        show(role('delivery-error'), true);
      });
  }

  /* ── network recovery ─────────────────────────────────────────────────── */

  function startReconnect() {
    stopTimer('reconnect');
    var attempt = 0;
    timers.reconnect = setInterval(function () {
      attempt += 1;
      api('GET', '/api/kiosk/hardware', null).then(function () {
        stopTimer('reconnect');
        fire('NETWORK_BACK');
      })['catch'](function () {
        /* After a minute of failures the customer is not waiting any more. */
        if (attempt >= 20) { stopTimer('reconnect'); goIdle('customer_withdrew'); }
      });
    }, 3000);
  }

  /* ── enrollment ───────────────────────────────────────────────────────── */

  function submitEnrollment() {
    var input = $('#enroll-code');
    var code = (input.value || '').replace(/^\s+|\s+$/g, '');
    if (!code) return;
    api('POST', '/api/kiosk/enroll', { code: code }).then(function (data) {
      BOOT.enrolled = true;
      BOOT.locationName = data.locationName;
      BOOT.deviceName = data.deviceName;
      BOOT.hasHardware = data.hasHardware;
      input.value = '';
      show(role('enroll-error'), false);
      fire('ENROLL_OK');
    })['catch'](function (err) {
      var m = MSG[(err && err.code) || 'enrollment_failed'] || MSG.enrollment_failed;
      setText(role('enroll-error'), m.title + ' ' + m.body);
      show(role('enroll-error'), true);
    });
  }

  /* ── service mode ─────────────────────────────────────────────────────── */

  /**
   * Press and hold the wordmark for five seconds.
   *
   * Not a triple-tap or a corner tap: a customer discovers those by accident.
   * A five-second hold on a screen whose every other element responds
   * immediately is something only a person who already knows does.
   */
  function wireServiceGesture() {
    var marks = $$('[data-hold="service"]');
    var held = null;
    function start(e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      stopTimer('hold');
      held = setTimeout(function () {
        held = null;
        S.pin = '';
        setText(role('pin-display'), '••••');
        show(role('pin-error'), false);
        show(role('service-panel'), false);
        show(role('service-gate'), true);
        fire('SERVICE_OPEN');
      }, CFG.serviceHoldMs);
      timers.hold = held;
    }
    function cancel() { stopTimer('hold'); held = null; }

    /* The wordmark appears on more than one screen. All of them are the door. */
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      mark.addEventListener('touchstart', start, false);
      mark.addEventListener('touchend', cancel, false);
      mark.addEventListener('touchcancel', cancel, false);
      mark.addEventListener('touchmove', cancel, false);
      mark.addEventListener('mousedown', start, false);
      mark.addEventListener('mouseup', cancel, false);
      mark.addEventListener('mouseleave', cancel, false);
      mark.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);
    }
  }

  function submitPin() {
    api('POST', '/api/kiosk/service', { pin: S.pin || '' }).then(function (data) {
      S.pin = '';
      setText(role('pin-display'), '••••');
      show(role('pin-error'), false);
      show(role('service-gate'), false);
      show(role('service-panel'), true);
      paintDiagnostics(data.diagnostics);
    })['catch'](function (err) {
      S.pin = '';
      setText(role('pin-display'), '••••');
      var m = MSG[(err && err.code) || 'service_auth_failed'] || MSG.service_auth_failed;
      setText(role('pin-error'), m.title);
      show(role('pin-error'), true);
    });
  }

  function paintDiagnostics(d) {
    setText(role('service-name'), d.deviceName + ' · ' + d.locationName);
    setText(role('service-summary'), d.summary);
    var list = role('service-rows');
    clearChildren(list);
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      var li = document.createElement('li');
      li.appendChild(el('span', 'dot dot-' + r.health));
      li.appendChild(el('span', 'diag-label', r.label));
      li.appendChild(el('span', 'diag-value', r.value));
      list.appendChild(li);
    }
  }

  /* ── actions ──────────────────────────────────────────────────────────── */

  var ACTIONS = {
    'enroll-start': function () { fire('ENROLL_START'); },
    'enroll-cancel': function () { fire('ENROLL_CANCEL'); },
    'enroll-submit': submitEnrollment,

    start: function () { S = blankSession(); fire('START'); },

    'phone-next': function () {
      if (S.phone.length !== 10) return;
      showIdentificationStep('name');
      checkNameReady();
    },
    'name-back': function () { showIdentificationStep('phone'); },
    'name-next': function () {
      S.firstName = $('#first-name').value.replace(/^\s+|\s+$/g, '');
      S.lastName = $('#last-name').value.replace(/^\s+|\s+$/g, '');
      if (!S.firstName || !S.lastName) return;
      S.guest = false;
      fire('IDENTIFIED');
    },
    guest: function () { S.guest = true; S.phone = ''; fire('IDENTIFIED'); },

    'consent-accept': acceptConsent,
    'consent-decline': function () { goIdle('customer_withdrew'); },

    'intake-yes': function () { answerQuestion(true); },
    'intake-no': function () { answerQuestion(false); },

    capture: function () { fire('CAPTURE_START'); },
    'retry-scan': function () { if (!fire('HARDWARE_OK')) goIdle('customer_withdrew'); },

    'deliver-open': function () { fire('DELIVER_OPEN'); },
    'deliver-back': function () { fire('DELIVER_BACK'); },
    'deliver-send': sendResults,
    'results-done': function () { fire('DELIVER_SKIP'); },
    finish: function () { goIdle('customer_withdrew'); },

    reset: function () { goIdle('customer_withdrew'); },
    stay: function () { armIdle(); },

    'pin-submit': submitPin,
    'service-refresh': submitPin,
    'service-reset-session': function () { resetSession('mistaken_start'); },
    'service-close': function () { fire('SERVICE_CLOSE'); goIdle('mistaken_start'); }
  };

  /**
   * One delegated listener for the whole document.
   *
   * Thirty individual listeners on a device with this much memory pressure is
   * thirty closures held for the life of the process, and the screens are all
   * in the document from the start, so there is nothing to re-bind anyway.
   */
  function wireDelegate() {
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document) {
        if (node.getAttribute) {
          var key = node.getAttribute('data-key');
          if (key !== null) {
            event.preventDefault();
            armIdle();
            onKey(key, machine.state === 'SERVICE' ? 'pin' : 'phone');
            return;
          }
          var action = node.getAttribute('data-action');
          if (action !== null) {
            event.preventDefault();
            if (node.hasAttribute('disabled')) return;
            armIdle();
            if (ACTIONS[action]) ACTIONS[action]();
            return;
          }
        }
        node = node.parentNode;
      }
      armIdle();
    }, false);

    document.addEventListener('input', function (event) {
      armIdle();
      if (event.target && (event.target.id === 'first-name' || event.target.id === 'last-name')) {
        checkNameReady();
      }
    }, false);

    /* An unattended kiosk should not offer a text-selection loupe or a
       long-press menu on anything but the two name fields. */
    document.addEventListener('contextmenu', function (event) {
      if (event.target && event.target.tagName === 'INPUT') return;
      event.preventDefault();
    }, false);
  }

  /* ── crash, reload and eviction recovery ──────────────────────────────── */

  /**
   * The mini 2 has 1 GB of RAM. Safari WILL evict this tab, and iOS will
   * relaunch it on a Home Screen tap. Both look like a fresh load, which is
   * exactly what the kiosk wants: the DEVICE identity survives, because it is an
   * httpOnly cookie the server reads; nothing about the CUSTOMER survives,
   * because nothing about the customer was ever written anywhere but this
   * closure. There is no "resume your fitting" path and there should not be —
   * the safe state after an unexplained restart is IDLE.
   */
  function wireLifecycle() {
    window.addEventListener('pageshow', function (event) {
      /* Restored from the back/forward cache with the previous customer's DOM
         intact. Wipe before it is on screen for a second time. */
      if (event.persisted) { resetSession('customer_withdrew'); machine = { state: BOOT.enrolled ? 'IDLE' : 'UNENROLLED', resumeFrom: null }; render(); }
    }, false);

    window.addEventListener('pagehide', function () { stopAllTimers(); }, false);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && holdsCustomerData(machine.state)) {
        /* Backgrounded mid-fitting: the customer walked off with the associate,
           or Guided Access was exited. Either way this session is over. */
        goIdle('customer_withdrew');
      }
    }, false);

    /* Trap Back inside the kiosk. Guided Access hides the browser chrome, but
       an edge swipe still fires popstate on iOS. */
    try {
      window.history.replaceState({ kiosk: 1 }, '', '/kiosk');
      window.history.pushState({ kiosk: 2 }, '', '/kiosk');
      window.addEventListener('popstate', function () {
        window.history.pushState({ kiosk: 2 }, '', '/kiosk');
        if (holdsCustomerData(machine.state)) goIdle('customer_withdrew');
      }, false);
    } catch (e) { /* no history API: the trap is a nicety, not the guarantee */ }

    window.addEventListener('online', function () { fire('NETWORK_BACK'); }, false);
    window.addEventListener('offline', function () { fire('NETWORK_LOST'); }, false);
  }

  /* ── boot ─────────────────────────────────────────────────────────────── */

  wireDelegate();
  wireServiceGesture();
  wireLifecycle();
  resetSession();
  render();
})();
