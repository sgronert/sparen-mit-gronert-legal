// Runs the page's calculation module against the cases of src/domain/deadlines.test.ts in sgronert/sparen-mit-gronert-app.
// Run from the repo root: node --test
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  addMonths,
  addNotice,
  computeDeadline,
  deadlineLabel,
  earliestEndMonthly,
  parseIsoDate,
  statusForDaysLeft,
  toIsoDate,
  termEndFromStart,
  formatLong,
  formatShort,
  isWeekend,
  noticeText,
} = require('../kuendigungsfrist-rechner.js')

const now = new Date(2026, 9, 12) // 12.10.2026 local
const d = (iso) => parseIsoDate(iso)
const m = (value) => ({ value, unit: 'months' })
const w = (value) => ({ value, unit: 'weeks' })
const days = (value) => ({ value, unit: 'days' })
/** toMatchObject equivalent */
const match = (actual, expected) => {
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(actual[k], v, `field ${k}`)
}

describe('parseIsoDate', () => {
  test('accepts valid and rejects invalid dates', () => {
    assert.notEqual(parseIsoDate('2026-02-28'), null)
    assert.equal(parseIsoDate('2026-02-30'), null)
    assert.equal(parseIsoDate('abc'), null)
    assert.equal(parseIsoDate(undefined), null)
  })
})

describe('addMonths', () => {
  test('clamps the day to month end', () => {
    assert.equal(toIsoDate(addMonths(d('2026-01-31'), 1)), '2026-02-28')
    assert.equal(toIsoDate(addMonths(d('2028-01-31'), 1)), '2028-02-29')
    assert.equal(toIsoDate(addMonths(d('2026-03-31'), -1)), '2026-02-28')
  })
})

describe('computeDeadline', () => {
  test('is unknown without term end', () => {
    const r = computeDeadline({}, now)
    assert.equal(r.status, 'unknown')
    assert.equal(r.deadline, null)
    assert.equal(r.daysLeft, null)
  })

  test('subtracts months', () => {
    const r = computeDeadline({ minTermEnd: '2027-03-31', noticePeriod: m(3) }, now)
    assert.equal(r.deadline, '2026-12-31')
    assert.equal(r.daysLeft, 80)
    assert.equal(r.status, 'ok')
  })

  test('subtracts weeks and days', () => {
    assert.equal(computeDeadline({ minTermEnd: '2026-11-30', noticePeriod: w(4) }, now).deadline, '2026-11-02')
    assert.equal(computeDeadline({ minTermEnd: '2026-11-30', noticePeriod: days(14) }, now).deadline, '2026-11-16')
  })

  test('treats missing notice as 0 days', () => {
    assert.equal(computeDeadline({ minTermEnd: '2026-10-20' }, now).deadline, '2026-10-20')
  })

  test('classifies status by days left', () => {
    assert.equal(computeDeadline({ minTermEnd: '2026-10-19' }, now).status, 'urgent')
    match(computeDeadline({ minTermEnd: '2026-10-12' }, now), { daysLeft: 0, status: 'urgent' })
    assert.equal(computeDeadline({ minTermEnd: '2026-11-11' }, now).status, 'soon')
    assert.equal(computeDeadline({ minTermEnd: '2026-11-12' }, now).status, 'ok')
    assert.equal(computeDeadline({ minTermEnd: '2026-10-11' }, now).status, 'passed')
  })

  test('stays passed when there is no auto renewal', () => {
    const r = computeDeadline({ minTermEnd: '2026-01-31', noticePeriod: m(1) }, now)
    assert.equal(r.status, 'passed')
    assert.ok(r.daysLeft < 0)
  })

  test('rolls forward by autoRenewMonths until the deadline lies ahead', () => {
    const r = computeDeadline({ minTermEnd: '2026-01-31', noticePeriod: m(1), autoRenewMonths: 12 }, now)
    assert.equal(r.termEnd, '2027-01-31')
    assert.equal(r.deadline, '2026-12-31')
    assert.equal(r.status, 'ok')
  })

  test('rolls forward with short renewals', () => {
    const r = computeDeadline({ minTermEnd: '2026-06-30', noticePeriod: m(1), autoRenewMonths: 1 }, now)
    assert.ok(r.daysLeft >= 0 && r.daysLeft <= 31)
  })

  test('rejects invalid notice', () => {
    assert.equal(computeDeadline({ minTermEnd: '2026-12-31', noticePeriod: days(-1) }, now).status, 'unknown')
  })
})

