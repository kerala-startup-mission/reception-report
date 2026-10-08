export const API = 'https://api.startupmission.in/webhook/ktiz-enquiry'

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Sheets drops the leading zero when it displays a time, so a morning check-in
// reads "2026-09-12 9:24:59". Month, day and hour may each be one digit.
const STAMP = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/

const pad = (n) => String(n).padStart(2, '0')

// "2026-09-08 16:02:00" -> { date: '2026-09-08', hour: 16, minutes }.
// The sheet stores IST wall-clock with no UTC offset. The parts are read out of
// the string and only ever recombined through Date.UTC, so nothing here shifts
// with the viewer's timezone. `minutes` is only meaningful as a difference.
// `date` is always zero-padded: ranges compare it as text.
export function parseStamp(stamp) {
  const m = STAMP.exec(String(stamp ?? '').trim())
  if (!m) return null
  const [year, month, day, hour, minute] = m.slice(1).map(Number)
  if (!MONTHS[month - 1] || hour > 23) return null
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    hour,
    minutes: Date.UTC(year, month - 1, day, hour, minute) / 60_000,
  }
}

// "2026-09-08 16:02:00" -> "8 Sep 2026, 16:02", "2026-09-12 9:24:59" -> "12 Sep 2026, 09:24"
export function formatStamp(stamp) {
  const at = parseStamp(stamp)
  if (!at) return ''
  const [, year, month, day, hour, minute] = STAMP.exec(String(stamp).trim())
  return `${Number(day)} ${MONTHS[month - 1]} ${year}, ${pad(hour)}:${minute}`
}

// "2026-09-08" -> "8 Sep"
export const formatDay = (ymd) => `${Number(ymd.slice(8))} ${MONTHS[ymd.slice(5, 7) - 1]}`

// Reception runs on IST whatever device the report is opened on.
export const todayIST = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)

export const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * DAY).toISOString().slice(0, 10)

export const PRESETS = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['month', 'This month'],
  ['all', 'All'],
]

// '' on either side means unbounded.
export function presetRange(preset, today) {
  if (preset === 'today') return { from: today, to: today }
  if (preset === '7d') return { from: addDays(today, -6), to: today }
  if (preset === '30d') return { from: addDays(today, -29), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: '', to: '' }
}

// Rows written before the timestamp column existed have no date. They belong
// to no day, so they only count when the range is fully open.
export function inRange(row, { from, to }) {
  if (!row.date) return !from && !to
  return (!from || row.date >= from) && (!to || row.date <= to)
}

