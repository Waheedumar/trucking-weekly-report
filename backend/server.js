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

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ACCEPTED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

let resendClient = null;
function getResend() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

// ============================================================
// HELPERS
// ============================================================

function usd(value) {
  const n = Number(value) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseClaudeJson(text) {
  if (!text) throw new Error('Empty response from Claude');
  let cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in Claude response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function fileToContentBlock(file) {
  const data = file.buffer.toString('base64');
  if (file.mimetype === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: file.mimetype, data } };
}

function formatWeek(weekStart, weekEnd) {
  if (!weekStart && !weekEnd) return '';
  try {
    const s = weekStart ? new Date(weekStart) : null;
    const e = weekEnd ? new Date(weekEnd) : null;
    if (s && e && !isNaN(s) && !isNaN(e)) {
      const sLabel = s.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const eLabel = e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      return `${sLabel} - ${eLabel}`;
    }
  } catch {}
  return [weekStart, weekEnd].filter(Boolean).join(' - ');
}

const CLAUDE_PROMPT = (driverList, grossAmount) => `You are a payroll processing agent for an Amazon DSP trucking company.
You have been given two files:
File 1: Amazon Relay driver drop-off / load history showing which drivers ran which blocks (loads) this week
File 2: Weekly revenue invoice showing total amount earned this week
For EACH driver, extract every block/load they ran with: block or load ID, pickup date, pickup location,
delivery date, delivery location, and the flat rate (pay) for that block if visible.
Also extract the total invoice amount.
The drivers provided are: ${driverList}
The weekly gross per driver is: ${grossAmount}
If the files are unclear, return empty blocks for that driver and rely on the provided gross amount.
Respond ONLY with valid JSON, no other text:
{
  "drivers": [
    {
      "name": "Driver Name",
      "blocks": [
        {
          "blockId": "BR-12345",
          "pickupDate": "2026-06-01",
          "pickupLocation": "DFW8, Dallas TX",
          "deliveryDate": "2026-06-01",
          "deliveryLocation": "FTW1, Fort Worth TX",
          "rate": 850.00
        }
      ]
    }
  ],
  "invoiceTotal": "12500.00",
  "filesReadSuccessfully": true,
  "notes": ""
}`;

// ============================================================
// EXISTING ROUTES
// ============================================================

const REPORT_SYSTEM_PROMPT = `You are an expert trucking business analyst...`;

app.post('/api/generate-report', async (req, res) => {
  const { data } = req.body;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: REPORT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Generate report for: ${JSON.stringify(data)}` }],
    });
    res.json({ report: response.content[0].text });
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

app.post('/api/parse-ratecon', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a rate confirmation parser. Return ONLY valid JSON: {"broker":{"name":"","contact_name":null,"email":null,"phone":null,"mc_number":null},"load":{"reference_number":null,"load_type":null,"commodity":null,"weight":null},"pickup":{"company":null,"address":null,"city":"","state":"","zip":null,"date":null,"time":null,"notes":null},"delivery":{"company":null,"address":null,"city":"","state":"","zip":null,"date":null,"time":null,"notes":null},"rate":{"total":0,"per_mile":0,"estimated_miles":0,"currency":"USD","fuel_surcharge":0,"payment_terms":null},"confidence":"high/medium/low","missing_fields":[],"raw_notes":null}`,
      messages: [{ role: 'user', content: `Extract load data:\n\n${text}` }]
    });
    const raw = response.content[0].text;
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid credentials' });
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const token = jwt.sign(
      { id: profile.id, email: profile.email, name: profile.full_name, role: profile.role, company: profile.company_name },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: profile.id, email: profile.email, name: profile.full_name, role: profile.role, company: profile.company_name } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/loads', authMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { origin, destination, pickup_date, delivery_date, commodity, weight, rate, carrier, notes } = req.body;
    if (!origin || !destination || !pickup_date) return res.status(400).json({ error: 'origin, destination, pickup_date required' });
    const { data, error } = await supabase.from('loads').insert({
      dispatcher_id: req.user.id, origin, destination, pickup_date,
      delivery_date: delivery_date || null, commodity: commodity || null,
      weight: weight || null, rate: rate || null, carrier: carrier || null, notes: notes || null,
    }).select('*').single();
    if (error) return res.status(500).json({ error: 'Failed to create load' });
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
// PAYROLL ROUTES — UPDATED
// ============================================================

app.post('/api/process-payroll',
  upload.fields([{ name: 'file1', maxCount: 1 }, { name: 'file2', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { companyName = 'Company', weekStart = '', weekEnd = '', grossAmount = '0' } = req.body;

      let drivers = [], deductions = [];
      try {
        drivers = req.body.drivers ? JSON.parse(req.body.drivers) : [];
        deductions = req.body.deductions ? JSON.parse(req.body.deductions) : [];
      } catch {
        return res.status(400).json({ success: false, error: 'drivers and deductions must be valid JSON arrays' });
      }

      if (!Array.isArray(drivers) || drivers.length === 0) {
        return res.status(400).json({ success: false, error: 'At least one driver is required' });
      }

      drivers = drivers.map((d) => String(d).trim()).filter(Boolean);
      const grossInput = Number(grossAmount) || 0;
      const file1 = req.files?.file1?.[0];
      const file2 = req.files?.file2?.[0];

      let extraction = {
        drivers: [],
        invoiceTotal: '0.00',
        filesReadSuccessfully: false,
        notes: 'No files processed; used provided values.',
      };

      if (file1 || file2) {
        try {
          const content = [];
          if (file1) {
            content.push({ type: 'text', text: 'File 1 (Amazon Relay drop-off history):' });
            content.push(fileToContentBlock(file1));
          }
          if (file2) {
            content.push({ type: 'text', text: 'File 2 (Weekly revenue invoice):' });
            content.push(fileToContentBlock(file2));
          }
          content.push({ type: 'text', text: CLAUDE_PROMPT(drivers.join(', '), grossInput.toFixed(2)) });

          const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            messages: [{ role: 'user', content }],
          });

          const raw = message.content?.find((b) => b.type === 'text')?.text || '';
          extraction = parseClaudeJson(raw);
        } catch (err) {
          console.error('Vision extraction error:', err.message);
          extraction.notes = 'File read failed, using manual values.';
        }
      }

      const numDrivers = drivers.length;
      const extractedInvoice = Number(extraction.invoiceTotal) || 0;
      const grossPerDriver = grossInput > 0 ? grossInput : numDrivers > 0 ? extractedInvoice / numDrivers : 0;
      const totalInvoice = extractedInvoice > 0 ? extractedInvoice : grossPerDriver * numDrivers;

      const extractedByName = new Map(
        (extraction.drivers || []).map((d) => [String(d.name).toLowerCase().trim(), d])
      );

      const driverStatements = drivers.map((name) => {
        const ext = extractedByName.get(name.toLowerCase().trim()) || {};
        let blocks = Array.isArray(ext.blocks) ? ext.blocks : [];
        const ratedTotal = blocks.reduce((s, b) => s + (Number(b.rate) || 0), 0);
        const gross = grossPerDriver > 0 ? grossPerDriver : ratedTotal;

        if (blocks.length > 0 && ratedTotal === 0 && gross > 0) {
          const per = Math.round((gross / blocks.length) * 100) / 100;
          blocks = blocks.map((b) => ({ ...b, rate: per }));
        }

        blocks = blocks.map((b) => ({
          blockId: b.blockId || b.loadId || '—',
          pickupDate: b.pickupDate || '',
          pickupLocation: b.pickupLocation || '',
          deliveryDate: b.deliveryDate || '',
          deliveryLocation: b.deliveryLocation || '',
          rate: Number(b.rate) || 0,
        }));

        return { name, loadsCompleted: blocks.length, gross, blocks };
      });

      const data = {
        week: formatWeek(weekStart, weekEnd),
        companyName,
        totalInvoice: usd(totalInvoice),
        totalDrivers: numDrivers,
        grossPerDriver: usd(grossPerDriver),
        filesReadSuccessfully: Boolean(extraction.filesReadSuccessfully),
        notes: extraction.notes || '',
        drivers: driverStatements,
        generatedAt: new Date().toISOString(),
      };

      return res.json({ success: true, data });
    } catch (err) {
      console.error('process-payroll error:', err.message);
      return res.status(500).json({ success: false, error: err.message || 'Failed to process payroll' });
    }
  }
);

