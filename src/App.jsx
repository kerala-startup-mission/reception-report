import { useEffect, useMemo, useState } from 'react'
import {
  API,
  PRESETS,
  filterList,
  formatDay,
  formatStamp,
  inRange,
  prepare,
  presetRange,
  series,
  summarise,
  toCsv,
  todayIST,
} from './report'

// `?demo` on the dev server swaps the API for made-up rows, so the UI can be
// worked on without the passcode.
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')

// The passcode lives for the browser session only: closing the tab locks the
// report again, and it is never written into the URL or the build.
const STORE = 'reception-report-key'

// Rendering a thousand table rows is fine; ten thousand is not.
const PAGE = 300

// The dashboard shows the most recent escalations; the list has all of them.
const LATEST = 8

async function fetchReport(key, signal) {
  // spelled out here, not via DEMO, so the bundler can drop the fixture
  if (import.meta.env.DEV && DEMO) {
    const { demoRows } = await import('./fixture.js')
    const today = todayIST()
    return { generatedAt: `${today} 12:00:00`, rows: demoRows(today) }
  }
  const res = await fetch(API, { headers: { 'X-Report-Key': key }, cache: 'no-store', signal })
  if (res.status === 401 || res.status === 403) throw new Error('denied')
  const data = res.ok ? await res.json() : null
  if (!Array.isArray(data?.rows)) throw new Error('failed')
  return data
}

const percent = (ratio) => `${Math.round(ratio * 100)}%`
const share = (part, whole) => (whole ? `${percent(part / whole)} of visits` : '')

const Corners = () => (
  <>
    <i className="corner tl" />
    <i className="corner tr" />
    <i className="corner bl" />
    <i className="corner br" />
  </>
)

const Alert = ({ children }) =>
  children && (
    <div
      role="alert"
      className="mt-5 border-l-2 border-[var(--color-accent)] pl-3 text-sm font-semibold text-[var(--color-accent-800)]"
    >
      {children}
    </div>
  )

function Gate({ error, onSubmit }) {
  const [value, setValue] = useState('')
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center px-[18px] py-10">
      <div className="dr-step">Digital Reception</div>
      <h1 className="dr-head mt-1">Reception report</h1>
      <p className="rp-muted mt-3 mb-0 text-[17px]">
        Enter the report passcode to see check-ins and escalations.
      </p>
      <form
        className="mt-7"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onSubmit(value.trim())
        }}
      >
        <label className="block">
          <span className="dr-label">Passcode</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <Alert>{error}</Alert>
        <button type="submit" className="btn btn-primary blueprint mt-6 w-full">
          <Corners />
          Open report
        </button>
      </form>
    </main>
  )
}

const Card = ({ title, note, className = '', children }) => (
  <section className={`blueprint min-w-0 p-4 sm:p-5 ${className}`}>
    <Corners />
    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="rp-h2">{title}</h2>
      {note && <div className="rp-muted text-[13px]">{note}</div>}
    </header>
    {children}
  </section>
)

const Empty = ({ children }) => <p className="rp-muted m-0 text-sm">{children}</p>

// Label, value, and one line saying what the value is measured against. The
// first tile is the page's one hero figure.
const Tile = ({ label, value, note, hero }) => (
  <div className={hero ? 'col-span-2 sm:col-span-1' : ''}>
    <div className="dr-label">{label}</div>
    <div className={`leading-none font-semibold ${hero ? 'text-[52px]' : 'text-[30px]'}`}>
      {value}
    </div>
    {note && <div className="rp-muted mt-1.5 text-[13px] leading-snug">{note}</div>}
  </div>
)

// Round axis: 0 to a clean number in at most four steps.
function axis(max) {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => max / s <= 4) ?? Math.ceil(max / 4)
  const top = Math.max(step, Math.ceil(max / step) * step)
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
}

const PLOT = 'relative h-[168px]'

