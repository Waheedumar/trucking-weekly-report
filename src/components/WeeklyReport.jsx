import { useState } from 'react'
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Route, Users, Package,
  Fuel, ArrowLeft, Copy, Printer, CheckCircle2, BarChart3,
  AlertCircle, StickyNote, Activity
} from 'lucide-react'

const fmt = (n) => Number(n || 0).toLocaleString('en-US')
const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const pct = (n, d) => d && d !== '0' ? ((n - d) / d * 100).toFixed(1) : null
const num = (v) => parseFloat(v) || 0

function ChangeArrow({ current, prev, suffix = '' }) {
  if (!prev || prev === '' || prev === '0') return null
  const change = pct(num(current), num(prev))
  if (change === null) return null
  const val = parseFloat(change)
  if (Math.abs(val) < 0.1) return (
    <span className="kpi-change neutral">
      <Minus size={11} /> {Math.abs(val)}{suffix}%
    </span>
  )
  if (val > 0) return (
    <span className="kpi-change up">
      <TrendingUp size={11} /> +{val}{suffix}%
    </span>
  )
  return (
    <span className="kpi-change down">
      <TrendingDown size={11} /> {val}{suffix}%
    </span>
  )
}

function getPerf(revenue, avgRevenue) {
  if (!revenue || !avgRevenue) return 'average'
  const ratio = num(revenue) / avgRevenue
  if (ratio >= 1.1) return 'excellent'
  if (ratio >= 0.9) return 'good'
  return 'average'
}