// Case-insensitive count of whatever keyOf returns, biggest first.
function tally(rows, keyOf) {
  const seen = new Map()
  for (const row of rows) {
    const label = keyOf(row)
    if (!label) continue
    const key = label.toLowerCase()
    const hit = seen.get(key)
    if (hit) hit.count++
    else seen.set(key, { label, count: 1 })
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

const KEEP_PURPOSES = 12

// Adds the derived fields every view reads. Done once per fetch, over the whole
// sheet, so a purpose keeps its name whatever date range is on screen.
export function prepare(raw) {
  // Incubated-company visitors who pick "Other" send their own words as the
  // requirement, so the long tail is free text. Anything outside the most
  // common values is folded into one bucket.
  const known = new Set(
    tally(raw, (r) => r.requirement)
      .filter((p) => p.count > 1)
      .slice(0, KEEP_PURPOSES)
      .map((p) => p.label.toLowerCase()),
  )
  return raw.map((r) => {
    const at = parseStamp(r.timestamp)
    const escalated = parseStamp(r.escalatedAt)
    return {
      ...r,
      date: at?.date ?? '',
      hour: at?.hour ?? null,
      minutes: at?.minutes ?? null,
      // rows from before the visit-type column were all KSUM enquiries
      type: r.visitType || 'KSUM',
      purpose: known.has(r.requirement.toLowerCase()) ? r.requirement : 'Other',
      waited: at && escalated ? Math.max(0, escalated.minutes - at.minutes) : null,
      haystack: [r.token, r.name, r.phone, r.email, r.organisation, r.company, r.requirement, r.owner]
        .join(' ')
        .toLowerCase(),
    }
  })
}

const median = (numbers) => {
  if (!numbers.length) return null
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// +91 94955 13259 and 9495513259 are the same visitor.
const phoneKey = (phone) => phone.replace(/\D/g, '').slice(-10)

export function summarise(rows) {
  const count = (type) => rows.filter((r) => r.type === type).length
  // Only KSUM walk-ins are offered the Escalate button. A row that did escalate
  // was eligible by definition, whatever its type says now.
  const eligible = rows.filter((r) => r.eligible || r.escalatedAt)
  const escalations = eligible
    .filter((r) => r.escalatedAt)
    .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))
  const visitors = tally(rows, (r) => phoneKey(r.phone))

  const dated = rows.filter((r) => r.date)
  const hours = dated.map((r) => r.hour)
  const byHour = []
  for (let h = Math.min(9, ...hours); h <= Math.max(18, ...hours); h++) {
    byHour.push({ key: h, label: String(h).padStart(2, '0'), title: `${h}:00 – ${h}:59`, total: 0 })
  }
  for (const r of dated) byHour[r.hour - byHour[0].key].total++

  const byWeekday = WEEKDAYS.map((label) => ({ key: label, label, title: label, total: 0 }))
  // getUTCDay is Sunday-first; the week here starts on Monday
  for (const r of dated) byWeekday[(new Date(Date.parse(r.date)).getUTCDay() + 6) % 7].total++

  const byOwner = new Map()
  for (const r of eligible) {
    const hit = byOwner.get(r.purpose) ?? { label: r.purpose, owner: r.owner, eligible: 0, count: 0 }
    hit.eligible++
    if (r.escalatedAt) hit.count++
    byOwner.set(r.purpose, hit)
  }

  return {
    total: rows.length,
    ksum: count('KSUM'),
    incubated: count('Incubated Company'),
    events: count('Attend an Event'),
    eligible: eligible.length,
    escalated: escalations.length,
    rate: eligible.length ? escalations.length / eligible.length : 0,
    medianWait: median(escalations.map((r) => r.waited).filter((w) => w !== null)),
    unique: visitors.length,
    repeat: visitors.filter((v) => v.count > 1).length,
    byPurpose: tally(rows, (r) => r.purpose),
    byHour,
    byWeekday,
    topOrganisations: tally(rows, (r) => r.organisation).slice(0, 8),
    topCompanies: tally(rows.filter((r) => r.type === 'Incubated Company'), (r) => r.company).slice(0, 8),
    topEvents: tally(rows.filter((r) => r.type === 'Attend an Event'), (r) => r.company).slice(0, 8),
    escalationsByPurpose: [...byOwner.values()].sort(
      (a, b) => b.count - a.count || b.eligible - a.eligible,
    ),
    escalations,
  }
}

const mondayOf = (ymd) => addDays(ymd, -((new Date(Date.parse(ymd)).getUTCDay() + 6) % 7))

// Visits over time, one bucket per day, week or month depending on how long the
// range is. Empty buckets are kept: a quiet day is a zero, not a gap.
export function series(rows, { from, to }) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort()
  if (!dates.length) return []
  const start = from || dates[0]
  const end = to || dates.at(-1)
  const days = (Date.parse(end) - Date.parse(start)) / DAY + 1
  const unit = days <= 45 ? 'day' : days <= 210 ? 'week' : 'month'
  const keyOf = (d) => (unit === 'day' ? d : unit === 'week' ? mondayOf(d) : d.slice(0, 7))

  const buckets = new Map()
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = keyOf(d)
    if (buckets.has(key)) continue
    const month = `${MONTHS[key.slice(5, 7) - 1]} ${key.slice(0, 4)}`
    buckets.set(key, {
      key,
      label: unit === 'month' ? month.slice(0, 3) : formatDay(key),
      title:
        unit === 'month' ? month : `${unit === 'week' ? 'Week of ' : ''}${formatDay(key)} ${key.slice(0, 4)}`,
      total: 0,
      escalated: 0,
    })
  }
  for (const r of rows) {
    const bucket = buckets.get(r.date && keyOf(r.date))
    if (!bucket) continue
    bucket.total++
    if (r.escalatedAt) bucket.escalated++
  }
  return [...buckets.values()]
}

export function filterList(rows, { query, purpose, escalatedOnly, newestFirst }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows
    .filter(
      (r) =>
        (!purpose || r.purpose === purpose) &&
        (!escalatedOnly || r.escalatedAt) &&
        words.every((w) => r.haystack.includes(w)),
    )
    // undated rows have nothing to sort on and go last either way
    .sort((a, b) =>
      a.minutes === null || b.minutes === null
        ? (a.minutes === null) - (b.minutes === null)
        : newestFirst
          ? b.minutes - a.minutes
          : a.minutes - b.minutes,
    )
}

const CSV_COLUMNS = [
  ['Token', (r) => r.token],
  ['Checked in', (r) => r.timestamp],
  ['Name', (r) => r.name],
  ['Phone', (r) => r.phone],
  ['Email', (r) => r.email],
  ['Organisation', (r) => r.organisation],
  ['Visit type', (r) => r.type],
  ['Purpose', (r) => r.requirement],
  ['Visiting / event', (r) => r.company],
  ['Owner', (r) => r.owner],
  ['Escalated at', (r) => r.escalatedAt],
  ['Minutes to escalation', (r) => (r.waited === null ? '' : String(r.waited))],
]

// Every cell is something a visitor typed at a kiosk, and this file is opened
// in Excel by staff. A cell that would be read as a formula gets a leading
// apostrophe. A plain signed number ("+919495513259") is harmless and is left
// alone so phone numbers stay readable.
function csvCell(value) {
  const text = String(value ?? '')
  const formula = /^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^[+-][\d\s.]*$/.test(text))
  return `"${(formula ? `'${text}` : text).replaceAll('"', '""')}"`
}

export const toCsv = (rows) =>
  [CSV_COLUMNS.map(([head]) => head), ...rows.map((r) => CSV_COLUMNS.map(([, cell]) => cell(r)))]
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n')
