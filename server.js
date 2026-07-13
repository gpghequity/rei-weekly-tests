import express from 'express'
import cron from 'node-cron'
import axios from 'axios'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// In-memory test results
let testResults = []
let lastTestRun = null
let testStatus = 'idle' // idle, running, completed, failed

// Sample test properties (real market data)
const SAMPLE_PROPERTIES = [
  {
    address: '123 Main St, Lancaster PA 17601',
    assetType: 'commercial',
    askingPrice: 700000,
    grossIncome: 200000,
    sellerExpenses: 80000,
    name: 'Commercial Storage'
  },
  {
    address: '456 Oak Ave, Philadelphia PA 19103',
    assetType: 'residential',
    askingPrice: 450000,
    grossIncome: 42000,
    name: 'SFR Rental'
  },
  {
    address: '789 Park Ln, Greenville SC 29601',
    assetType: 'mhp',
    askingPrice: 2500000,
    grossIncome: 420000,
    sellerExpenses: 140000,
    name: 'Mobile Home Park'
  },
  {
    address: '321 Storage Way, Denver CO 80202',
    assetType: 'storage',
    askingPrice: 1200000,
    grossIncome: 180000,
    sellerExpenses: 60000,
    name: 'Self-Storage Facility'
  },
  {
    address: '654 Lot Blvd, Austin TX 78701',
    assetType: 'land',
    askingPrice: 3000000,
    grossIncome: 150000,
    name: 'Development Land'
  }
]

// Health check endpoint
app.get('/ok', (req, res) => {
  res.json({
    status: 'ok',
    service: 'rei-weekly-tests',
    uptime: process.uptime(),
    lastTestRun: lastTestRun ? new Date(lastTestRun).toISOString() : 'never',
    testCount: testResults.length,
    currentStatus: testStatus
  })
})

// Get all test results
app.get('/api/results', (req, res) => {
  res.json({
    results: testResults,
    lastRun: lastTestRun,
    status: testStatus,
    count: testResults.length
  })
})

// Get latest test results
app.get('/api/latest', (req, res) => {
  const latest = testResults[testResults.length - 1] || null
  res.json(latest)
})

// Trigger manual test run
app.post('/api/test-now', async (req, res) => {
  if (testStatus === 'running') {
    return res.status(409).json({ error: 'Tests already running' })
  }

  const result = await runTests()
  res.json({
    status: 'completed',
    result
  })
})

