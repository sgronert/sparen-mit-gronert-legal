/*
 * Kündigungsfrist-Rechner: Berechnung (ohne Oberfläche).
 * Plain-JS-Port von src/domain/deadlines.ts und resolveRenewal() aus src/domain/renewal.ts der App
 * "Sparen mit Gronert" (gleicher Algorithmus: UTC-Mitternacht, Monatsende-Kappung, keine Wochenend-Verschiebung).
 * Planungshilfe, keine Rechtsberatung. Läuft im Browser (global KuendigungsfristRechner) und in Node (module.exports).
 */
(function (root) {
  'use strict'

  var DAY_MS = 86400000

  /** YYYY-MM-DD -> UTC-Mitternacht oder null bei ungültigem Datum. */
  function parseIsoDate(iso) {
    if (!iso) return null
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    if (!m) return null
    var y = +m[1]
    var mo = +m[2]
    var d = +m[3]
    var t = Date.UTC(y, mo - 1, d)
    var check = new Date(t)
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
    return t
  }

  function toIsoDate(t) {
    return new Date(t).toISOString().slice(0, 10)
  }

  /** Heute (lokaler Kalendertag) als UTC-Mitternacht. */
  function todayUtc(now) {
    now = now || new Date()
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  }

  /** Kalendermonate addieren, Tag auf das Monatsende kappen (31.01. + 1 Monat = 28./29.02.). */
  function addMonths(t, months) {
    var d = new Date(t)
    var y = d.getUTCFullYear()
    var m = d.getUTCMonth() + months
    var day = d.getUTCDate()
    var lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return Date.UTC(y, m, Math.min(day, lastDay))
  }

  function subtractNotice(t, notice) {
    switch (notice.unit) {
      case 'days':
        return t - notice.value * DAY_MS
      case 'weeks':
        return t - notice.value * 7 * DAY_MS
      default:
        return addMonths(t, -notice.value)
    }
  }

  function addNotice(t, notice) {
    switch (notice.unit) {
      case 'days':
        return t + notice.value * DAY_MS
      case 'weeks':
        return t + notice.value * 7 * DAY_MS
      default:
        return addMonths(t, notice.value)
    }
  }

  function statusForDaysLeft(daysLeft) {
    if (daysLeft < 0) return 'passed'
    if (daysLeft <= 7) return 'urgent'
    if (daysLeft <= 30) return 'soon'
    return 'ok'
  }

  /** Frühestes Ende eines unbefristeten Verbrauchervertrags: Frist, aber höchstens ein Monat (§ 309 Nr. 9 BGB, § 56 Abs. 3 TKG). */
  function earliestEndMonthly(t, notice) {
    return Math.min(addNotice(t, notice), addMonths(t, 1))
  }

  function validMonths(n) {
    return typeof n === 'number' && isFinite(n) && n > 0 ? Math.round(n) : 0
  }

  /** Wirksame Verlängerung (wie resolveRenewal der App, ohne den Prüfhinweis für Altdaten). */
  function resolveRenewal(c) {
    if (c.sector === 'red') return { mode: 'none', months: 0 }
    var months = validMonths(c.autoRenewMonths)
    if (c.renewalMode === 'monthly' || c.renewalMode === 'none') return { mode: c.renewalMode, months: 0 }
    if (c.renewalMode === 'fixed') return months > 0 ? { mode: 'fixed', months: months } : { mode: 'none', months: 0 }
    return months > 0 ? { mode: 'fixed', months: months } : { mode: 'none', months: 0 }
  }

  function result(deadline, termEnd, today) {
    var daysLeft = Math.round((deadline - today) / DAY_MS)
    return { deadline: toIsoDate(deadline), termEnd: toIsoDate(termEnd), daysLeft: daysLeft, status: statusForDaysLeft(daysLeft) }
  }

  /**
   * Letzter Kündigungstag (wie computeDeadline der App).
   * input: { minTermEnd: 'YYYY-MM-DD', noticePeriod: { value, unit: 'days'|'weeks'|'months' },
   *          renewalMode: 'monthly'|'fixed'|'none', autoRenewMonths, status, sector }
   */
  function computeDeadline(input, now) {
    var unknown = { deadline: null, termEnd: null, daysLeft: null, status: 'unknown' }
    if (input.status && input.status !== 'active') return unknown
    var firstEnd = parseIsoDate(input.minTermEnd)
    if (firstEnd === null) return unknown
    var notice = input.noticePeriod || { value: 0, unit: 'days' }
    if (!isFinite(notice.value) || notice.value < 0) return unknown
    var today = todayUtc(now)
    var firstDeadline = subtractNotice(firstEnd, notice)
    var renewal = resolveRenewal(input)
    if (firstDeadline >= today || renewal.mode === 'none') return result(firstDeadline, firstEnd, today)
    if (renewal.mode === 'fixed') {
      var termEnd = firstEnd
      var deadline = firstDeadline
      for (var k = 1; k <= 1200 && deadline < today; k++) {
        termEnd = addMonths(firstEnd, k * renewal.months)
        deadline = subtractNotice(termEnd, notice)
      }
      return result(deadline, termEnd, today)
    }
    var earliest = Math.max(earliestEndMonthly(today, notice), firstEnd + DAY_MS)
    return { deadline: null, termEnd: toIsoDate(earliest), daysLeft: null, status: 'open' }
  }

  /** Kurztext wie deadlineLabel der App. */
  function deadlineLabel(r) {
    if (r.status === 'open') return 'Jederzeit kündbar'
    if (r.daysLeft === null) return 'Keine Frist erfasst'
    if (r.daysLeft < 0) return 'Frist verstrichen'
    if (r.daysLeft === 0) return 'Frist endet heute'
    if (r.daysLeft === 1) return 'noch 1 Tag'
    return 'noch ' + r.daysLeft + ' Tage'
  }

  /**
   * Ende der Mindestlaufzeit aus Vertragsbeginn und Laufzeit in Monaten (nur Seite, nicht in der App):
   * Tag vor dem gleichnamigen Tag, fehlt er, der Monatsletzte (§ 188 Abs. 2 und 3 BGB).
   * Beginn 15.03.2026 + 24 Monate = 14.03.2028; 01.01. + 12 = 31.12.; 31.01. + 1 = 28.02.
   */
  function termEndFromStart(startIso, months) {
    var start = parseIsoDate(startIso)
    var n = validMonths(months)
    if (start === null || n === 0) return null
    var d = new Date(start)
    var y = d.getUTCFullYear()
    var m = d.getUTCMonth() + n
    var day = d.getUTCDate()
    if (day === 1) return toIsoDate(Date.UTC(y, m, 0))
    var lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return toIsoDate(Date.UTC(y, m, Math.min(day - 1, lastDay)))
  }

  var WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

  /** 2026-12-31 -> "31.12.2026" */
  function formatShort(iso) {
    var p = iso.split('-')
    return p[2] + '.' + p[1] + '.' + p[0]
  }

  /** 2026-12-31 -> "Donnerstag, 31. Dezember 2026" */
  function formatLong(iso) {
    var d = new Date(parseIsoDate(iso))
    return WEEKDAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + '. ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
  }

  function isWeekend(iso) {
    var day = new Date(parseIsoDate(iso)).getUTCDay()
    return day === 0 || day === 6
  }

  function noticeText(notice) {
    var v = notice.value
    if (notice.unit === 'days') return v === 1 ? '1 Tag' : v + ' Tage'
    if (notice.unit === 'weeks') return v === 1 ? '1 Woche' : v + ' Wochen'
    return v === 1 ? '1 Monat' : v + ' Monate'
  }

  var api = {
    DAY_MS: DAY_MS,
    parseIsoDate: parseIsoDate,
    toIsoDate: toIsoDate,
    todayUtc: todayUtc,
    addMonths: addMonths,
    subtractNotice: subtractNotice,
    addNotice: addNotice,
    statusForDaysLeft: statusForDaysLeft,
    earliestEndMonthly: earliestEndMonthly,
    resolveRenewal: resolveRenewal,
    computeDeadline: computeDeadline,
    deadlineLabel: deadlineLabel,
    termEndFromStart: termEndFromStart,
    formatShort: formatShort,
    formatLong: formatLong,
    isWeekend: isWeekend,
    noticeText: noticeText,
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.KuendigungsfristRechner = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
