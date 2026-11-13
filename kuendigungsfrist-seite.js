/* Kündigungsfrist-Rechner: Oberfläche. Kein Tracking, keine Speicherung, nichts wird gesendet. */
(function () {
  'use strict'
  var K = window.KuendigungsfristRechner
  var $ = function (id) { return document.getElementById(id) }
  var form = $('form')
  var calculated = false

  function radio(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked')
    return el ? el.value : ''
  }

  /** "Donnerstag" */
  function weekday(iso) { return K.formatLong(iso).split(',')[0] }
  /** "31. Dezember 2026" */
  function dateOnly(iso) { return K.formatLong(iso).split(', ')[1] }

  function show(el, on) { el.hidden = !on }

  function syncVisibility() {
    var start = radio('basis') === 'start'
    show($('endField'), !start)
    show($('startFields'), start)
    show($('renewField'), radio('renewal') === 'fixed')
  }

  function validYear(iso) {
    var t = K.parseIsoDate(iso)
    if (t === null) return false
    var y = new Date(t).getUTCFullYear()
    return y >= 1990 && y <= 2099
  }

  /** Reads the form; returns { input, errors } */
  function read() {
    var errors = {}
    var minTermEnd = null
    if (radio('basis') === 'start') {
      var start = $('startDate').value
      var months = Number($('termMonths').value)
      minTermEnd = validYear(start) && Number.isInteger(months) && months >= 1 && months <= 120 ? K.termEndFromStart(start, months) : null
      if (!minTermEnd) errors.startDate = true
    } else {
      minTermEnd = validYear($('minTermEnd').value) ? $('minTermEnd').value : null
      if (!minTermEnd) errors.minTermEnd = true
    }
    var raw = $('noticeValue').value.trim()
    var value = raw === '' ? 0 : Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > 365) errors.notice = true
    var mode = radio('renewal')
    return {
      errors: errors,
      input: {
        minTermEnd: minTermEnd,
        noticePeriod: { value: value, unit: $('noticeUnit').value },
        renewalMode: mode,
        autoRenewMonths: mode === 'fixed' ? Number($('renewMonths').value) : 0,
      },
    }
  }

  function setError(inputId, errId, on) {
    show($(errId), on)
    $(inputId).setAttribute('aria-invalid', on ? 'true' : 'false')
  }

  function render(focus) {
    syncVisibility()
    var r = read()
    var startMode = radio('basis') === 'start'
    var hint = $('startHint')
    if (startMode && r.input.minTermEnd) {
      hint.textContent = 'Mindestlaufzeit endet damit am ' + K.formatShort(r.input.minTermEnd) + '.'
      show(hint, true)
    } else show(hint, false)
    if (!calculated) return
    setError('minTermEnd', 'minTermEndErr', !!r.errors.minTermEnd)
    setError('startDate', 'startDateErr', !!r.errors.startDate)
    setError('noticeValue', 'noticeErr', !!r.errors.notice)
    var box = $('result')
    if (r.errors.minTermEnd || r.errors.startDate || r.errors.notice) {
      show(box, false)
      return
    }
    var res = K.computeDeadline(r.input, new Date())
    var notice = K.noticeText(r.input.noticePeriod)
    var today = K.formatShort(K.toIsoDate(K.todayUtc(new Date())))
    var chip = $('resChip')
    var copy
    var note = ''
    chip.className = 'chip ' + res.status
    if (res.status === 'open') {
      $('resLabel').textContent = 'Die Frist zum Ende der Mindestlaufzeit ist vorbei'
      $('resBig').textContent = 'Jederzeit kündbar'
      var capped = K.addNotice(K.todayUtc(new Date()), r.input.noticePeriod) > K.parseIsoDate(res.termEnd)
      chip.textContent = ''
      $('resText').textContent =
        'Der Vertrag läuft unbefristet weiter. Kündigst du heute, endet er frühestens am ' + K.formatLong(res.termEnd) +
        (capped ? '. Deine Kündigungsfrist (' + notice + ') zählt dabei höchstens als ein Monat (§ 309 Nr. 9 BGB).' : ' (Frist ' + notice + ').')
      copy =
        'Mein Vertrag ist jederzeit kündbar. Kündige ich heute (' + today + '), endet er frühestens am ' + K.formatShort(res.termEnd) +
        '. Mindestlaufzeit bis ' + K.formatShort(r.input.minTermEnd) + ', Kündigungsfrist ' + notice + '.'
    } else if (res.status === 'passed') {
      $('resLabel').textContent = 'Letzter Kündigungstag war ' + weekday(res.deadline)
      $('resBig').textContent = dateOnly(res.deadline)
      chip.textContent = 'Frist verstrichen'
      $('resText').textContent = 'Laut deinen Angaben endet der Vertrag am ' + K.formatLong(res.termEnd) + ' ohne Verlängerung.'
      copy = 'Letzter Kündigungstag war der ' + K.formatShort(res.deadline) + '. Laut Vertrag endet er am ' + K.formatShort(res.termEnd) + ' ohne Verlängerung.'
    } else {
      $('resLabel').textContent = 'Letzter Kündigungstag · ' + weekday(res.deadline)
      $('resBig').textContent = dateOnly(res.deadline)
      chip.textContent = K.deadlineLabel(res)
      var renewed = res.termEnd !== r.input.minTermEnd
      $('resText').textContent =
        'Bis zu diesem Tag muss die Kündigung beim Anbieter angekommen sein. Der Vertrag endet dann am ' + K.formatLong(res.termEnd) + '.' +
        (renewed ? ' Die Frist zum Ende der Mindestlaufzeit ist schon vorbei; das ist die nächste Frist nach der festen Verlängerung.' : '')
      if (K.isWeekend(res.deadline)) note = 'Der Tag ist ein ' + weekday(res.deadline) + '. Schick die Kündigung besser einige Tage vorher.'
      copy =
        'Letzter Kündigungstag: ' + K.formatShort(res.deadline) + ' (' + K.deadlineLabel(res) + ', Stand ' + today + '). ' +
        'Vertragsende dann: ' + K.formatShort(res.termEnd) + '. Kündigungsfrist ' + notice + '.'
    }
    show(chip, !!chip.textContent)
    $('resNote').textContent = note
    show($('resNote'), !!note)
    $('copyText').value = copy + '\nBerechnet mit dem Kündigungsfrist-Rechner von Sparen mit Gronert. Hinweis, keine Rechtsberatung.'
    $('copyState').textContent = ''
    show(box, true)
    var ta = $('copyText')
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 2 + 'px'
    if (focus) box.focus()
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    calculated = true
    render(true)
    var firstErr = form.querySelector('[aria-invalid="true"]')
    if (firstErr) firstErr.focus()
  })
  form.addEventListener('input', function () { render(false) })
  form.addEventListener('change', function () { render(false) })

  $('copyBtn').addEventListener('click', function () {
    var ta = $('copyText')
    var done = function () { $('copyState').textContent = 'Kopiert' }
    var fallback = function () {
      ta.select()
      try {
        document.execCommand('copy')
        done()
      } catch (err) {
        $('copyState').textContent = 'Bitte markieren und kopieren'
      }
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(ta.value).then(done, fallback)
    else fallback()
  })

  syncVisibility()
})()