// Vertical bars over an ordered axis (time, hours, weekdays). `data` rows are
// { key, label, title, total, escalated? }; with `stacked`, the escalated part
// of each bar is drawn as its own segment.
function Columns({ data, unit, stacked }) {
  const max = Math.max(0, ...data.map((d) => d.total))
  const { top, ticks } = axis(max)
  const peak = data.findIndex((d) => d.total === max)
  // a number on every cap only while there are few enough to read
  const labelAll = data.length <= 12
  // long axes name about six points, so the labels still fit a phone
  const every = labelAll ? 1 : Math.ceil(data.length / 6)
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 pt-4" aria-hidden="true">
        <div className={`${PLOT} min-w-4`}>
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ bottom: `${(t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className={PLOT}>
          {ticks.map((t) => (
            <i key={t} className="gridline" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="cols">
            {data.map((d, i) => {
              const height = (d.total / top) * 100
              const edge = i < data.length * 0.15 ? 'at-start' : i > data.length * 0.85 ? 'at-end' : ''
              return (
                <div key={d.key} className={`col ${edge}`}>
                  {d.total > 0 && (labelAll || i === peak) && <span className="col-value">{d.total}</span>}
                  {d.total > 0 && (
                    <div className="col-bar" style={{ height: `${height}%` }}>
                      {stacked && d.escalated > 0 && (
                        <i className="col-seg escalated" style={{ flex: d.escalated }} />
                      )}
                      {d.total - (stacked ? d.escalated : 0) > 0 && (
                        <i className="col-seg" style={{ flex: d.total - (stacked ? d.escalated : 0) }} />
                      )}
                    </div>
                  )}
                  <span className="tip" style={{ bottom: `calc(${height}% + 22px)` }}>
                    <strong>{plural(d.total, unit)}</strong>
                    {stacked && d.escalated > 0 && ` · ${d.escalated} escalated`}
                    <br />
                    {d.title}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div />
        <div className="rp-muted flex pt-1.5 text-[11px] leading-none">
          {data.map((d, i) => (
            <span key={d.key} className="flex min-w-0 flex-1 justify-center whitespace-nowrap">
              {i % every === 0 && d.label}
            </span>
          ))}
        </div>
      </div>
      {/* the same numbers for keyboards and screen readers, which get no hover */}
      <details className="mt-3">
        <summary>View as table</summary>
        <table className="tbl mt-2 max-w-[360px]">
          <thead>
            <tr>
              <th>{data.length > 12 ? 'Period' : 'Slot'}</th>
              <th>{unit}s</th>
              {stacked && <th>Escalated</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.title}</td>
                <td className="num">{d.total}</td>
                {stacked && <td className="num">{d.escalated}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}

// Ranked horizontal bars. `data` rows are { label, count, sub?, note? }.
function BarList({ data, escalated, empty }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  if (!data.length) return <Empty>{empty}</Empty>
  return (
    <dl className="bars">
      {data.map((d) => (
        <div key={d.label} className="contents">
          <dt title={d.label}>
            {d.label}
            {d.sub && <small>{d.sub}</small>}
          </dt>
          <dd>
            {d.count > 0 && (
              <span
                className={`bar ${escalated ? 'escalated' : ''}`}
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            )}
          </dd>
          <dd className="bar-value">
            {d.count}
            {d.note && <small>{d.note}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// `focused` is true while one visit type is picked. Then anything that type
// cannot have is left out rather than shown empty: an event has no escalations,
// a KSUM enquiry has no company. With every type on screen nothing is hidden,
// so the layout does not shift as the dates change.
function Dashboard({ rows, range, focused }) {
  const s = useMemo(() => summarise(rows), [rows])
  const trend = useMemo(() => series(rows, range), [rows, range])
  if (!rows.length) return <Empty>No check-ins in this range.</Empty>

  const keep = (has) => !focused || has
  const escalation = keep(s.eligible > 0)
  // one purpose is not a comparison
  const purposes = keep(s.byPurpose.length > 1)

  return (
    <div className="grid gap-5 lg:grid-cols-6">
      <section className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-[var(--color-divider)] py-5 sm:grid-cols-4 lg:col-span-6 lg:grid-cols-7">
        <Tile hero label="Visits" value={s.total.toLocaleString('en-IN')} />
        {!focused && (
          <>
            <Tile label="KSUM enquiries" value={s.ksum} note={share(s.ksum, s.total)} />
            <Tile label="Incubated company" value={s.incubated} note={share(s.incubated, s.total)} />
            <Tile label="Events" value={s.events} note={share(s.events, s.total)} />
          </>
        )}
        {escalation && (
          <>
            <Tile
              label="Escalations"
              value={s.escalated}
              note={s.eligible ? `${percent(s.rate)} of ${s.eligible} KSUM walk-ins` : 'No KSUM walk-ins'}
            />
            <Tile
              label="Median wait"
              value={s.medianWait === null ? '–' : `${Math.round(s.medianWait)} min`}
              note="Check-in to escalation"
            />
          </>
        )}
        <Tile label="Visitors" value={s.unique} note={`${s.repeat} came more than once`} />
      </section>

      <Card
        className="lg:col-span-6"
        title="Visits over time"
        // one series needs no legend: the title already names it
        note={
          escalation && (
            <>
              <span className="mr-4">
                <i className="swatch" />
                Visits
              </span>
              <span>
                <i className="swatch escalated" />
                Escalated
              </span>
            </>
          )
        }
      >
        {trend.length ? (
          <Columns data={trend} unit="visit" stacked={escalation} />
        ) : (
          <Empty>No dated check-ins.</Empty>
        )}
      </Card>

      {purposes && (
        <Card className="lg:col-span-3" title="Purpose of visit">
          <BarList data={s.byPurpose} />
        </Card>
      )}
      <div className={`grid min-w-0 gap-5 ${purposes ? 'lg:col-span-3' : 'lg:col-span-6 lg:grid-cols-2'}`}>
        <Card title="Hour of day" note="Check-in time, IST">
          <Columns data={s.byHour} unit="visit" />
        </Card>
        <Card title="Day of week">
          <Columns data={s.byWeekday} unit="visit" />
        </Card>
      </div>

      {escalation && (
        <>
          <Card className="lg:col-span-3" title="Escalations by purpose" note="KSUM walk-ins only">
            <BarList
              escalated
              empty="No KSUM walk-ins in this range."
              data={s.escalationsByPurpose.map((p) => ({
                ...p,
                sub: p.owner,
                note: `of ${p.eligible}`,
              }))}
            />
          </Card>
          <Card
            className="lg:col-span-3"
            title="Escalated visits"
            note={
              s.escalated > LATEST
                ? `Latest ${LATEST} of ${s.escalated} · the rest are under List, Escalated only`
                : `${s.escalated} in range`
            }
          >
            {s.escalations.length ? (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Checked in</th>
                      <th>Visitor</th>
                      <th>Purpose / owner</th>
                      <th>Waited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.escalations.slice(0, LATEST).map((r) => (
                      <tr key={r.token}>
                        <td className="num">{r.token}</td>
                        <td className="num">{formatStamp(r.timestamp)}</td>
                        <td>{r.name}</td>
                        <td>
                          {r.requirement}
                          <small>{r.owner}</small>
                        </td>
                        <td className="num">{r.waited === null ? '–' : `${r.waited} min`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nobody escalated in this range.</Empty>
            )}
          </Card>
        </>
      )}

      {/* however many of these remain, they share the row evenly */}
      <div className="grid min-w-0 gap-5 md:grid-cols-[repeat(auto-fit,minmax(260px,1fr))] lg:col-span-6">
        <Card title="Visitors come from" note="Top organisations">
          <BarList data={s.topOrganisations} empty="No organisations recorded." />
        </Card>
        {keep(s.topCompanies.length > 0) && (
          <Card title="Companies visited" note="Incubated company visits">
            <BarList data={s.topCompanies} empty="No incubated-company visits." />
          </Card>
        )}
        {keep(s.topEvents.length > 0) && (
          <Card title="Events" note="Attendees checked in">
            <BarList data={s.topEvents} empty="No event check-ins." />
          </Card>
        )}
      </div>
    </div>
  )
}

function download(rows, range) {
  // the BOM is what makes Excel read Malayalam names as UTF-8
  const url = URL.createObjectURL(new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `reception-report_${range.from || 'start'}_${range.to || 'latest'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const distinct = (rows, field) => [...new Set(rows.map((r) => r[field]))].sort()

// What the company column holds depends on who was being visited.
const COMPANY_HEAD = { 'Incubated Company': 'Company', 'Attend an Event': 'Event' }

// `all` is every check-in of the chosen visit type, whatever its date: menus
// and columns are decided from it, so they do not come and go with the dates.
function ListView({ rows, all, range, type }) {
  const [query, setQuery] = useState('')
  const [purpose, setPurpose] = useState('')
  const [escalatedOnly, setEscalatedOnly] = useState(false)
  const [newestFirst, setNewestFirst] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const purposes = useMemo(() => distinct(all, 'purpose'), [all])
  // Same rule as the dashboard: with one visit type picked, a column or filter
  // that type cannot use is dropped.
  const keep = (has) => !type || has
  const byPurpose = keep(purposes.length > 1)
  const escalation = keep(all.some((r) => r.eligible || r.escalatedAt))
  const companies = keep(all.some((r) => r.company))
  // A filter set under another visit type must not keep filtering once its
  // control is gone.
  const purposeFilter = byPurpose && purposes.includes(purpose) ? purpose : ''
  const escalatedFilter = escalation && escalatedOnly
  const found = useMemo(
    () => filterList(rows, { query, purpose: purposeFilter, escalatedOnly: escalatedFilter, newestFirst }),
    [rows, query, purposeFilter, escalatedFilter, newestFirst],
  )
  const shown = showAll ? found : found.slice(0, PAGE)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="input input-sm min-w-[220px] flex-1 sm:max-w-[340px]"
          type="search"
          placeholder="Search name, phone, email, company, token"
          aria-label="Search check-ins"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {byPurpose && (
          <select
            className="input input-sm max-w-[240px]"
            aria-label="Purpose"
            value={purposeFilter}
            onChange={(e) => setPurpose(e.target.value)}
          >
            <option value="">All purposes</option>
            {purposes.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        )}
        {escalation && (
          <label className="flex min-h-9 cursor-pointer items-center gap-2 px-1 text-sm">
            <input type="checkbox" checked={escalatedOnly} onChange={(e) => setEscalatedOnly(e.target.checked)} />
            Escalated only
          </label>
        )}
        <span className="rp-muted ml-auto text-sm">
          {found.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} check-ins
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!found.length}
          onClick={() => download(found, range)}
        >
          Export CSV
        </button>
      </div>

      {found.length ? (
        <div className="overflow-x-auto">
          <table className={`tbl ${type ? 'min-w-[720px]' : 'min-w-[980px]'}`}>
            <thead>
              <tr>
                <th>Token</th>
                <th aria-sort={newestFirst ? 'descending' : 'ascending'}>
                  <button
                    type="button"
                    className="cursor-pointer font-[inherit] tracking-[inherit] uppercase"
                    onClick={() => setNewestFirst((v) => !v)}
                  >
                    Checked in {newestFirst ? '↓' : '↑'}
                  </button>
                </th>
                <th>Visitor</th>
                <th>Contact</th>
                {companies && <th>{type ? (COMPANY_HEAD[type] ?? 'Meeting') : 'Visit'}</th>}
                {byPurpose && <th>Purpose</th>}
                {escalation && <th>Owner</th>}
                {escalation && <th>Escalation</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.token}>
                  <td className="num">{r.token}</td>
                  <td className="num">{formatStamp(r.timestamp) || '–'}</td>
                  <td>
                    {r.name}
                    <small>{r.organisation}</small>
                  </td>
                  <td>
                    <a href={`tel:${r.phone}`}>{r.phone}</a>
                    <small>
                      <a href={`mailto:${r.email}`}>{r.email}</a>
                    </small>
                  </td>
                  {companies &&
                    (type ? (
                      <td>{r.company || '–'}</td>
                    ) : (
                      <td>
                        {r.type}
                        <small>{r.company}</small>
                      </td>
                    ))}
                  {byPurpose && <td>{r.requirement}</td>}
                  {escalation && <td>{r.owner || '–'}</td>}
                  {escalation && (
                    <td>
                      {r.escalatedAt ? (
                        <>
                          <span className="flag">Escalated</span>
                          <small>{r.waited === null ? formatStamp(r.escalatedAt) : `after ${r.waited} min`}</small>
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No check-ins match.</Empty>
      )}
      {shown.length < found.length && (
        <button type="button" className="btn btn-sm mt-4" onClick={() => setShowAll(true)}>
          Show all {found.length.toLocaleString('en-IN')}
        </button>
      )}
    </>
  )
}

const heldKey = () => (DEMO ? 'demo' : (sessionStorage.getItem(STORE) ?? ''))

export default function App() {
  // What to fetch. A new object, even with the same key, fetches again. A
  // passcode already held from earlier in this session opens the report.
  const [request, setRequest] = useState(() => (heldKey() ? { key: heldKey() } : null))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(Boolean(request))
  const [error, setError] = useState('')
  const [tab, setTab] = useState('dashboard')
  const today = todayIST()
  const [range, setRange] = useState(() => ({ preset: '30d', ...presetRange('30d', today) }))
  // '' is every visit type; 'KSUM' leaves out incubated-company and event visits
  const [type, setType] = useState('')

  function open(key, refresh = false) {
    setLoading(true)
    setError('')
    setRequest({ key, refresh })
  }

  function lock() {
    sessionStorage.removeItem(STORE)
    setRequest(null)
    setReport(null)
  }

  // Aborting on cleanup, as the kiosk does: StrictMode runs effects twice in
  // development and the dropped request would still hit the webhook.
  useEffect(() => {
    if (!request) return
    const stop = new AbortController()
    fetchReport(request.key, stop.signal)
      .then((data) => {
        if (stop.signal.aborted) return
        if (!DEMO) sessionStorage.setItem(STORE, request.key)
        setReport({ key: request.key, generatedAt: data.generatedAt, rows: prepare(data.rows) })
      })
      .catch((e) => {
        if (stop.signal.aborted) return
        // a failed refresh keeps what is already on screen
        if (request.refresh && e.message !== 'denied') {
          return setError('Could not refresh. Showing the last data loaded.')
        }
        sessionStorage.removeItem(STORE)
        setReport(null)
        setError(
          e.message === 'denied'
            ? 'That passcode was not accepted.'
            : 'Could not load the report. Check the passcode and your connection.',
        )
      })
      .finally(() => stop.signal.aborted || setLoading(false))
    return () => stop.abort()
  }, [request])

  // the chosen visit type across all dates, then the slice the dates leave
  const ofType = useMemo(
    () => (report ? report.rows.filter((r) => !type || r.type === type) : []),
    [report, type],
  )
  const rows = useMemo(() => ofType.filter((r) => inRange(r, range)), [ofType, range])
  // from the whole sheet, so the chosen type never drops out of its own menu
  const types = useMemo(() => (report ? distinct(report.rows, 'type') : []), [report])

  if (!report) {
    return loading ? (
      <p className="rp-muted flex min-h-dvh items-center justify-center">Loading report…</p>
    ) : (
      <Gate error={error} onSubmit={open} />
    )
  }

  const undated = ofType.filter((r) => !r.date).length
  const allDates = !range.from && !range.to

  return (
    <div className="mx-auto max-w-[1320px] px-[18px] pt-6 pb-16 sm:px-7">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="dr-step">Digital Reception{DEMO && ' · demo data'}</div>
          <h1 className="dr-head mt-1">Reception report</h1>
        </div>
        <div className="rp-muted flex flex-wrap items-center gap-2 text-[13px]">
          <span className="mr-1">Data as of {formatStamp(report.generatedAt)}</span>
          <button type="button" className="btn btn-sm" disabled={loading} onClick={() => open(report.key, true)}>
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={lock}>
            Lock
          </button>
        </div>
      </header>
      <Alert>{error}</Alert>

      {/* one filter row, above everything it scopes: both views read the same slice */}
      <div className="mt-6 mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <nav className="flex" aria-label="View">
          {[
            ['dashboard', 'Dashboard'],
            ['list', 'List'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn btn-sm -ml-px first:ml-0"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap" role="group" aria-label="Date range">
          {PRESETS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn btn-sm -ml-px first:ml-0"
              aria-pressed={range.preset === id}
              onClick={() => setRange({ preset: id, ...presetRange(id, today) })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="rp-muted">From</span>
            <input
              className="input input-sm"
              type="date"
              value={range.from}
              max={range.to || today}
              onChange={(e) => setRange({ ...range, preset: '', from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="rp-muted">to</span>
            <input
              className="input input-sm"
              type="date"
              value={range.to}
              min={range.from}
              max={today}
              onChange={(e) => setRange({ ...range, preset: '', to: e.target.value })}
            />
          </label>
        </div>
        <select
          className="input input-sm"
          aria-label="Visit type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All visit types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t} only
            </option>
          ))}
        </select>
        <span className="rp-muted text-[13px]">
          {allDates ? 'All dates' : `${range.from ? formatDay(range.from) : 'Start'} – ${range.to ? formatDay(range.to) : 'latest'}`}
          {undated > 0 &&
            (allDates
              ? ` · includes ${undated} check-ins from before times were recorded`
              : ` · ${undated} undated check-ins are only counted under All`)}
        </span>
      </div>

      {/* while a refresh is in flight the last render stays put, dimmed */}
      <main className={loading ? 'opacity-50' : ''}>
        {tab === 'dashboard' ? (
          <Dashboard rows={rows} range={range} focused={Boolean(type)} />
        ) : (
          <ListView rows={rows} all={ofType} range={range} type={type} />
        )}
      </main>
    </div>
  )
}
