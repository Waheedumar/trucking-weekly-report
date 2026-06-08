import { useState } from 'react'
import {
  LayoutDashboard, Route, DollarSign, Users, StickyNote,
  Plus, Trash2, RefreshCcw, BarChart3, ChevronRight, ChevronLeft
} from 'lucide-react'

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'miles', label: 'Loads & Miles', icon: Route },
  { id: 'financial', label: 'Financial', icon: DollarSign },
  { id: 'drivers', label: 'Drivers', icon: Users },
  { id: 'notes', label: 'Notes', icon: StickyNote },
]

export default function WeeklyForm({ formData, setFormData, onGenerate, onReset }) {
  const [activeTab, setActiveTab] = useState('overview')

  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }))

  const addDriver = () => {
    setFormData(prev => ({
      ...prev,
      drivers: [...prev.drivers, { name: '', loads: '', miles: '', revenue: '' }]
    }))
  }

  const removeDriver = (i) => {
    setFormData(prev => ({
      ...prev,
      drivers: prev.drivers.filter((_, idx) => idx !== i)
    }))
  }

  const setDriver = (i, field, value) => {
    setFormData(prev => {
      const d = [...prev.drivers]
      d[i] = { ...d[i], [field]: value }
      return { ...prev, drivers: d }
    })
  }

  const tabIdx = TABS.findIndex(t => t.id === activeTab)
  const isFirst = tabIdx === 0
  const isLast = tabIdx === TABS.length - 1

  const goNext = () => { if (!isLast) setActiveTab(TABS[tabIdx + 1].id) }
  const goPrev = () => { if (!isFirst) setActiveTab(TABS[tabIdx - 1].id) }

  return (
    <div className="form-card">
      <div className="form-card-header">
        <div>
          <div className="form-card-title">Weekly Data Entry</div>
          <div className="form-card-desc">Fill in each section to generate your performance report</div>
        </div>
        <button className="btn btn-ghost" style={{ color: 'rgba(255,255,255,0.6)' }} onClick={onReset}>
          <RefreshCcw size={14} />
          Reset
        </button>
      </div>

      <div className="tabs-nav">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={14} className="tab-icon" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="form-body">
        {activeTab === 'overview' && (
          <OverviewTab formData={formData} set={set} />
        )}
        {activeTab === 'miles' && (
          <MilesTab formData={formData} set={set} />
        )}
        {activeTab === 'financial' && (
          <FinancialTab formData={formData} set={set} />
        )}
        {activeTab === 'drivers' && (
          <DriversTab
            drivers={formData.drivers}
            addDriver={addDriver}
            removeDriver={removeDriver}
            setDriver={setDriver}
          />
        )}
        {activeTab === 'notes' && (
          <NotesTab formData={formData} set={set} />
        )}
      </div>

      <div className="form-footer">
        <div className="form-footer-left">
          Step {tabIdx + 1} of {TABS.length} — {TABS[tabIdx].label}
        </div>
        <div className="form-footer-actions">
          <button className="btn btn-secondary" onClick={goPrev} disabled={isFirst}
            style={isFirst ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>
            <ChevronLeft size={15} /> Previous
          </button>
          {isLast ? (
            <button className="btn btn-primary btn-lg" onClick={onGenerate}>
              <BarChart3 size={16} />
              Generate Report
            </button>
          ) : (
            <button className="btn btn-primary" onClick={goNext}>
              Next <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ formData, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <div className="form-section-title">Company Information</div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Company Name</label>
            <input
              className="form-input"
              placeholder="e.g. Apex Freight LLC"
              value={formData.companyName}
              onChange={e => set('companyName', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Fleet / Division Name</label>
            <input
              className="form-input"
              placeholder="e.g. Southeast Division"
              value={formData.fleetName}
              onChange={e => set('fleetName', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Reported By</label>
            <input
              className="form-input"
              placeholder="Dispatcher / Manager name"
              value={formData.reportedBy}
              onChange={e => set('reportedBy', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="form-section-title">Report Period</div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Week Start Date</label>
            <input
              type="date"
              className="form-input"
              value={formData.weekStart}
              onChange={e => set('weekStart', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Week End Date</label>
            <input
              type="date"
              className="form-input"
              value={formData.weekEnd}
              onChange={e => set('weekEnd', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="form-section-title">Prior Week Benchmarks <span style={{textTransform:'none', fontSize:11, fontWeight:400, letterSpacing:0}}>(for comparison arrows)</span></div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Prior Week Loads</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 42"
              value={formData.prevLoads}
              onChange={e => set('prevLoads', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Prior Week Miles</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 14000"
              value={formData.prevMiles}
              onChange={e => set('prevMiles', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Prior Week Gross Revenue ($)</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 68000"
                value={formData.prevRevenue}
                onChange={e => set('prevRevenue', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Prior Week Net Profit ($)</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 18000"
                value={formData.prevNetProfit}
                onChange={e => set('prevNetProfit', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MilesTab({ formData, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <div className="form-section-title">Load Activity</div>
        <div className="form-grid form-grid-3">
          <div className="form-group">
            <label className="form-label">Total Loads Delivered</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 45"
              value={formData.totalLoads}
              onChange={e => set('totalLoads', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Total Miles Driven</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 15200"
              value={formData.totalMiles}
              onChange={e => set('totalMiles', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Deadhead Miles</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 1800"
              value={formData.deadheadMiles}
              onChange={e => set('deadheadMiles', e.target.value)}
            />
            <span className="form-hint">Empty / repositioning miles</span>
          </div>
        </div>
      </div>

      <div>
        <div className="form-section-title">Fuel Data</div>
        <div className="form-grid form-grid-3">
          <div className="form-group">
            <label className="form-label">Fuel Stops</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 38"
              value={formData.fuelStops}
              onChange={e => set('fuelStops', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Total Gallons Purchased</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 5200"
              value={formData.fuelGallons}
              onChange={e => set('fuelGallons', e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function FinancialTab({ formData, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <div className="form-section-title">Revenue</div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Gross Revenue</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 72500"
                value={formData.grossRevenue}
                onChange={e => set('grossRevenue', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="form-section-title">Operating Expenses</div>
        <div className="form-grid form-grid-3">
          <div className="form-group">
            <label className="form-label">Fuel Cost</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 18500"
                value={formData.fuelCost}
                onChange={e => set('fuelCost', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Driver Pay</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 22000"
                value={formData.driverPay}
                onChange={e => set('driverPay', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Maintenance & Repairs</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 3200"
                value={formData.maintenance}
                onChange={e => set('maintenance', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Insurance</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 4100"
                value={formData.insurance}
                onChange={e => set('insurance', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Tolls & Fees</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 820"
                value={formData.tolls}
                onChange={e => set('tolls', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Other Expenses</label>
            <div className="input-prefix-wrap">
              <span className="input-prefix">$</span>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 1200"
                value={formData.otherExpenses}
                onChange={e => set('otherExpenses', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DriversTab({ drivers, addDriver, removeDriver, setDriver }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="form-section-title">Driver Performance Data</div>

      <div className="drivers-list">
        {drivers.map((driver, i) => (
          <div className="driver-row" key={i}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div className="driver-row-label">Driver Name</div>
              <input
                className="form-input"
                placeholder="Full name"
                value={driver.name}
                onChange={e => setDriver(i, 'name', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div className="driver-row-label">Loads</div>
              <input
                type="number"
                className="form-input"
                placeholder="0"
                value={driver.loads}
                onChange={e => setDriver(i, 'loads', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div className="driver-row-label">Miles</div>
              <input
                type="number"
                className="form-input"
                placeholder="0"
                value={driver.miles}
                onChange={e => setDriver(i, 'miles', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div className="driver-row-label">Revenue ($)</div>
              <div className="input-prefix-wrap">
                <span className="input-prefix">$</span>
                <input
                  type="number"
                  className="form-input"
                  placeholder="0"
                  value={driver.revenue}
                  onChange={e => setDriver(i, 'revenue', e.target.value)}
                />
              </div>
            </div>
            <button
              className="btn-remove"
              onClick={() => removeDriver(i)}
              title="Remove driver"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button className="btn-add-driver" onClick={addDriver}>
        <Plus size={15} />
        Add Driver
      </button>
    </div>
  )
}

function NotesTab({ formData, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="form-section-title">Operational Notes & Observations</div>
      <div className="form-group">
        <label className="form-label">Weekly Notes</label>
        <textarea
          className="form-textarea"
          placeholder="Enter any operational notes, highlights, challenges, safety incidents, equipment issues, or management commentary for this week..."
          value={formData.notes}
          onChange={e => set('notes', e.target.value)}
          style={{ minHeight: 200 }}
        />
        <span className="form-hint">These notes will appear in the final report under the Operational Notes section.</span>
      </div>
    </div>
  )
}