describe('labels', () => {
  test('statusForDaysLeft boundaries', () => {
    assert.equal(statusForDaysLeft(-1), 'passed')
    assert.equal(statusForDaysLeft(0), 'urgent')
    assert.equal(statusForDaysLeft(8), 'soon')
    assert.equal(statusForDaysLeft(31), 'ok')
  })
  test('deadlineLabel text', () => {
    const base = { deadline: '2026-10-21', termEnd: '2026-10-21', status: 'urgent' }
    assert.equal(deadlineLabel({ ...base, daysLeft: 9 }), 'noch 9 Tage')
    assert.equal(deadlineLabel({ ...base, daysLeft: 1 }), 'noch 1 Tag')
    assert.equal(deadlineLabel({ ...base, daysLeft: 0 }), 'Frist endet heute')
    assert.equal(deadlineLabel({ ...base, daysLeft: -2 }), 'Frist verstrichen')
    assert.equal(deadlineLabel({ deadline: null, termEnd: null, daysLeft: null, status: 'unknown' }), 'Keine Frist erfasst')
    assert.equal(deadlineLabel({ deadline: null, termEnd: '2026-11-12', daysLeft: null, status: 'open' }), 'Jederzeit kündbar')
  })
})

describe('addNotice / earliestEndMonthly', () => {
  test('adds days, weeks and months (clamped to month end)', () => {
    assert.equal(toIsoDate(addNotice(d('2026-10-12'), days(14))), '2026-10-26')
    assert.equal(toIsoDate(addNotice(d('2026-10-12'), w(4))), '2026-11-09')
    assert.equal(toIsoDate(addNotice(d('2027-01-31'), m(1))), '2027-02-28')
  })
  test('caps the notice at one month', () => {
    assert.equal(toIsoDate(earliestEndMonthly(d('2026-10-12'), m(3))), '2026-11-12')
    assert.equal(toIsoDate(earliestEndMonthly(d('2026-10-12'), w(6))), '2026-11-12')
    assert.equal(toIsoDate(earliestEndMonthly(d('2026-10-12'), days(45))), '2026-11-12')
    assert.equal(toIsoDate(earliestEndMonthly(d('2026-10-12'), w(2))), '2026-10-26')
    assert.equal(toIsoDate(earliestEndMonthly(d('2026-10-12'), days(0))), '2026-10-12')
  })
  test('handles month ends and leap years', () => {
    assert.equal(toIsoDate(earliestEndMonthly(d('2027-01-31'), m(1))), '2027-02-28')
    assert.equal(toIsoDate(earliestEndMonthly(d('2028-01-31'), m(1))), '2028-02-29')
    assert.equal(toIsoDate(earliestEndMonthly(d('2027-03-31'), m(2))), '2027-04-30')
    assert.equal(toIsoDate(earliestEndMonthly(d('2027-01-31'), days(30))), '2027-02-28')
    assert.equal(toIsoDate(earliestEndMonthly(d('2027-02-01'), w(4))), '2027-03-01')
    assert.equal(toIsoDate(earliestEndMonthly(d('2026-12-15'), m(1))), '2027-01-15')
  })
})