// ============================================================
// PDF ROUTE — UPDATED (ITS Dispatch format)
// ============================================================

app.post('/api/download-pdf', (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data.drivers)) {
      return res.status(400).json({ success: false, error: 'Valid payroll data is required' });
    }

    const COLORS = {
      navy: '#0B1628', surface: '#162040', amber: '#F5A623',
      text: '#FFFFFF', muted: '#7A8499', border: '#2A3A5C', danger: '#EF4444',
    };

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const fileName = `payroll-${(data.companyName || 'report').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);

    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const company = data.company || { name: data.companyName || 'Company', address: '', phone: '' };

    data.drivers.forEach((d, idx) => {
      if (idx > 0) doc.addPage();
      let y = doc.page.margins.top;

      // Header band
      doc.rect(0, 0, doc.page.width, 120).fill(COLORS.navy);
      doc.fillColor(COLORS.amber).fontSize(18).font('Helvetica-Bold').text(company.name || 'Company', left, 32, { width: contentWidth / 2 });
      doc.fillColor('#C9D2E3').fontSize(9).font('Helvetica')
        .text(company.address || '', left, 58, { width: contentWidth / 2 })
        .text(company.phone || '', left, 72, { width: contentWidth / 2 });
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold').text('DRIVER PAY REPORT', left, 94);

      // Driver info table (right)
      const infoX = left + contentWidth / 2;
      const infoW = contentWidth / 2;
      const cityLine = [d.city, d.state, d.zip].filter(Boolean).join(', ');
      const info = [
        ['Driver', d.fullName || d.name || '—'],
        ['Address', [d.address, cityLine].filter(Boolean).join(', ') || '—'],
        ['Phone #', d.phone || '—'],
        ['Report Date', shortDate(new Date().toISOString())],
        ['Search From', shortDate(data.period?.weekStart || data.weekStart)],
        ['Search To', shortDate(data.period?.weekEnd || data.weekEnd)],
      ];
      let iy = 24;
      info.forEach(([label, value]) => {
        doc.fillColor('#9FB0C9').fontSize(8).font('Helvetica').text(label, infoX, iy, { width: 70 });
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold').text(value, infoX + 72, iy, { width: infoW - 72 });
        iy += 15;
      });

      y = 140;

      // Load table
      const cols = [
        { key: 'block', label: 'Block ID', w: 0.18, align: 'left' },
        { key: 'pickup', label: 'Pickup', w: 0.28, align: 'left' },
        { key: 'delivery', label: 'Delivery', w: 0.28, align: 'left' },
        { key: 'rate', label: 'Flat Rate', w: 0.13, align: 'right' },
        { key: 'total', label: 'Total Pay', w: 0.13, align: 'right' },
      ];
      const colX = [];
      let cx = left;
      cols.forEach((c) => { colX.push(cx); cx += c.w * contentWidth; });

      doc.rect(left, y, contentWidth, 22).fill(COLORS.surface);
      cols.forEach((c, i) => {
        doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica-Bold')
          .text(c.label.toUpperCase(), colX[i] + 6, y + 7, { width: c.w * contentWidth - 12, align: c.align });
      });
      y += 22;

      const blocks = d.blocks || [];
      let subTotal = 0;
      blocks.forEach((b) => {
        const rowH = 34;
        if (y + rowH > doc.page.height - 100) { doc.addPage(); y = doc.page.margins.top; }
        const cells = [
          b.blockId || '—',
          `${shortDate(b.pickupDate)}\n${b.pickupLocation || ''}`,
          `${shortDate(b.deliveryDate)}\n${b.deliveryLocation || ''}`,
          usd(b.rate),
          usd(b.rate),
        ];
        subTotal += Number(b.rate) || 0;
        cols.forEach((c, i) => {
          doc.fillColor(i >= 3 ? COLORS.text : '#C9D2E3').fontSize(8.5)
            .font(i === 4 ? 'Helvetica-Bold' : 'Helvetica')
            .text(cells[i], colX[i] + 6, y + 6, { width: c.w * contentWidth - 12, align: c.align });
        });
        doc.moveTo(left, y + rowH).lineTo(left + contentWidth, y + rowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
        y += rowH;
      });

      // If no blocks, use gross as subtotal
      if (blocks.length === 0) subTotal = Number(d.gross) || 0;

      // Totals
      y += 12;
      const tX = left + contentWidth - 230;
      const tW = 230;

      const driverDeductions = d.deductions || [];
      const totalDeductions = driverDeductions.reduce((s, ded) => s + (Number(ded.amount) || 0), 0);
      const grandTotal = subTotal - totalDeductions;

      doc.fillColor(COLORS.muted).fontSize(9).font('Helvetica').text('Sub-Total', tX, y, { width: 140 });
      doc.fillColor(COLORS.text).fontSize(9).font('Helvetica-Bold').text(usd(subTotal), tX + 140, y, { width: tW - 140, align: 'right' });
      y += 17;

      driverDeductions.forEach((ded) => {
        doc.fillColor(COLORS.muted).fontSize(9).font('Helvetica').text(ded.label, tX, y, { width: 140 });
        doc.fillColor(COLORS.danger).fontSize(9).font('Helvetica').text(`-${usd(ded.amount)}`, tX + 140, y, { width: tW - 140, align: 'right' });
        y += 17;
      });

      doc.moveTo(tX, y).lineTo(tX + tW, y).strokeColor(COLORS.border).lineWidth(0.5).stroke();
      y += 8;
      doc.fillColor(COLORS.amber).fontSize(12).font('Helvetica-Bold').text('Grand Total (USD)', tX, y, { width: 140 });
      doc.fillColor(COLORS.amber).fontSize(12).font('Helvetica-Bold').text(usd(grandTotal), tX + 100, y, { width: tW - 100, align: 'right' });
    });

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica')
        .text('PayrollAgent — Powered by Zyvon Solution', left, doc.page.height - 34, { width: contentWidth, align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('download-pdf error:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    else res.end();
  }
});

// ============================================================
// EMAIL ROUTE — UPDATED
// ============================================================

app.post('/api/send-report', async (req, res) => {
  try {
    const { email, data, payroll } = req.body;
    const payrollData = data || payroll;

    if (!email) return res.status(400).json({ success: false, error: 'email is required' });
    if (!payrollData || !Array.isArray(payrollData.drivers)) {
      return res.status(400).json({ success: false, error: 'Valid payroll data is required' });
    }

    const navy = '#0B1628', surface = '#162040', card = '#1E2D52';
    const amber = '#F5A623', text = '#FFFFFF', muted = '#7A8499', border = 'rgba(255,255,255,0.10)';
    const company = payrollData.company || { name: payrollData.companyName || 'Company' };

    const driverReports = (payrollData.drivers || []).map((d) => {
      const cityLine = [d.city, d.state, d.zip].filter(Boolean).join(', ');
      const blockRows = (d.blocks || []).map((b) => `
        <tr>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:#C9D2E3;font-size:12px;font-family:monospace;">${b.blockId || '—'}</td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;">${shortDate(b.pickupDate)}<br/><span style="color:${muted};">${b.pickupLocation || ''}</span></td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;">${shortDate(b.deliveryDate)}<br/><span style="color:${muted};">${b.deliveryLocation || ''}</span></td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;text-align:right;">${usd(b.rate)}</td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;text-align:right;font-weight:700;">${usd(b.rate)}</td>
        </tr>`).join('');

      const driverDeductions = d.deductions || [];
      const subTotal = (d.blocks || []).reduce((s, b) => s + (Number(b.rate) || 0), 0) || Number(d.gross) || 0;
      const totalDeductions = driverDeductions.reduce((s, ded) => s + (Number(ded.amount) || 0), 0);
      const grandTotal = subTotal - totalDeductions;

      const deductionRows = driverDeductions.map((ded) => `
        <tr>
          <td style="padding:4px 0;color:${muted};font-size:13px;">${ded.label}</td>
          <td style="padding:4px 0;color:#EF4444;font-size:13px;text-align:right;">-${usd(ded.amount)}</td>
        </tr>`).join('');

      return `
      <div style="background:${card};border:1px solid ${border};border-radius:12px;margin-bottom:20px;overflow:hidden;">
        <div style="background:${surface};padding:18px 20px;">
          <table width="100%" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:top;">
                <div style="color:${amber};font-size:16px;font-weight:700;">${company.name}</div>
                <div style="color:${muted};font-size:12px;">${company.address || ''}</div>
                <div style="color:${muted};font-size:12px;">${company.phone || ''}</div>
              </td>
              <td style="vertical-align:top;font-size:12px;">
                <table style="border-collapse:collapse;">
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Driver</td><td style="color:${text};font-weight:700;">${d.fullName || d.name}</td></tr>
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Phone #</td><td style="color:${text};">${d.phone || '—'}</td></tr>
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Report Date</td><td style="color:${text};">${shortDate(new Date().toISOString())}</td></tr>
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Search From</td><td style="color:${text};">${shortDate(payrollData.period?.weekStart)}</td></tr>
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Search To</td><td style="color:${text};">${shortDate(payrollData.period?.weekEnd)}</td></tr>
                </table>
              </td>
            </tr>
          </table>
          <div style="color:${muted};font-size:11px;margin-top:6px;">${[d.address, cityLine].filter(Boolean).join(', ')}</div>
        </div>
        <table width="100%" style="border-collapse:collapse;">
          <tr>
            <td style="padding:10px 20px;color:${muted};font-size:10px;text-transform:uppercase;">Block ID</td>
            <td style="padding:10px 6px;color:${muted};font-size:10px;text-transform:uppercase;">Pickup</td>
            <td style="padding:10px 6px;color:${muted};font-size:10px;text-transform:uppercase;">Delivery</td>
            <td style="padding:10px 6px;color:${muted};font-size:10px;text-transform:uppercase;text-align:right;">Flat Rate</td>
            <td style="padding:10px 20px 10px 6px;color:${muted};font-size:10px;text-transform:uppercase;text-align:right;">Total Pay</td>
          </tr>
          ${blockRows}
        </table>
        <div style="padding:14px 20px;">
          <table align="right" style="border-collapse:collapse;min-width:240px;">
            <tr>
              <td style="padding:4px 0;color:${text};font-size:13px;font-weight:600;">Sub-Total</td>
              <td style="padding:4px 0;color:${text};font-size:13px;font-weight:600;text-align:right;">${usd(subTotal)}</td>
            </tr>
            ${deductionRows}
            <tr><td colspan="2" style="border-top:1px solid ${border};padding-top:6px;"></td></tr>
            <tr>
              <td style="padding:4px 0;color:${amber};font-size:16px;font-weight:800;">Grand Total (USD)</td>
              <td style="padding:4px 16px 4px 0;color:${amber};font-size:16px;font-weight:800;text-align:right;">${usd(grandTotal)}</td>
            </tr>
          </table>
        </div>
      </div>`;
    }).join('');

    const html = `
    <div style="background:${navy};padding:32px;font-family:Inter,Arial,sans-serif;">
      <div style="max-width:680px;margin:0 auto;">
        <h1 style="color:${text};font-size:22px;margin:0 0 4px;">${company.name} — Weekly Payroll</h1>
        <p style="color:${muted};font-size:14px;margin:0 0 24px;">${payrollData.week || ''}</p>
        ${driverReports}
        <p style="color:${muted};font-size:12px;text-align:center;margin-top:24px;">PayrollAgent — Powered by Zyvon Solution</p>
      </div>
    </div>`;

    const { data: sent, error } = await getResend().emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Payroll <onboarding@resend.dev>',
      to: [email],
      subject: `Weekly Payroll Report — ${company.name} (${payrollData.week || ''})`,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(502).json({ success: false, error: error.message });
    }

    res.json({ success: true, id: sent?.id || null });
  } catch (err) {
    console.error('send-report error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'PayrollAgent API running' });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Report server running on port ${PORT}`));