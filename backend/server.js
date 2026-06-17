require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

app.listen(PORT, () => console.log(`Report server running on port ${PORT}`));