function getPerfLabel(perf) {
  if (perf === 'excellent') return 'Top Performer'
  if (perf === 'good') return 'On Target'
  return 'Below Avg'
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatWeekRange(start, end) {
  if (!start && !end) return 'Week not specified'
  if (!start) return `Through ${formatDate(end)}`
  if (!end) return `Starting ${formatDate(start)}`
  return `${formatDate(start)} – ${formatDate(end)}`
}

export default function WeeklyReport({ formData, reportGenerated, onBack }) {
  const [copied, setCopied] = useState(false)

  const {
    companyName, fleetName, weekStart, weekEnd, reportedBy,
    totalLoads, totalMiles, deadheadMiles, fuelStops, fuelGallons,
    grossRevenue, fuelCost, driverPay, maintenance, insurance, tolls, otherExpenses,
    prevLoads, prevMiles, prevRevenue, prevNetProfit,
    drivers, notes
  } = formData

  const revenue = num(grossRevenue)
  const totalExpenses = num(fuelCost) + num(driverPay) + num(maintenance) + num(insurance) + num(tolls) + num(otherExpenses)
  const netProfit = revenue - totalExpenses
  const profitMargin = revenue > 0 ? (netProfit / revenue * 100).toFixed(1) : 0
  const revenuePerMile = num(totalMiles) > 0 ? (revenue / num(totalMiles)).toFixed(2) : 0
  const avgMilesPerLoad = num(totalLoads) > 0 ? Math.round(num(totalMiles) / num(totalLoads)) : 0
  const deadheadPct = num(totalMiles) > 0 ? ((num(deadheadMiles) / num(totalMiles)) * 100).toFixed(1) : 0
  const mpg = num(fuelGallons) > 0 ? (num(totalMiles) / num(fuelGallons)).toFixed(1) : 0
  const costPerMile = num(totalMiles) > 0 ? (totalExpenses / num(totalMiles)).toFixed(2) : 0

  const validDrivers = (drivers || []).filter(d => d.name?.trim())
  const totalDriverRevenue = validDrivers.reduce((s, d) => s + num(d.revenue), 0)
  const avgDriverRevenue = validDrivers.length > 0 ? totalDriverRevenue / validDrivers.length : 0
  const sortedDrivers = [...validDrivers].sort((a, b) => num(b.revenue) - num(a.revenue))

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const handleCopy = () => {
    const text = buildTextReport({ formData, netProfit, profitMargin, revenuePerMile, avgMilesPerLoad, deadheadPct, mpg, costPerMile, totalExpenses, sortedDrivers })
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const handlePrint = () => window.print()

  if (!reportGenerated) {
    return (
      <div className="report-empty">
        <div className="report-empty-icon">
          <BarChart3 size={30} />
        </div>
        <div className="report-empty-title">No Report Generated Yet</div>
        <div className="report-empty-desc">
          Fill out the weekly data form and click "Generate Report" to create your professional performance report.
        </div>
        <button className="btn btn-primary btn-lg" onClick={onBack}>
          <ArrowLeft size={16} />
          Go to Form
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="report-actions no-print">
        <button className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={15} />
          Back to Form
        </button>
        <button
          className={`btn ${copied ? 'btn-success copy-success' : 'btn-primary'}`}
          onClick={handleCopy}
        >
          {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
          {copied ? 'Copied!' : 'Copy Report'}
        </button>
        <button className="btn btn-secondary" onClick={handlePrint}>
          <Printer size={15} />
          Print / PDF
        </button>
      </div>

      <div className="report-container print-container">
        {/* Header */}
        <div className="report-header">
          <div>
            <div className="report-type-label">
              <Activity size={11} />
              Weekly Performance Report
            </div>
            <div className="report-company">{companyName || 'Company Name'}</div>
            {fleetName && (
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{fleetName}</div>
            )}
            <div className="report-week-range">{formatWeekRange(weekStart, weekEnd)}</div>
          </div>
          <div className="report-meta">
            <div className="report-meta-item">Generated</div>
            <div className="report-meta-value">{today}</div>
            {reportedBy && (
              <>
                <div className="report-meta-item" style={{ marginTop: 12 }}>Prepared by</div>
                <div className="report-meta-value">{reportedBy}</div>
              </>
            )}
          </div>
        </div>

        <div className="report-body">
          {/* KPI Grid */}
          <div className="kpi-grid">
            <div className="kpi-card blue">
              <div className="kpi-label">Total Loads</div>
              <div className="kpi-value">{fmt(totalLoads)}</div>
              <ChangeArrow current={totalLoads} prev={prevLoads} />
              {prevLoads && <div className="kpi-prev">Prior week: {fmt(prevLoads)}</div>}
            </div>
            <div className="kpi-card green">
              <div className="kpi-label">Total Miles</div>
              <div className="kpi-value">{fmt(totalMiles)}</div>
              <ChangeArrow current={totalMiles} prev={prevMiles} />
              {prevMiles && <div className="kpi-prev">Prior week: {fmt(prevMiles)}</div>}
            </div>
            <div className="kpi-card amber">
              <div className="kpi-label">Gross Revenue</div>
              <div className="kpi-value">{revenue > 0 ? fmtMoney(revenue) : '—'}</div>
              <ChangeArrow current={grossRevenue} prev={prevRevenue} />
              {prevRevenue && <div className="kpi-prev">Prior week: {fmtMoney(prevRevenue)}</div>}
            </div>
            <div className="kpi-card purple">
              <div className="kpi-label">Net Profit</div>
              <div className="kpi-value" style={{ color: netProfit >= 0 ? 'var(--green-700)' : 'var(--red-700)' }}>
                {revenue > 0 ? fmtMoney(netProfit) : '—'}
              </div>
              <ChangeArrow current={netProfit} prev={prevNetProfit} />
              {prevNetProfit && <div className="kpi-prev">Prior week: {fmtMoney(prevNetProfit)}</div>}
            </div>
          </div>

          {/* Operations Summary */}
          <div className="report-section">
            <div className="section-heading">
              <div className="section-icon navy"><Route size={14} /></div>
              <div className="section-title">Operations Summary</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              {[
                { label: 'Revenue / Mile', value: revenuePerMile > 0 ? `$${revenuePerMile}` : '—', icon: DollarSign },
                { label: 'Avg Miles / Load', value: avgMilesPerLoad > 0 ? fmt(avgMilesPerLoad) : '—', icon: Package },
                { label: 'Deadhead %', value: num(deadheadMiles) > 0 ? `${deadheadPct}%` : '—', icon: Route },
                { label: 'Fuel Economy', value: mpg > 0 ? `${mpg} MPG` : '—', icon: Fuel },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Icon size={14} color="var(--text-faint)" />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Summary */}
          <div className="report-section">
            <div className="section-heading">
              <div className="section-icon green"><DollarSign size={14} /></div>
              <div className="section-title">Financial Summary</div>
            </div>

            <div className="financial-grid">
              <div className="fin-panel">
                <div className="fin-panel-header">Revenue</div>
                <div className="fin-row">
                  <span className="fin-row-label">Gross Revenue</span>
                  <span className="fin-row-value">{fmtMoney(grossRevenue)}</span>
                </div>
                <div className="fin-row total">
                  <span className="fin-row-label">Total Revenue</span>
                  <span className="fin-row-value">{fmtMoney(grossRevenue)}</span>
                </div>
              </div>

              <div className="fin-panel">
                <div className="fin-panel-header">Expenses</div>
                {[
                  { label: 'Fuel', val: fuelCost },
                  { label: 'Driver Pay', val: driverPay },
                  { label: 'Maintenance', val: maintenance },
                  { label: 'Insurance', val: insurance },
                  { label: 'Tolls & Fees', val: tolls },
                  { label: 'Other', val: otherExpenses },
                ].filter(x => num(x.val) > 0).map(({ label, val }) => (
                  <div className="fin-row" key={label}>
                    <span className="fin-row-label">{label}</span>
                    <span className="fin-row-value expense">{fmtMoney(val)}</span>
                  </div>
                ))}
                <div className="fin-row total">
                  <span className="fin-row-label">Total Expenses</span>
                  <span className="fin-row-value expense">{fmtMoney(totalExpenses)}</span>
                </div>
              </div>
            </div>

            {/* Expense Breakdown Bar */}
            {totalExpenses > 0 && revenue > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Expense Breakdown (% of Revenue)
                </div>
                <ExpenseBar items={[
                  { label: 'Fuel', val: num(fuelCost), color: '#f59e0b' },
                  { label: 'Driver Pay', val: num(driverPay), color: '#3b82f6' },
                  { label: 'Maintenance', val: num(maintenance), color: '#8b5cf6' },
                  { label: 'Insurance', val: num(insurance), color: '#10b981' },
                  { label: 'Tolls', val: num(tolls), color: '#ec4899' },
                  { label: 'Other', val: num(otherExpenses), color: '#94a3b8' },
                ].filter(x => x.val > 0)} total={revenue} />
              </div>
            )}

            {/* Net Profit Box */}
            <div className="net-profit-box">
              <div>
                <div className="net-profit-label">Weekly Net Profit</div>
                <div className={`net-profit-value ${netProfit >= 0 ? 'positive' : 'negative'}`}>
                  {fmtMoney(netProfit)}
                </div>
              </div>
              <div className="net-profit-meta">
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>Profit Margin</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: netProfit >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                  {profitMargin}%
                </div>
                {num(totalMiles) > 0 && (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
                    Cost/mi: ${costPerMile}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Driver Performance */}
          {sortedDrivers.length > 0 && (
            <div className="report-section">
              <div className="section-heading">
                <div className="section-icon amber"><Users size={14} /></div>
                <div className="section-title">Driver Performance</div>
              </div>

              <table className="drivers-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th style={{ textAlign: 'right' }}>Loads</th>
                    <th style={{ textAlign: 'right' }}>Miles</th>
                    <th style={{ textAlign: 'right' }}>Revenue</th>
                    <th style={{ textAlign: 'right' }}>Rev/Mile</th>
                    <th style={{ textAlign: 'center' }}>Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDrivers.map((driver, i) => {
                    const dRevPerMile = num(driver.miles) > 0
                      ? (num(driver.revenue) / num(driver.miles)).toFixed(2)
                      : '—'
                    const perf = getPerf(driver.revenue, avgDriverRevenue)
                    const initials = driver.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                    return (
                      <tr key={i}>
                        <td>
                          <div className="driver-name-cell">
                            <div className="driver-avatar">{initials}</div>
                            <div>
                              <div className="driver-name-text">{driver.name}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(driver.loads)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(driver.miles)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {num(driver.revenue) > 0 ? fmtMoney(driver.revenue) : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {dRevPerMile !== '—' ? `$${dRevPerMile}` : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`perf-badge ${perf}`}>{getPerfLabel(perf)}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {sortedDrivers.length > 1 && (
                  <tfoot>
                    <tr style={{ backgroundColor: 'var(--surface-2)' }}>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Fleet Total</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        {fmt(sortedDrivers.reduce((s, d) => s + num(d.loads), 0))}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        {fmt(sortedDrivers.reduce((s, d) => s + num(d.miles), 0))}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {fmtMoney(totalDriverRevenue)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Notes */}
          {notes && notes.trim() && (
            <div className="report-section">
              <div className="section-heading">
                <div className="section-icon navy"><StickyNote size={14} /></div>
                <div className="section-title">Operational Notes</div>
              </div>
              <div className="notes-content">{notes}</div>
            </div>
          )}

          {/* Footer */}
          <div style={{
            padding: '16px 40px',
            background: 'var(--surface-2)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
              FleetReport Pro — Confidential
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
              Generated {today} {reportedBy ? `· ${reportedBy}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExpenseBar({ items, total }) {
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1 }}>
        {items.map(item => (
          <div
            key={item.label}
            style={{
              width: `${(item.val / total * 100).toFixed(1)}%`,
              background: item.color,
              minWidth: item.val > 0 ? 3 : 0,
              transition: 'width 0.3s ease',
            }}
            title={`${item.label}: ${(item.val / total * 100).toFixed(1)}%`}
          />
        ))}
        {/* remaining profit */}
        {total > items.reduce((s, i) => s + i.val, 0) && (
          <div style={{
            flex: 1,
            background: 'var(--green-100)',
            minWidth: 3,
          }} title="Net Profit" />
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
        {items.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
            {item.label}: {(item.val / total * 100).toFixed(1)}%
          </div>
        ))}
        {total > items.reduce((s, i) => s + i.val, 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--green-500)', flexShrink: 0 }} />
            Profit: {((total - items.reduce((s, i) => s + i.val, 0)) / total * 100).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  )
}

function buildTextReport({ formData, netProfit, profitMargin, revenuePerMile, avgMilesPerLoad, deadheadPct, mpg, costPerMile, totalExpenses, sortedDrivers }) {
  const {
    companyName, fleetName, weekStart, weekEnd, reportedBy,
    totalLoads, totalMiles, deadheadMiles, fuelStops, fuelGallons,
    grossRevenue, fuelCost, driverPay, maintenance, insurance, tolls, otherExpenses,
    notes
  } = formData

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const n = (v) => parseFloat(v) || 0
  const m = (v) => `$${n(v).toLocaleString()}`

  const lines = [
    `╔${'═'.repeat(62)}╗`,
    `║  WEEKLY PERFORMANCE REPORT${' '.repeat(35)}║`,
    `║  ${companyName || 'Company Name'}${' '.repeat(Math.max(0, 60 - (companyName || 'Company Name').length))}║`,
    `╚${'═'.repeat(62)}╝`,
    '',
    `Period:    ${weekStart ? `${weekStart} to ${weekEnd}` : 'Not specified'}`,
    `Generated: ${today}`,
    reportedBy ? `Prepared:  ${reportedBy}` : '',
    fleetName ? `Fleet:     ${fleetName}` : '',
    '',
    '─── KEY METRICS ─────────────────────────────────────',
    `  Total Loads:      ${n(totalLoads).toLocaleString()}`,
    `  Total Miles:      ${n(totalMiles).toLocaleString()}`,
    `  Deadhead Miles:   ${n(deadheadMiles).toLocaleString()} (${deadheadPct}%)`,
    `  Fuel Economy:     ${mpg} MPG`,
    `  Rev/Mile:         $${revenuePerMile}`,
    `  Avg Miles/Load:   ${n(avgMilesPerLoad).toLocaleString()}`,
    '',
    '─── FINANCIAL SUMMARY ───────────────────────────────',
    `  Gross Revenue:    ${m(grossRevenue)}`,
    `  Fuel Cost:        ${m(fuelCost)}`,
    `  Driver Pay:       ${m(driverPay)}`,
    `  Maintenance:      ${m(maintenance)}`,
    `  Insurance:        ${m(insurance)}`,
    `  Tolls & Fees:     ${m(tolls)}`,
    `  Other Expenses:   ${m(otherExpenses)}`,
    `  Total Expenses:   ${m(totalExpenses)}`,
    `  ─────────────────────────────`,
    `  NET PROFIT:       ${m(netProfit)}  (${profitMargin}% margin)`,
    `  Cost/Mile:        $${costPerMile}`,
    '',
  ]

  if (sortedDrivers.length > 0) {
    lines.push('─── DRIVER PERFORMANCE ──────────────────────────────')
    lines.push(`  ${'Driver'.padEnd(25)} ${'Loads'.padStart(6)} ${'Miles'.padStart(8)} ${'Revenue'.padStart(10)}`)
    lines.push(`  ${'─'.repeat(53)}`)
    sortedDrivers.forEach(d => {
      const rev = n(d.revenue) > 0 ? m(d.revenue) : '—'
      lines.push(`  ${(d.name || '').padEnd(25)} ${String(d.loads || '—').padStart(6)} ${String(n(d.miles).toLocaleString() || '—').padStart(8)} ${rev.padStart(10)}`)
    })
    lines.push('')
  }

  if (notes?.trim()) {
    lines.push('─── OPERATIONAL NOTES ───────────────────────────────')
    lines.push(notes)
    lines.push('')
  }

  lines.push(`Generated by FleetReport Pro · ${today}`)

  return lines.filter(l => l !== null && l !== undefined).join('\n')
}
