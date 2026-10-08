import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  filterList,
  formatStamp,
  inRange,
  parseStamp,
  prepare,
  presetRange,
  series,
  summarise,
  toCsv,
  todayIST,
} from './report.js'

const row = (over) => ({
  token: 'V101',
  timestamp: '2026-10-05 10:00:00',
  name: 'Test Entry',
  phone: '9495513259',
  email: 'test@example.com',
  organisation: 'KSUM',
  requirement: 'Financial Assistance',
  visitType: 'KSUM',
  company: '',
  escalatedAt: '',
  eligible: true,
  owner: 'Asha',
  ...over,
})

const rows = prepare([
  row({ token: 'V101', escalatedAt: '2026-10-05 10:20:00' }),
  row({ token: 'V102', timestamp: '2026-10-05 11:30:00', phone: '+91 94955 13259' }),
  row({ token: 'V103', timestamp: '2026-10-06 15:00:00', phone: '9000000001', escalatedAt: '2026-10-06 15:40:00' }),
  row({
    token: 'V104',
    timestamp: '2026-10-08 09:15:00',
    phone: '9000000002',
    visitType: 'Incubated Company',
    requirement: 'Meeting',
    company: 'Acme Labs',
    eligible: false,
    owner: '',
  }),
  row({
    token: 'V105',
    timestamp: '2026-10-08 09:20:00',
    phone: '9000000003',
    visitType: 'Attend an Event',
    requirement: 'Attend an Event',
    company: 'Startup Meetup',
    eligible: false,
    owner: '',
  }),
  // written before the timestamp and visit-type columns existed
  row({ token: 'V106', timestamp: '', phone: '9000000004', visitType: '' }),
])

test('reads the sheet timestamp without going through local time', () => {
  assert.deepEqual(parseStamp('2026-09-08 16:02:00'), {
    date: '2026-09-08',
    hour: 16,
    minutes: Date.UTC(2026, 8, 8, 16, 2) / 60_000,
  })
  assert.equal(parseStamp(''), null)
  assert.equal(parseStamp('8/9/2026 16:02'), null)
  assert.equal(formatStamp('2026-09-08 16:02:00'), '8 Sep 2026, 16:02')
  assert.equal(formatStamp('nope'), '')
})

test('morning times without the leading zero are read the same way', () => {
  assert.deepEqual(parseStamp('2026-09-12 9:24:59'), parseStamp('2026-09-12 09:24:59'))
  assert.deepEqual(parseStamp('2026-9-2 9:05:00'), {
    date: '2026-09-02',
    hour: 9,
    minutes: Date.UTC(2026, 8, 2, 9, 5) / 60_000,
  })
  assert.equal(formatStamp('2026-09-12 9:24:59'), '12 Sep 2026, 09:24')
  assert.equal(parseStamp('2026-09-12 25:00:00'), null)

  const [visit] = prepare([row({ timestamp: '2026-09-12 9:50:00', escalatedAt: '2026-09-12 10:10:00' })])
  assert.equal(visit.date, '2026-09-12')
  assert.equal(visit.waited, 20)
  assert.equal(inRange(visit, { from: '2026-09-12', to: '2026-09-12' }), true)
  assert.equal(summarise([visit]).byHour.find((h) => h.key === 9).total, 1)
})

test('today is the IST date, not the UTC one', () => {
  assert.equal(todayIST(new Date('2026-10-07T20:00:00Z')), '2026-10-08')
  assert.equal(todayIST(new Date('2026-10-07T18:00:00Z')), '2026-10-07')
})

test('presets are inclusive of today and cross month ends', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.deepEqual(presetRange('today', '2026-10-08'), { from: '2026-10-08', to: '2026-10-08' })
  assert.deepEqual(presetRange('7d', '2026-10-03'), { from: '2026-09-27', to: '2026-10-03' })
  assert.deepEqual(presetRange('30d', '2026-10-08'), { from: '2026-09-09', to: '2026-10-08' })
  assert.deepEqual(presetRange('month', '2026-10-08'), { from: '2026-10-01', to: '2026-10-08' })
  assert.deepEqual(presetRange('all', '2026-10-08'), { from: '', to: '' })
})

test('range edges are inclusive and undated rows only count when it is open', () => {
  const tokens = (range) => rows.filter((r) => inRange(r, range)).map((r) => r.token)
  assert.deepEqual(tokens({ from: '2026-10-06', to: '2026-10-08' }), ['V103', 'V104', 'V105'])
  assert.deepEqual(tokens({ from: '', to: '2026-10-05' }), ['V101', 'V102'])
  assert.equal(tokens({ from: '', to: '' }).length, 6)
})