describe('renewal mode monthly (default since 1.3.2022)', () => {
  const base = { renewalMode: 'monthly' }

  test('uses the entered notice until the deadline of the minimum term', () => {
    const r = computeDeadline({ ...base, minTermEnd: '2027-03-31', noticePeriod: m(3) }, now)
    assert.deepEqual(r, { deadline: '2026-12-31', termEnd: '2027-03-31', daysLeft: 80, status: 'ok' })
  })

  test('counts the deadline day itself as still running', () => {
    match(computeDeadline({ ...base, minTermEnd: '2026-11-12', noticePeriod: m(1) }, now), { deadline: '2026-10-12', daysLeft: 0, status: 'urgent' })
    const dayAfter = computeDeadline({ ...base, minTermEnd: '2026-11-12', noticePeriod: m(1) }, new Date(2026, 9, 13))
    assert.deepEqual(dayAfter, { deadline: null, termEnd: '2026-11-13', daysLeft: null, status: 'open' })
  })

  test('after the minimum term: no deadline, cancellable any time, end = today + notice', () => {
    const r = computeDeadline({ ...base, minTermEnd: '2026-06-30', noticePeriod: m(1) }, now)
    assert.deepEqual(r, { deadline: null, termEnd: '2026-11-12', daysLeft: null, status: 'open' })
  })

  test('caps a longer notice at one month in the indefinite phase', () => {
    assert.equal(computeDeadline({ ...base, minTermEnd: '2026-06-30', noticePeriod: m(3) }, now).termEnd, '2026-11-12')
    assert.equal(computeDeadline({ ...base, minTermEnd: '2026-06-30', noticePeriod: w(6) }, now).termEnd, '2026-11-12')
  })

  test('keeps a shorter notice', () => {
    assert.equal(computeDeadline({ ...base, minTermEnd: '2026-06-30', noticePeriod: w(2) }, now).termEnd, '2026-10-26')
    assert.equal(computeDeadline({ ...base, minTermEnd: '2026-06-30', noticePeriod: days(0) }, now).termEnd, '2026-10-12')
    assert.equal(computeDeadline({ ...base, minTermEnd: '2026-06-30' }, now).termEnd, '2026-10-12')
  })

  test('missed deadline while the minimum term still runs: earliest end is after the minimum term', () => {
    match(computeDeadline({ ...base, minTermEnd: '2026-10-31', noticePeriod: m(1) }, now), { status: 'open', termEnd: '2026-11-12' })
    match(computeDeadline({ ...base, minTermEnd: '2026-12-31', noticePeriod: m(3) }, now), { status: 'open', termEnd: '2027-01-01' })
  })

  test('month-end edge cases', () => {
    const c = { ...base, minTermEnd: '2026-06-30', noticePeriod: m(1) }
    assert.equal(computeDeadline(c, new Date(2027, 0, 31)).termEnd, '2027-02-28')
    assert.equal(computeDeadline(c, new Date(2028, 0, 31)).termEnd, '2028-02-29')
    assert.equal(computeDeadline(c, new Date(2027, 2, 31)).termEnd, '2027-04-30')
    assert.equal(computeDeadline(c, new Date(2026, 11, 31)).termEnd, '2027-01-31')
    match(computeDeadline({ ...base, minTermEnd: '2027-01-31', noticePeriod: m(1) }, new Date(2026, 11, 31)), { deadline: '2026-12-31', daysLeft: 0 })
    match(computeDeadline({ ...base, minTermEnd: '2027-01-31', noticePeriod: m(1) }, new Date(2027, 0, 1)), { status: 'open', termEnd: '2027-02-01' })
    match(computeDeadline({ ...base, minTermEnd: '2027-03-31', noticePeriod: m(1) }, new Date(2027, 1, 28)), { deadline: '2027-02-28', daysLeft: 0 })
    match(computeDeadline({ ...base, minTermEnd: '2027-03-31', noticePeriod: m(1) }, new Date(2027, 2, 1)), { status: 'open', termEnd: '2027-04-01' })
  })

  test('applies to every type that defaults to it', () => {
    for (const typeId of ['strom', 'gas', 'dsl', 'mobilfunk', 'zeitschrift', 'fitness', 'streaming']) {
      const r = computeDeadline({ typeId, renewalMode: 'monthly', minTermEnd: '2026-01-31', noticePeriod: w(4) }, now)
      assert.equal(r.status, 'open')
    }
  })

  test('red sectors are a date note only and never renew', () => {
    const r = computeDeadline({ sector: 'red', typeId: 'kfz', renewalMode: 'monthly', minTermEnd: '2026-06-30' }, now)
    assert.equal(r.status, 'passed')
    assert.equal(r.deadline, '2026-06-30')
  })
})

