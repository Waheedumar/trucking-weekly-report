require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { Resend } = require('resend');

const JWT_SECRET = process.env.JWT_SECRET || 'trucktrack_jwt_secret_change_in_production';

let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return supabaseClient;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

let resendClient = null;
function getResend() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const REPORT_SYSTEM_PROMPT = `You are an expert trucking business analyst. You analyze weekly performance data for trucking companies and write professional, insightful reports.

When given weekly trucking data, generate a complete professional weekly performance report.

The report must include:

1. EXECUTIVE SUMMARY (3-4 sentences)
- Lead with the biggest win or most important insight
- Mention revenue performance vs last week
- Mention on-time delivery rate
- End with one forward-looking statement

2. KEY METRICS (formatted table)
- Loads completed (this week vs last week, % change with ▲ or ▼)
- Total miles (this week vs last week, % change)
- Gross revenue (this week vs last week, % change)
- Revenue per mile
- On-time delivery rate
- Fuel cost per mile

3. WHAT WORKED THIS WEEK (2-3 bullet points)
- Be specific with numbers
- Highlight genuine wins
- Reference specific metrics

4. WHAT NEEDS ATTENTION (2-3 bullet points)
- Flag underperforming areas
- Always include a recommended action for each issue
- Be constructive not negative

5. FINANCIAL SUMMARY
- Gross Revenue
- Total Expenses breakdown (fuel, maintenance, tolls, other)
- Net Profit
- Profit Margin %
- Cost Per Mile

6. DRIVER PERFORMANCE
- Active drivers
- Top performer highlight
- Any issues noted

7. PLAN FOR NEXT WEEK (3-4 bullet points)
- Specific actionable targets
- Based on this week's data

TONE: Professional, data-driven, clear. Sound like a trusted advisor not a robot. Use plain language. Lead with insights not just numbers.

RULES:
- Always explain WHY a metric changed, not just that it changed
- Never make up data not provided
- Flag anything that needs urgent attention
- Keep executive summary scannable`;

