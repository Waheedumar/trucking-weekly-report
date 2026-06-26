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
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
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

For EACH driver, extract every block/load they ran with:
- block or load ID (e.g. B-5VBSZ1GTD)
- pickup date (YYYY-MM-DD format)
- pickup location (hub code + city + state, e.g. "MSP1 Shakopee, MN 55379")
- delivery date (YYYY-MM-DD format)
- delivery location (hub code + city + state)
- flat rate / pay amount for that specific block (the dollar amount shown next to that trip)

Also extract the total invoice amount from File 2.

The drivers provided are: ${driverList}
The weekly gross per driver is: ${grossAmount}

IMPORTANT: Extract the actual dollar amount shown for each trip/block. In Amazon Relay the amount appears next to each trip row (e.g. $2,705.21, $2,659.31). Use those exact amounts as the rate for each block.

If files are unclear, return empty blocks and use the provided gross amount.

Respond ONLY with valid JSON, no other text:
{
  "drivers": [
    {
      "name": "Driver Name",
      "blocks": [
        {
          "blockId": "B-5VBSZ1GTD",
          "pickupDate": "2026-06-12",
          "pickupLocation": "MSP1 Shakopee, MN 55379",
          "deliveryDate": "2026-06-14",
          "deliveryLocation": "MSP9 Brooklyn Park, MN 55445",
          "rate": 2705.21
        }
      ]
    }
  ],
  "invoiceTotal": "49693.25",
  "filesReadSuccessfully": true,
  "notes": ""
}`;

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
// PAYROLL ROUTES
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
        weekStart,
        weekEnd,
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
// PDF ROUTE — White background, navy/amber theme
// ============================================================

app.post('/api/download-pdf', (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data.drivers)) {
      return res.status(400).json({ success: false, error: 'Valid payroll data is required' });
    }

    const C = {
      navy:    '#0B1628',
      navyMid: '#162040',
      amber:   '#F5A623',
      white:   '#FFFFFF',
      offWhite:'#F4F6FA',
      dark:    '#1A202C',
      muted:   '#7A8499',
      border:  '#E2E8F0',
      danger:  '#DC2626',
      tableHdr:'#0B1628',
      tableAlt:'#F8F9FC',
    };

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const fileName = `payroll-${(data.companyName || 'report').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);

    const PAD = 40;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - PAD * 2;
    const company = data.company || {
      name: data.companyName || 'Company',
      address: data.companyAddress || '',
      phone: data.companyPhone || '',
    };

    data.drivers.forEach((d, idx) => {
      if (idx > 0) doc.addPage();

      // ── White page background ──
      doc.rect(0, 0, pageW, pageH).fill(C.white);

      // ── Section 1: Company Header — full width navy band ──
      const hdrH = 100;
      doc.rect(0, 0, pageW, hdrH).fill(C.navy);

      doc.fillColor(C.amber).fontSize(20).font('Helvetica-Bold')
        .text(company.name || 'Company', PAD, 20, { width: contentW });
      doc.fillColor('#C9D2E3').fontSize(9).font('Helvetica')
        .text(company.address || '', PAD, 48, { width: contentW })
        .text(company.phone || '', PAD, 62, { width: contentW });
      doc.fillColor(C.white).fontSize(9).font('Helvetica-Bold')
        .text('DRIVER PAY REPORT', PAD, 80);

      // ── Section 2: Driver Info — light grey band, 3 columns ──
      const drvH = 100;
      doc.rect(0, hdrH, pageW, drvH).fill(C.offWhite);
      // amber top border
      doc.rect(0, hdrH, pageW, 2).fill(C.amber);

      const cityLine = [d.city, d.state, d.zip].filter(Boolean).join(', ');
      const driverAddress = d.address || '—';
      const driverCity = cityLine || '';

      const col1 = [
        ['Driver', d.fullName || d.name || '—'],
        ['Address', driverAddress],
        ['', driverCity],
      ];
      const col2 = [
        ['Phone #', d.phone || '—'],
        ['Report Date', shortDate(new Date().toISOString())],
      ];
      const col3 = [
        ['Search From', shortDate(data.weekStart || data.period?.weekStart)],
        ['Search To', shortDate(data.weekEnd || data.period?.weekEnd)],
      ];

      const colW = contentW / 3;
      const drvY = hdrH + 12;

      [col1, col2, col3].forEach((col, ci) => {
        const x = PAD + ci * colW;
        let rowY = drvY;
        col.forEach(([label, value]) => {
          if (label) {
            doc.fillColor(C.muted).fontSize(8).font('Helvetica')
              .text(label, x, rowY, { width: colW - 10 });
            rowY += 13;
          }
          if (value) {
            doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold')
              .text(value, x, rowY, { width: colW - 10 });
            rowY += 16;
          }
        });
      });

      let y = hdrH + drvH + 10;

      // ── Section 3: Table Header — navy ──
      const tblHdrH = 26;
      doc.rect(PAD, y, contentW, tblHdrH).fill(C.tableHdr);

      const cols = [
        { label: 'BLOCK ID',  w: 0.17, align: 'left' },
        { label: 'PICKUP',    w: 0.275, align: 'left' },
        { label: 'DELIVERY',  w: 0.275, align: 'left' },
        { label: 'FLAT RATE', w: 0.14, align: 'right' },
        { label: 'TOTAL PAY', w: 0.14, align: 'right' },
      ];
      const colX = [];
      let cx = PAD;
      cols.forEach((c) => { colX.push(cx); cx += c.w * contentW; });

      cols.forEach((c, i) => {
        doc.fillColor(C.amber).fontSize(7.5).font('Helvetica-Bold')
          .text(c.label, colX[i] + 5, y + 9, { width: c.w * contentW - 10, align: c.align });
      });
      y += tblHdrH;

      // ── Section 4: Table Rows — white/offwhite alternating ──
      const blocks = d.blocks || [];
      let subTotal = 0;

      blocks.forEach((b, bi) => {
        const rowH = 40;
        if (y + rowH > pageH - 130) {
          doc.addPage();
          doc.rect(0, 0, pageW, pageH).fill(C.white);
          y = PAD;
          // Reprint table header on new page
          doc.rect(PAD, y, contentW, tblHdrH).fill(C.tableHdr);
          cols.forEach((c, i) => {
            doc.fillColor(C.amber).fontSize(7.5).font('Helvetica-Bold')
              .text(c.label, colX[i] + 5, y + 9, { width: c.w * contentW - 10, align: c.align });
          });
          y += tblHdrH;
        }

        const rowBg = bi % 2 === 0 ? C.white : C.tableAlt;
        doc.rect(PAD, y, contentW, rowH).fill(rowBg);

        const cells = [
          b.blockId || '—',
          `${shortDate(b.pickupDate)}\n${b.pickupLocation || ''}`,
          `${shortDate(b.deliveryDate)}\n${b.deliveryLocation || ''}`,
          usd(b.rate),
          usd(b.rate),
        ];

        subTotal += Number(b.rate) || 0;

        cells.forEach((cell, i) => {
          const isAmount = i >= 3;
          const isTotal = i === 4;
          doc.fillColor(isTotal ? C.amber : isAmount ? C.dark : C.dark)
            .fontSize(8.5)
            .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
            .text(cell, colX[i] + 5, y + 7, {
              width: cols[i].w * contentW - 10,
              align: cols[i].align,
              lineGap: 1,
            });
        });

        doc.moveTo(PAD, y + rowH).lineTo(PAD + contentW, y + rowH)
          .strokeColor(C.border).lineWidth(0.5).stroke();
        y += rowH;
      });

      if (blocks.length === 0) subTotal = Number(d.gross) || 0;

      // ── Section 5: Totals — right aligned, light background box ──
      y += 20;
      const tW = 250;
      const tX = PAD + contentW - tW;
      const driverDeductions = d.deductions || [];
      const totalDeductions = driverDeductions.reduce((s, ded) => s + (Number(ded.amount) || 0), 0);
      const grandTotal = subTotal - totalDeductions;
      const totalsH = 30 + (driverDeductions.length * 24) + 20 + 36;

      doc.rect(tX - 10, y - 10, tW + 10, totalsH).fill(C.offWhite);
      doc.rect(tX - 10, y - 10, tW + 10, 2).fill(C.border);

      // Sub-Total
      doc.fillColor(C.muted).fontSize(10).font('Helvetica')
        .text('Sub-Total', tX, y, { width: 140 });
      doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold')
        .text(usd(subTotal), tX + 140, y, { width: tW - 140, align: 'right' });
      y += 26;

      // Deductions
      driverDeductions.forEach((ded) => {
        doc.fillColor(C.muted).fontSize(9).font('Helvetica')
          .text(ded.label, tX, y, { width: 140 });
        doc.fillColor(C.danger).fontSize(9).font('Helvetica')
          .text(`-${usd(ded.amount)}`, tX + 140, y, { width: tW - 140, align: 'right' });
        y += 22;
      });

      // Divider
      doc.moveTo(tX, y).lineTo(tX + tW, y)
        .strokeColor(C.border).lineWidth(0.5).stroke();
      y += 12;

      // Grand Total
      doc.fillColor(C.navy).fontSize(13).font('Helvetica-Bold')
        .text('Grand Total (USD)', tX, y, { width: 140 });
      doc.fillColor(C.amber).fontSize(13).font('Helvetica-Bold')
        .text(usd(grandTotal), tX + 100, y, { width: tW - 100, align: 'right' });
    });

    // ── Footer on every page ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Navy footer bar
      doc.rect(0, pageH - 36, pageW, 36).fill(C.navy);
      doc.fillColor(C.muted).fontSize(8).font('Helvetica')
        .text('PayrollAgent — Powered by Zyvon Solution',
          PAD, pageH - 22, { width: contentW, align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('download-pdf error:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    else res.end();
  }
});

