// routes/printer.js
const express = require('express');
const router = express.Router();
const WeighBill = require('../models/WeighBill');
const printerService = require('../services/printerService');

// Helper: get company settings from env or request body
function getCompanySettings(body = {}) {
  return {
    name:  body.companyName  || process.env.COMPANY_NAME  || 'SRI VENKADESWARA WEIGH BRIDGE',
    addr1: body.companyAddr1 || process.env.COMPANY_ADDR1 || 'CHENNAI-THIRUVANAMALAI BYEPASS ROAD',
    addr2: body.companyAddr2 || process.env.COMPANY_ADDR2 || 'NEAR BY SANDHAI MEDU . THINDIVANAM - 604 001',
    phone: body.companyPhone || process.env.COMPANY_PHONE || 'Ph : 9994706523 . 9543389898',
    logo:  body.companyLogo  || process.env.COMPANY_LOGO  || ''
  };
}

// ── GET /api/printer/preview/:id
// Returns the HTML receipt for browser preview / window.print()
router.get('/preview/:id', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).send('<h2>Bill not found</h2>');

    const company = getCompanySettings(req.query);
    const html = printerService.buildBillHTML(bill, company);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

// ── POST /api/printer/print/:id
// Sends to local or IP printer directly from server
// Body: { printerType, printerName, ipHost, ipPort, copies, ...companyFields }
router.post('/print/:id', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const company = getCompanySettings(req.body);
    const options = {
      printerType: req.body.printerType,
      printerName: req.body.printerName,
      ipHost:      req.body.ipHost,
      ipPort:      req.body.ipPort ? parseInt(req.body.ipPort) : undefined,
      copies:      req.body.copies ? parseInt(req.body.copies) : 1
    };

    const result = await printerService.printBill(bill, company, options);

    // Log print event back on the bill (optional)
    bill.printedAt = new Date();
    await bill.save().catch(() => {}); // non-critical

    res.json({ success: true, billNo: bill.billNo, ...result });
  } catch (err) {
    console.error('Print error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/printer/print-html/:id
// Returns HTML for client-side window.print() (browser popup)
router.post('/print-html/:id', async (req, res) => {
  try {
    const bill = await WeighBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const company = getCompanySettings(req.body);
    const html = printerService.buildBillHTML(bill, company);
    res.json({ success: true, html });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/printer/printers
// List available local OS printers
router.get('/printers', async (req, res) => {
  try {
    const printers = await printerService.listLocalPrinters();
    res.json({ printers });
  } catch (err) {
    res.status(500).json({ error: err.message, printers: [] });
  }
});

// ── POST /api/printer/test-ip
// Test connectivity to an IP printer
// Body: { host, port }
router.post('/test-ip', async (req, res) => {
  const { host, port = 9100 } = req.body;
  if (!host) return res.status(400).json({ error: 'host is required' });
  const result = await printerService.testIPPrinter(host, parseInt(port));
  res.json(result);
});

// ── GET /api/printer/status
// Returns current printer config
router.get('/status', (req, res) => {
  res.json({
    defaultType:     printerService.defaultPrinterType,
    localPrinter:    printerService.localPrinterName || '(system default)',
    ipHost:          printerService.ipPrinterHost,
    ipPort:          printerService.ipPrinterPort,
    paperWidth:      printerService.printerPaperWidth,
    htmlToPdfEngine: printerService.htmlToPdfEngine
  });
});

module.exports = router;