app.post('/api/generate-report', async (req, res) => {
  const { data } = req.body;

  const prompt = `Generate a professional weekly performance report for this trucking company data:

COMPANY INFO:
Company: ${data.companyName}
Client/Shipper: ${data.clientName}
Week: ${data.weekStart} to ${data.weekEnd}
Active Drivers: ${data.activeDrivers}

LOADS & DELIVERIES:
Total Loads This Week: ${data.totalLoads}
Total Loads Last Week: ${data.loadsLastWeek}
On-Time Deliveries: ${data.onTimeDeliveries}
Late Deliveries: ${data.lateDeliveries}

MILES:
Total Miles This Week: ${data.totalMiles}
Total Miles Last Week: ${data.milesLastWeek}
Deadhead Miles: ${data.deadheadMiles || 'Not provided'}

REVENUE & RATES:
Gross Revenue This Week: $${data.totalRevenue}
Gross Revenue Last Week: $${data.revenueLastWeek}
Rate Per Mile: $${data.ratePerMile || 'Calculate from data'}

FUEL:
Total Fuel Cost: $${data.totalFuelCost}
Fuel Cost Last Week: $${data.fuelLastWeek}
Gallons Used: ${data.fuelGallons || 'Not provided'}

EXPENSES:
Maintenance: $${data.maintenance || 0}
Tolls: $${data.tolls || 0}
Insurance: $${data.insurance || 0}
Other: $${data.otherExpenses || 0}

DRIVER PERFORMANCE:
Top Driver: ${data.topDriver || 'Not specified'}
Driver Issues: ${data.driverIssues || 'None'}

OPERATIONAL NOTES:
Highlights: ${data.highlights || 'None provided'}
Issues: ${data.issues || 'None provided'}
Next Week Plan: ${data.nextWeekPlan || 'Not provided'}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json({ report: response.content[0].text });
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'Failed to generate report. Please try again.' });
  }
});

const PORT = process.env.PORT || 3002;

// Rate Con Parser
app.post('/api/parse-ratecon', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a rate confirmation parser for a trucking company. Extract structured load data and return ONLY valid JSON with no explanation, no markdown, no backticks:
{"broker":{"name":"","contact_name":null,"email":null,"phone":null,"mc_number":null},"load":{"reference_number":null,"load_type":null,"commodity":null,"weight":null},"pickup":{"company":null,"address":null,"city":"","state":"","zip":null,"date":null,"time":null,"notes":null},"delivery":{"company":null,"address":null,"city":"","state":"","zip":null,"date":null,"time":null,"notes":null},"rate":{"total":0,"per_mile":0,"estimated_miles":0,"currency":"USD","fuel_surcharge":0,"payment_terms":null},"confidence":"high/medium/low","missing_fields":[],"raw_notes":null}
If a field is not found use null. Dates must be YYYY-MM-DD. Rates must be numbers only.`,
      messages: [{ role: 'user', content: `Extract load data from this rate confirmation:\n\n${text}` }]
    });
    const raw = response.content[0].text;
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('Rate con parser error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });
    const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    if (profileError || !profile) return res.status(404).json({ error: 'User profile not found' });
    const token = jwt.sign(
      { id: profile.id, email: profile.email, name: profile.full_name, role: profile.role, company: profile.company_name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: profile.id, email: profile.email, name: profile.full_name, role: profile.role, company: profile.company_name } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Loads
app.post('/api/loads', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { origin, destination, pickup_date, delivery_date, commodity, weight, rate, carrier, notes, broker } = req.body;
    if (!origin || !destination || !pickup_date) return res.status(400).json({ error: 'origin, destination, and pickup_date are required' });
    const { data, error } = await supabase.from('loads').insert({
      dispatcher_id: req.user.id,
      origin, destination, pickup_date,
      delivery_date: delivery_date || null,
      commodity: commodity || null,
      weight: weight || null,
      rate: rate || null,
      carrier: carrier || null,
      notes: notes || null,
    }).select('*').single();
    if (error) return res.status(500).json({ error: 'Failed to create load', detail: error.message });
    res.status(201).json({ load: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/loads', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('loads').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch loads' });
    res.json({ loads: data });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PAYROLL ROUTES
// ============================================================

// FIX 1: Updated prompt to extract loadsPerDriver per driver
const PAYROLL_VISION_PROMPT = `You are a trucking payroll document analyst. You are given Amazon Relay drop-off history and/or invoice documents.

Extract the following and return ONLY valid JSON with no explanation, no markdown, no backticks:
{
  "driverNames": ["string"],
  "loadsPerDriver": {"Driver Name": 3, "Driver Name 2": 2},
  "loadsCompleted": 0,
  "invoiceTotal": 0,
  "notes": "string or null"
}

RULES:
- driverNames: every distinct driver name found in the documents
- loadsPerDriver: exact number of loads/blocks each specific driver completed — key is driver name, value is count. Count how many rows each driver appears in.
- loadsCompleted: total loads across all drivers
- invoiceTotal: grand total dollar amount as number only, no symbols. 0 if not found.
- Never invent data. Use 0, {}, or [] when absent.`;

function fileToContentBlock(file) {
  const mediaType = file.mimetype;
  const data = file.buffer.toString('base64');
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

function parseJsonArray(value, fieldName) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch (err) {
    throw new Error(`${fieldName} must be a valid JSON array`);
  }
}

// 1. Process payroll
app.post('/api/process-payroll', upload.fields([{name:'file1',maxCount:1},{name:'file2',maxCount:1},{name:'files',maxCount:2}]), async (req, res) => {
  try {
    const files = [...(req.files?.file1||[]), ...(req.files?.file2||[]), ...(req.files?.files||[])];

    const { companyName, weekStart, weekEnd, grossAmount } = req.body;
    let drivers, deductions;
    try {
      drivers = parseJsonArray(req.body.drivers, 'drivers');
      deductions = parseJsonArray(req.body.deductions, 'deductions');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let extracted = { driverNames: [], loadsPerDriver: {}, loadsCompleted: 0, invoiceTotal: 0, notes: 'No files provided' };
    let filesReadSuccessfully = false;

    if (files.length > 0) {
      try {
        const content = [
          { type: 'text', text: 'Analyze the attached trucking document(s) and extract the payroll data as instructed.' },
          ...files.map(fileToContentBlock),
        ];

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: PAYROLL_VISION_PROMPT,
          messages: [{ role: 'user', content }],
        });

        const raw = response.content[0].text;
        extracted = JSON.parse(raw.replace(/```json|```/g, '').trim());
        filesReadSuccessfully = true;
      } catch (e) {
        console.error('Vision extraction error:', e);
        extracted.notes = 'File read failed, using manual values';
      }
    }

    const supplied = (drivers || [])
      .map((d) => (typeof d === 'string' ? d : d && d.name))
      .filter(Boolean);
    const driverNames = supplied.length > 0 ? supplied : (extracted.driverNames || []);

    if (driverNames.length === 0) {
      return res.status(400).json({ error: 'No drivers found in request or documents' });
    }

    const gross = grossAmount !== undefined && grossAmount !== '' && Number(grossAmount) > 0
      ? Number(grossAmount)
      : Number(extracted.invoiceTotal || 0);

    if (!gross || gross <= 0) {
      return res.status(400).json({ error: 'A valid gross amount is required (provided or extracted)' });
    }

    const grossPerDriver = gross;

    const normalizedDeductions = (deductions || []).map((d) => ({
      label: d.label || d.name || 'Deduction',
      amount: Number(d.amount) || 0,
      perDriver: d.perDriver !== false,
    }));

    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    const statements = driverNames.map((name) => {
      const driverDeductions = normalizedDeductions.map((d) => ({
        label: d.label,
        amount: round2(d.amount),
      }));
      const totalDeductions = driverDeductions.reduce((sum, d) => sum + d.amount, 0);
      const netPay = round2(grossPerDriver - totalDeductions);
      return {
        driver: name,
        gross: round2(grossPerDriver),
        // FIX 2: Use loadsPerDriver from extracted data by driver name
        loadsCompleted: extracted.loadsPerDriver?.[name] || 0,
        deductions: driverDeductions,
        totalDeductions: round2(totalDeductions),
        netPay,
      };
    });

    res.json({
      company: companyName || null,
      period: { weekStart: weekStart || null, weekEnd: weekEnd || null },
      extracted,
      filesReadSuccessfully,
      gross: round2(gross),
      grossPerDriver: round2(grossPerDriver),
      driverCount: driverNames.length,
      statements,
      totalNet: round2(statements.reduce((s, st) => s + st.netPay, 0)),
    });
  } catch (error) {
    console.error('Process payroll error:', error);
    res.status(500).json({ error: 'Failed to process payroll' });
  }
});

function buildPayrollEmailHtml(payroll) {
  const company = payroll.company || payroll.companyName || 'Trucking Company';
  const period = payroll.period || {};
  const statements = payroll.statements || payroll.drivers || [];
  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

  const rows = statements.map((s) => {
    const name = s.driver || s.name;
    const dedLines = (s.deductions || [])
      .map((d) => `${d.label}: ${fmt(d.amount)}`)
      .join('<br/>') || '—';
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #1E1E2E;color:#E8E8F0;">${name}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #1E1E2E;color:#E8E8F0;text-align:right;">${fmt(s.gross)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #1E1E2E;color:#6B6B80;font-size:12px;">${dedLines}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #1E1E2E;color:#6B6B80;text-align:right;">${fmt(s.totalDeductions)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #1E1E2E;color:#F59E0B;font-weight:700;text-align:right;">${fmt(s.netPay)}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0D0A08;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:32px 24px;">
    <h1 style="color:#F59E0B;font-size:24px;margin:0 0 4px;">${company}</h1>
    <p style="color:#6B6B80;font-size:14px;margin:0 0 24px;">
      Weekly Payroll${period.weekStart ? ` — ${period.weekStart}` : ''}${period.weekEnd ? ` to ${period.weekEnd}` : ''}
    </p>
    <table style="width:100%;border-collapse:collapse;background:#1A1208;border:1px solid #1E1E2E;border-radius:12px;overflow:hidden;">
      <thead>
        <tr style="background:#0D0A08;">
          <th style="padding:12px 16px;text-align:left;color:#FDE68A;font-size:12px;text-transform:uppercase;">Driver</th>
          <th style="padding:12px 16px;text-align:right;color:#FDE68A;font-size:12px;text-transform:uppercase;">Gross</th>
          <th style="padding:12px 16px;text-align:left;color:#FDE68A;font-size:12px;text-transform:uppercase;">Deductions</th>
          <th style="padding:12px 16px;text-align:right;color:#FDE68A;font-size:12px;text-transform:uppercase;">Total Ded.</th>
          <th style="padding:12px 16px;text-align:right;color:#FDE68A;font-size:12px;text-transform:uppercase;">Net Pay</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#6B6B80;font-size:13px;margin-top:24px;">
      Total Net Payroll: <span style="color:#F59E0B;font-weight:700;">${fmt(payroll.totalNet)}</span>
      &nbsp;•&nbsp; ${statements.length} driver(s)
    </p>
  </div>
</body>
</html>`;
}

// 2. Send report
app.post('/api/send-report', async (req, res) => {
  try {
    const { payroll, email, data: dataField } = req.body;
    const payrollData = payroll || dataField;
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!payrollData) return res.status(400).json({ error: 'payroll data is required' });

    const company = payrollData.company || payrollData.companyName || 'Trucking Company';
    const fromAddress = process.env.RESEND_FROM_EMAIL || 'Payroll <onboarding@resend.dev>';

    const { data, error } = await getResend().emails.send({
      from: fromAddress,
      to: [email],
      subject: `Weekly Payroll Report — ${company}`,
      html: buildPayrollEmailHtml(payrollData),
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(502).json({ error: 'Failed to send email', detail: error.message });
    }

    res.json({ success: true, sent: true, id: data && data.id });
  } catch (error) {
    console.error('Send report error:', error);
    res.status(500).json({ error: 'Failed to send report' });
  }
});

// 3. Download PDF
app.post('/api/download-pdf', (req, res) => {
  try {
    const { payroll, data: dataField } = req.body;
    const payrollData = payroll || dataField;
    if (!payrollData) return res.status(400).json({ error: 'payroll data is required' });

    const company = payrollData.company || payrollData.companyName || 'Trucking Company';
    const period = payrollData.period || {};
    const statements = payrollData.statements || payrollData.drivers || [];
    const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="payroll-report.pdf"');
    doc.pipe(res);

    doc.fillColor('#F59E0B').fontSize(22).font('Helvetica-Bold').text(company);
    let periodLine = 'Weekly Payroll';
    if (period.weekStart) periodLine += ` — ${period.weekStart}`;
    if (period.weekEnd) periodLine += ` to ${period.weekEnd}`;
    doc.moveDown(0.2).fillColor('#666666').fontSize(11).font('Helvetica').text(periodLine);
    doc.moveDown(1);

    statements.forEach((s, i) => {
      if (i > 0) doc.moveDown(0.8);
      const name = s.driver || s.name;
      doc.fillColor('#111111').fontSize(14).font('Helvetica-Bold').text(name);
      doc.moveDown(0.3);
      doc.fillColor('#333333').fontSize(11).font('Helvetica');
      doc.text(`Gross Pay:        ${fmt(s.gross)}`);

      if (Array.isArray(s.deductions) && s.deductions.length > 0) {
        doc.fillColor('#666666').text('Deductions:');
        s.deductions.forEach((d) => {
          const amt = typeof d.amount === 'string' ? d.amount : fmt(d.amount);
          doc.fillColor('#666666').text(`   - ${d.label}: ${amt}`);
        });
      }
      doc.fillColor('#333333').text(`Total Deductions: ${fmt(s.totalDeductions)}`);
      doc.fillColor('#F59E0B').font('Helvetica-Bold').text(`Net Pay:          ${fmt(s.netPay)}`);
      doc.font('Helvetica');

      doc.moveDown(0.4);
      doc.strokeColor('#DDDDDD').lineWidth(0.5)
        .moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    });

    doc.moveDown(1);
    doc.fillColor('#111111').fontSize(12).font('Helvetica-Bold')
      .text(`Total Net Payroll: ${fmt(payrollData.totalNet || payrollData.totalNetPay)}    (${statements.length} driver(s))`);

    doc.moveDown(2);
    doc.fillColor('#999999').fontSize(10).font('Helvetica')
      .text('Generated by PayrollAgent — Powered by Zyvon Solution', { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Download PDF error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'PayrollAgent API running' });
});

app.listen(PORT, () => console.log(`Report server running on port ${PORT}`));