describe('renewal mode fixed (older contracts, explicit choice)', () => {
  test('rolls forward by the fixed months until the deadline lies ahead', () => {
    const r = computeDeadline({ renewalMode: 'fixed', autoRenewMonths: 12, minTermEnd: '2026-01-31', noticePeriod: m(1) }, now)
    assert.deepEqual(r, { deadline: '2026-12-31', termEnd: '2027-01-31', daysLeft: 80, status: 'ok' })
  })

  test('does not drift at month ends (counts from the entered term end)', () => {
    match(computeDeadline({ renewalMode: 'fixed', autoRenewMonths: 1, minTermEnd: '2026-01-31', noticePeriod: days(0) }, now), {
      termEnd: '2026-10-31',
      deadline: '2026-10-31',
    })
    const r = computeDeadline({ renewalMode: 'fixed', autoRenewMonths: 1, minTermEnd: '2026-01-31', noticePeriod: m(1) }, now)
    match(r, { termEnd: '2026-11-30', deadline: '2026-10-30', daysLeft: 18, status: 'soon' })
  })

  test('handles a term end on 29.02.', () => {
    const r = computeDeadline({ renewalMode: 'fixed', autoRenewMonths: 12, minTermEnd: '2024-02-29', noticePeriod: m(3) }, now)
    match(r, { termEnd: '2027-02-28', deadline: '2026-11-28', daysLeft: 47 })
    const later = computeDeadline({ renewalMode: 'fixed', autoRenewMonths: 12, minTermEnd: '2024-02-29', noticePeriod: m(3) }, new Date(2027, 10, 1))
    assert.equal(later.termEnd, '2028-02-29')
  })

  test('a fixed mode without months does not renew', () => {
    assert.equal(computeDeadline({ renewalMode: 'fixed', minTermEnd: '2026-06-30', noticePeriod: m(1) }, now).status, 'passed')
  })

  test('keeps the entered term while its deadline lies ahead', () => {
    match(computeDeadline({ renewalMode: 'fixed', autoRenewMonths: 12, minTermEnd: '2027-06-30', noticePeriod: m(3) }, now), {
      termEnd: '2027-06-30',
      deadline: '2027-03-30',
    })
  })
})

describe('renewal mode none', () => {
  test('stays passed after the deadline', () => {
    const r = computeDeadline({ renewalMode: 'none', autoRenewMonths: 12, minTermEnd: '2026-06-30', noticePeriod: m(1) }, now)
    match(r, { deadline: '2026-05-30', status: 'passed' })
  })
})

describe('legacy contracts without renewalMode', () => {
  test('keep their stored fixed renewal (same dates as before)', () => {
    const r = computeDeadline({ typeId: 'strom', autoRenewMonths: 12, minTermEnd: '2026-01-31', noticePeriod: m(1) }, now)
    match(r, { termEnd: '2027-01-31', deadline: '2026-12-31' })
  })
  test('without renewal stay passed', () => {
    assert.equal(computeDeadline({ typeId: 'strom', minTermEnd: '2026-01-31', noticePeriod: m(1) }, now).status, 'passed')
    assert.equal(computeDeadline({ typeId: 'streaming', minTermEnd: '2026-01-31' }, now).status, 'passed')
  })
})

// Page-only helpers (not in the app)
describe('page helpers', () => {
  test('termEndFromStart: day before the same day n months later, else month end (§ 188 BGB)', () => {
    assert.equal(termEndFromStart('2026-03-15', 24), '2028-03-14')
    assert.equal(termEndFromStart('2026-01-01', 12), '2026-12-31')
    assert.equal(termEndFromStart('2026-01-31', 1), '2026-02-28')
    assert.equal(termEndFromStart('2026-01-30', 1), '2026-02-28')
    assert.equal(termEndFromStart('2028-01-31', 1), '2028-02-29')
    assert.equal(termEndFromStart('2026-01-28', 1), '2026-02-27')
    assert.equal(termEndFromStart('2026-02-30', 12), null)
    assert.equal(termEndFromStart('2026-01-01', 0), null)
  })
  test('German date formatting and notice text', () => {
    assert.equal(formatShort('2026-12-31'), '31.12.2026')
    assert.equal(formatLong('2026-12-31'), 'Donnerstag, 31. Dezember 2026')
    assert.equal(formatLong('2027-03-01'), 'Montag, 1. März 2027')
    assert.equal(isWeekend('2026-11-28'), true)
    assert.equal(isWeekend('2026-11-30'), false)
    assert.equal(noticeText(m(1)), '1 Monat')
    assert.equal(noticeText(m(3)), '3 Monate')
    assert.equal(noticeText(w(4)), '4 Wochen')
    assert.equal(noticeText(days(1)), '1 Tag')
  })
})