// ============================================================
// EMAIL ROUTE
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
    const amber = '#F5A623', text = '#FFFFFF', muted = '#A0AEC0', border = 'rgba(255,255,255,0.10)';
    const company = payrollData.company || { name: payrollData.companyName || 'Company' };

    const driverReports = (payrollData.drivers || []).map((d) => {
      const cityLine = [d.city, d.state, d.zip].filter(Boolean).join(', ');
      const blockRows = (d.blocks || []).map((b) => `
        <tr>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:#C9D2E3;font-size:12px;font-family:monospace;">${b.blockId || '—'}</td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;">${shortDate(b.pickupDate)}<br/><span style="color:${muted};">${b.pickupLocation || ''}</span></td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;">${shortDate(b.deliveryDate)}<br/><span style="color:${muted};">${b.deliveryLocation || ''}</span></td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${text};font-size:12px;text-align:right;">${usd(b.rate)}</td>
          <td style="padding:8px 6px;border-top:1px solid ${border};color:${amber};font-size:12px;text-align:right;font-weight:700;">${usd(b.rate)}</td>
        </tr>`).join('');

      const driverDeductions = d.deductions || [];
      const subTotal = (d.blocks || []).reduce((s, b) => s + (Number(b.rate) || 0), 0) || Number(d.gross) || 0;
      const totalDeductions = driverDeductions.reduce((s, ded) => s + (Number(ded.amount) || 0), 0);
      const grandTotal = subTotal - totalDeductions;

      const deductionRows = driverDeductions.map((ded) => `
        <tr>
          <td style="padding:4px 0;color:${muted};font-size:13px;">${ded.label}</td>
          <td style="padding:4px 0;color:#FF6B6B;font-size:13px;text-align:right;">-${usd(ded.amount)}</td>
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
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Search From</td><td style="color:${text};">${shortDate(payrollData.weekStart || payrollData.period?.weekStart)}</td></tr>
                  <tr><td style="color:${muted};padding:2px 10px 2px 0;">Search To</td><td style="color:${text};">${shortDate(payrollData.weekEnd || payrollData.period?.weekEnd)}</td></tr>
                </table>
              </td>
            </tr>
          </table>
          <div style="color:${muted};font-size:11px;margin-top:6px;">${[d.address, cityLine].filter(Boolean).join(', ')}</div>
        </div>
        <table width="100%" style="border-collapse:collapse;background:${navy};">
          <tr style="background:${card};">
            <td style="padding:10px 20px;color:${amber};font-size:10px;text-transform:uppercase;font-weight:700;">Block ID</td>
            <td style="padding:10px 6px;color:${amber};font-size:10px;text-transform:uppercase;font-weight:700;">Pickup</td>
            <td style="padding:10px 6px;color:${amber};font-size:10px;text-transform:uppercase;font-weight:700;">Delivery</td>
            <td style="padding:10px 6px;color:${amber};font-size:10px;text-transform:uppercase;font-weight:700;text-align:right;">Flat Rate</td>
            <td style="padding:10px 20px 10px 6px;color:${amber};font-size:10px;text-transform:uppercase;font-weight:700;text-align:right;">Total Pay</td>
          </tr>
          ${blockRows}
        </table>
        <div style="padding:14px 20px;background:${surface};">
          <table align="right" style="border-collapse:collapse;min-width:240px;">
            <tr>
              <td style="padding:4px 0;color:${muted};font-size:13px;">Sub-Total</td>
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

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'PayrollAgent API running' });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Report server running on port ${PORT}`));