test('summary counts visit types, escalations and visitors', () => {
  const s = summarise(rows)
  assert.equal(s.total, 6)
  assert.equal(s.ksum, 4)
  assert.equal(s.incubated, 1)
  assert.equal(s.events, 1)
  // incubated and event visits cannot escalate, so they are not in the rate
  assert.equal(s.eligible, 4)
  assert.equal(s.escalated, 2)
  assert.equal(s.rate, 0.5)
  assert.equal(s.medianWait, 30) // 20 and 40 minutes
  // V101 and V102 are one phone written two ways
  assert.equal(s.unique, 5)
  assert.equal(s.repeat, 1)
  assert.deepEqual(s.topCompanies, [{ label: 'Acme Labs', count: 1 }])
  assert.deepEqual(s.topEvents, [{ label: 'Startup Meetup', count: 1 }])
  assert.deepEqual(s.escalationsByPurpose, [
    { label: 'Financial Assistance', owner: 'Asha', eligible: 4, count: 2 },
  ])
  assert.equal(s.byHour.find((h) => h.key === 9).total, 2)
  assert.deepEqual(
    s.byWeekday.map((d) => d.total),
    [2, 1, 0, 2, 0, 0, 0], // 5 Oct 2026 is a Monday
  )
})

test('an empty range summarises to zeroes instead of throwing', () => {
  const s = summarise([])
  assert.equal(s.total, 0)
  assert.equal(s.rate, 0)
  assert.equal(s.medianWait, null)
  assert.equal(s.byHour.length, 10) // 09 to 18
  assert.deepEqual(series([], { from: '', to: '' }), [])
})

test('one-off purposes fold into Other', () => {
  const prepared = prepare([row({}), row({}), row({ requirement: 'IV' })])
  assert.deepEqual(
    prepared.map((r) => r.purpose),
    ['Financial Assistance', 'Financial Assistance', 'Other'],
  )
})

test('the trend keeps quiet days and widens its buckets on long ranges', () => {
  const daily = series(rows, { from: '2026-10-05', to: '2026-10-08' })
  assert.deepEqual(
    daily.map((b) => [b.label, b.total, b.escalated]),
    [
      ['5 Oct', 2, 1],
      ['6 Oct', 1, 1],
      ['7 Oct', 0, 0],
      ['8 Oct', 2, 0],
    ],
  )
  const weekly = series(rows, { from: '2026-08-01', to: '2026-10-08' })
  assert.equal(weekly.at(-1).title, 'Week of 5 Oct 2026')
  assert.equal(weekly.at(-1).total, 5)
  const monthly = series(rows, { from: '2026-01-01', to: '2026-10-08' })
  assert.deepEqual(monthly.at(-1), { key: '2026-10', label: 'Oct', title: 'Oct 2026', total: 5, escalated: 2 })
  assert.equal(monthly.length, 10)
})

test('the list searches every word, filters and sorts', () => {
  const find = (over) =>
    filterList(rows, { query: '', purpose: '', escalatedOnly: false, newestFirst: true, ...over }).map(
      (r) => r.token,
    )
  assert.deepEqual(find({}), ['V105', 'V104', 'V103', 'V102', 'V101', 'V106'])
  assert.deepEqual(find({ newestFirst: false }).at(-1), 'V106')
  assert.deepEqual(find({ query: 'acme MEETING' }), ['V104'])
  assert.deepEqual(find({ purpose: 'Financial Assistance', query: '9000000001' }), ['V103'])
  assert.deepEqual(find({ escalatedOnly: true }), ['V103', 'V101'])
})

test('csv quotes cells and defuses formulas but leaves phone numbers alone', () => {
  const [head, line] = toCsv(
    prepare([row({ name: '=HYPERLINK("http://x","y")', phone: '+919495513259', organisation: 'A, B' })]),
  ).split('\r\n')
  assert.ok(head.startsWith('"Token","Checked in","Name"'))
  assert.ok(line.includes(`"'=HYPERLINK(""http://x"",""y"")"`))
  assert.ok(line.includes('"+919495513259"'))
  assert.ok(line.includes('"A, B"'))
  assert.ok(toCsv(prepare([row({ name: '-2+3+cmd' })])).includes(`"'-2+3+cmd"`))
})
