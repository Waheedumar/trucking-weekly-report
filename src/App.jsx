import { useState } from 'react'
import { Truck, FileText } from 'lucide-react'
import './App.css'
import WeeklyForm from './components/WeeklyForm'
import WeeklyReport from './components/WeeklyReport'

const defaultFormData = {
  // Overview
  companyName: '',
  fleetName: '',
  weekStart: '',
  weekEnd: '',
  reportedBy: '',
  // Loads & Miles
  totalLoads: '',
  totalMiles: '',
  deadheadMiles: '',
  avgMilesPerLoad: '',
  fuelStops: '',
  fuelGallons: '',
  // Financial
  grossRevenue: '',
  fuelCost: '',
  driverPay: '',
  maintenance: '',
  insurance: '',
  tolls: '',
  otherExpenses: '',
  // Prior week comparisons
  prevLoads: '',
  prevMiles: '',
  prevRevenue: '',
  prevNetProfit: '',
  // Drivers
  drivers: [
    { name: '', loads: '', miles: '', revenue: '' }
  ],
  // Notes
  notes: '',
}

function App() {
  const [view, setView] = useState('form')
  const [formData, setFormData] = useState(defaultFormData)
  const [reportGenerated, setReportGenerated] = useState(false)

  const handleGenerate = () => {
    setReportGenerated(true)
    setView('report')
  }

  const handleReset = () => {
    if (window.confirm('Reset all form data? This cannot be undone.')) {
      setFormData(defaultFormData)
      setReportGenerated(false)
      setView('form')
    }
  }

  return (
    <div className="app">
      <nav className="topnav no-print">
        <div className="topnav-brand">
          <div className="topnav-icon">
            <Truck size={18} color="white" />
          </div>
          <div>
            <div className="topnav-title">FleetReport Pro</div>
            <div className="topnav-subtitle">Weekly Performance Analytics</div>
          </div>
        </div>
        <div className="topnav-actions">
          <span className="nav-badge">v2.1</span>
        </div>
      </nav>

      <div className="page-container">
        <div className="view-toggle no-print">
          <button
            className={`view-btn ${view === 'form' ? 'active' : ''}`}
            onClick={() => setView('form')}
          >
            <FileText size={15} />
            Enter Data
          </button>
          <div className="view-divider" />
          <button
            className={`view-btn ${view === 'report' ? 'active' : ''}`}
            onClick={() => setView('report')}
          >
            <Truck size={15} />
            View Report
          </button>
        </div>

        {view === 'form' ? (
          <WeeklyForm
            formData={formData}
            setFormData={setFormData}
            onGenerate={handleGenerate}
            onReset={handleReset}
          />
        ) : (
          <WeeklyReport
            formData={formData}
            reportGenerated={reportGenerated}
            onBack={() => setView('form')}
          />
        )}
      </div>
    </div>
  )
}

export default App