// Run tests against Baby Analyzer (via HTTP API)
async function runTests() {
  testStatus = 'running'
  lastTestRun = Date.now()

  const results = {
    timestamp: new Date().toISOString(),
    duration: 0,
    properties: [],
    summary: {
      total: SAMPLE_PROPERTIES.length,
      passed: 0,
      failed: 0,
      errors: []
    }
  }

  const startTime = Date.now()
  const BABY_ANALYZER_URL = process.env.BABY_ANALYZER_URL || 'https://rei-baby-analyzer-production.up.railway.app/api/analyze'

  for (const prop of SAMPLE_PROPERTIES) {
    try {
      const response = await axios.post(BABY_ANALYZER_URL, prop, { timeout: 10000 })

      if (response.data?.success) {
        results.properties.push({
          name: prop.name,
          address: prop.address,
          status: 'PASS',
          bibleNoi: response.data.bibleNoi,
          scenarios: response.data.scenarios?.length || 0,
          sections: Object.keys(response.data.teamAnalysis || {}).length,
          timestamp: new Date().toISOString()
        })
        results.summary.passed++
      } else if (response.data?.error) {
        results.properties.push({
          name: prop.name,
          address: prop.address,
          status: 'FAIL',
          error: response.data.error,
          timestamp: new Date().toISOString()
        })
        results.summary.failed++
        results.summary.errors.push(`${prop.name}: ${response.data.error}`)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (error) {
      results.properties.push({
        name: prop.name,
        address: prop.address,
        status: 'ERROR',
        error: error.message,
        timestamp: new Date().toISOString()
      })
      results.summary.failed++
      results.summary.errors.push(`${prop.name}: ${error.message}`)
    }
  }

  results.duration = Date.now() - startTime

  testResults.push(results)

  // Keep only last 52 weeks
  if (testResults.length > 52) {
    testResults = testResults.slice(-52)
  }

  testStatus = results.summary.failed === 0 ? 'completed' : 'completed_with_errors'

  // Log result
  console.log(`\n${'='.repeat(60)}`)
  console.log(`TEST RUN: ${results.timestamp}`)
  console.log(`${'='.repeat(60)}`)
  console.log(`Status: ${testStatus}`)
  console.log(`Passed: ${results.summary.passed}/${results.summary.total}`)
  console.log(`Failed: ${results.summary.failed}/${results.summary.total}`)
  console.log(`Duration: ${results.duration}ms`)

  if (results.summary.errors.length > 0) {
    console.log('\n❌ ERRORS:')
    results.summary.errors.forEach(err => console.log(`  - ${err}`))
  } else {
    console.log('\n✅ ALL TESTS PASSED')
  }

  console.log(`${'='.repeat(60)}\n`)

  return results
}

// Schedule tests for Monday 1AM UTC
// Cron: minute hour dayOfMonth month dayOfWeek (0 = Sunday, 1 = Monday)
// 0 1 * * 1 = every Monday at 1:00 AM UTC
cron.schedule('0 1 * * 1', async () => {
  console.log('\n🔔 [SCHEDULED] Running weekly tests (Monday 1AM)...')
  await runTests()
}, {
  timezone: 'UTC'
})

// Log when cron is scheduled
console.log('✅ Cron job scheduled: Every Monday at 1:00 AM UTC')

// Serve dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>REI Baby Analyzer - Weekly Test Runner</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .header p { font-size: 1.1em; opacity: 0.9; }
    .content { padding: 40px; }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .status-card {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      border-radius: 8px;
    }
    .status-card.success { border-left-color: #10b981; }
    .status-card.error { border-left-color: #ef4444; }
    .status-card.pending { border-left-color: #f59e0b; }
    .status-card label {
      font-size: 0.85em;
      color: #666;
      text-transform: uppercase;
      font-weight: 600;
      display: block;
      margin-bottom: 8px;
    }
    .status-card .value {
      font-size: 2em;
      font-weight: 700;
      color: #1f2937;
    }
    .status-card .meta {
      font-size: 0.9em;
      color: #999;
      margin-top: 8px;
    }
    .button-group {
      display: flex;
      gap: 10px;
      margin-bottom: 40px;
    }
    button {
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 1em;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    .btn-primary {
      background: #667eea;
      color: white;
    }
    .btn-primary:hover { background: #5568d3; }
    .btn-secondary {
      background: #f0f0f0;
      color: #333;
    }
    .btn-secondary:hover { background: #e0e0e0; }
    .results-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    .results-table thead {
      background: #f8f9fa;
      border-bottom: 2px solid #e5e7eb;
    }
    .results-table th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #374151;
    }
    .results-table td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    .results-table tbody tr:hover { background: #f9fafb; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .badge.pass { background: #d1fae5; color: #065f46; }
    .badge.fail { background: #fee2e2; color: #991b1b; }
    .badge.error { background: #fef2f2; color: #7f1d1d; }
    .load-more {
      text-align: center;
      margin-top: 20px;
    }
    .spinner {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid #f0f0f0;
      border-radius: 50%;
      border-top-color: #667eea;
      animation: spin 0.8s linear infinite;
      margin-right: 10px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .timestamp {
      font-size: 0.9em;
      color: #999;
    }
    .section-title {
      font-size: 1.5em;
      font-weight: 700;
      margin-bottom: 20px;
      color: #1f2937;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧪 Baby Analyzer Weekly Test Runner</h1>
      <p>Automated quality assurance • Every Monday 1AM UTC</p>
    </div>

    <div class="content">
      <!-- Status Cards -->
      <div class="status-grid">
        <div class="status-card">
          <label>Current Status</label>
          <div class="value" id="statusValue">Idle</div>
          <div class="meta" id="statusMeta">Ready</div>
        </div>
        <div class="status-card">
          <label>Last Test Run</label>
          <div class="value" id="lastRunValue">Never</div>
          <div class="meta" id="lastRunMeta">-</div>
        </div>
        <div class="status-card">
          <label>Total Runs</label>
          <div class="value" id="totalRunsValue">0</div>
          <div class="meta" id="totalRunsMeta">52 week history</div>
        </div>
        <div class="status-card">
          <label>Pass Rate</label>
          <div class="value" id="passRateValue">-</div>
          <div class="meta" id="passRateMeta">Last run</div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="button-group">
        <button class="btn-primary" onclick="runTestNow()" id="testBtn">
          ▶️ Run Tests Now
        </button>
        <button class="btn-secondary" onclick="location.reload()">
          🔄 Refresh
        </button>
      </div>

      <!-- Latest Results Section -->
      <div id="latestSection" style="display:none;">
        <div class="section-title">Latest Test Run Results</div>
        <table class="results-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Asset Type</th>
              <th>Status</th>
              <th>Bible NOI</th>
              <th>Scenarios</th>
              <th>Sections</th>
            </tr>
          </thead>
          <tbody id="latestResults">
          </tbody>
        </table>
      </div>

      <!-- Historical Results Section -->
      <div id="historySection" style="display:none; margin-top: 40px;">
        <div class="section-title">Test History (Last 52 Weeks)</div>
        <table class="results-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="historyResults">
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    async function loadStatus() {
      try {
        const response = await fetch('/api/results')
        const data = await response.json()

        document.getElementById('totalRunsValue').textContent = data.count
        document.getElementById('statusValue').textContent = data.status.toUpperCase()

        if (data.lastRun) {
          const date = new Date(data.lastRun)
          document.getElementById('lastRunValue').textContent = date.toLocaleDateString()
          document.getElementById('lastRunMeta').textContent = date.toLocaleTimeString()
        }

        // Display latest results
        if (data.results.length > 0) {
          const latest = data.results[data.results.length - 1]

          // Pass rate
          const passRate = (latest.summary.passed / latest.summary.total * 100).toFixed(0)
          document.getElementById('passRateValue').textContent = passRate + '%'
          document.getElementById('passRateMeta').textContent = latest.summary.passed + '/' + latest.summary.total + ' passed'

          // Display latest results table
          const latestBody = document.getElementById('latestResults')
          latestBody.innerHTML = ''
          latest.properties.forEach(prop => {
            const statusBadge = prop.status === 'PASS'
              ? \`<span class="badge pass">\${prop.status}</span>\`
              : \`<span class="badge fail">\${prop.status}</span>\`

            latestBody.innerHTML += \`
              <tr>
                <td><strong>\${prop.name}</strong></td>
                <td>\${prop.address.split(',')[1]?.trim() || 'N/A'}</td>
                <td>\${statusBadge}</td>
                <td>\${prop.status === 'PASS' ? '$' + (prop.bibleNoi || 0).toLocaleString() : '-'}</td>
                <td>\${prop.scenarios || '-'}</td>
                <td>\${prop.sections || '-'}</td>
              </tr>
            \`
          })
          document.getElementById('latestSection').style.display = 'block'

          // Display history
          const historyBody = document.getElementById('historyResults')
          historyBody.innerHTML = ''
          data.results.reverse().slice(0, 10).forEach(result => {
            const date = new Date(result.timestamp)
            historyBody.innerHTML += \`
              <tr>
                <td>\${date.toLocaleDateString()} \${date.toLocaleTimeString()}</td>
                <td><strong>\${result.summary.passed}</strong></td>
                <td>\${result.summary.failed}</td>
                <td>\${result.duration}ms</td>
                <td>\${result.summary.failed === 0 ? '✅ PASS' : '❌ FAIL'}</td>
              </tr>
            \`
          })
          document.getElementById('historySection').style.display = 'block'
        }
      } catch (error) {
        console.error('Error loading status:', error)
      }
    }

    async function runTestNow() {
      const btn = document.getElementById('testBtn')
      btn.disabled = true
      btn.innerHTML = '<span class="spinner"></span> Running tests...'

      try {
        const response = await fetch('/api/test-now', { method: 'POST' })
        const data = await response.json()

        if (response.ok) {
          setTimeout(loadStatus, 1000)
        } else {
          alert('Error: ' + data.error)
        }
      } catch (error) {
        alert('Failed to run tests: ' + error.message)
      } finally {
        btn.disabled = false
        btn.innerHTML = '▶️ Run Tests Now'
      }
    }

    // Load status on page load and every 10 seconds
    loadStatus()
    setInterval(loadStatus, 10000)
  </script>
</body>
</html>
  `)
})

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🚀 REI Weekly Test Runner LIVE`)
  console.log(`${'='.repeat(60)}`)
  console.log(`Port: ${PORT}`)
  console.log(`Dashboard: http://localhost:${PORT}/`)
  console.log(`Test Schedule: Every Monday 1:00 AM UTC`)
  console.log(`Properties: ${SAMPLE_PROPERTIES.length}`)
  console.log(`API: /api/results, /api/latest, /api/test-now`)
  console.log(`${'='.repeat(60)}\n`)
})
