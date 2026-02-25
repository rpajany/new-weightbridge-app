// services/printerService.js
// Supports: Local USB/LPT printers, IP Network printers, PDF generation
// Uses node-printer for local OS printers and net/socket for IP printers

const net = require('net');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class PrinterService {
  constructor() {
    this.defaultPrinterType = process.env.PRINTER_TYPE || 'local'; // 'local' | 'ip' | 'pdf'
    this.ipPrinterHost = process.env.PRINTER_IP || '192.168.1.200';
    this.ipPrinterPort = parseInt(process.env.PRINTER_PORT) || 9100; // RAW/JetDirect port
    this.localPrinterName = process.env.PRINTER_NAME || ''; // empty = default printer
    this.printerPaperWidth = parseInt(process.env.PRINTER_WIDTH_MM) || 210; // A4 default, or 80mm for receipt

    // HTML-to-PDF renderer path (puppeteer or wkhtmltopdf)
    this.htmlToPdfEngine = process.env.PDF_ENGINE || 'wkhtmltopdf'; // 'wkhtmltopdf' | 'puppeteer'
    
    // Temp dir for generated files
    this.tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  // ─────────────────────────────────────────────
  // MAIN ENTRY: print a bill
  // ─────────────────────────────────────────────
  async printBill(bill, companySettings = {}, options = {}) {
    const { printerType, printerName, ipHost, ipPort, copies = 1 } = options;

    const type   = printerType  || this.defaultPrinterType;
    const pName  = printerName  || this.localPrinterName;
    const host   = ipHost       || this.ipPrinterHost;
    const port   = ipPort       || this.ipPrinterPort;

    // Build the HTML receipt
    const html = this.buildBillHTML(bill, companySettings);

    console.log(`🖨  Printing bill #${bill.billNo} via [${type}] ...`);

    switch (type) {
      case 'ip':
        return await this.printViaIP(html, bill, host, port, copies);
      case 'html':
        // Return HTML string (for browser-based window.print())
        return { success: true, method: 'html', html };
      case 'pdf':
        return await this.printViaPDF(html, bill, pName, copies);
      case 'local':
      default:
        return await this.printViaLocal(html, bill, pName, copies);
    }
  }

  // ─────────────────────────────────────────────
  // LOCAL PRINTER (Windows/Linux/macOS)
  // Uses OS print queue via lp / lpr / PowerShell
  // ─────────────────────────────────────────────
  async printViaLocal(html, bill, printerName, copies = 1) {
    const htmlFile = path.join(this.tempDir, `bill_${bill.billNo}_${Date.now()}.html`);
    fs.writeFileSync(htmlFile, html, 'utf8');

    const platform = process.platform;

    try {
      if (platform === 'win32') {
        // Windows: use PowerShell + IE/Edge to print HTML
        const ps = printerName
          ? `$ie = New-Object -ComObject InternetExplorer.Application; $ie.Navigate('file:///${htmlFile.replace(/\\/g,'/')}'); Start-Sleep 2; $ie.ExecWB(6,2); Start-Sleep 2; $ie.Quit()`
          : `Start-Process -FilePath "${htmlFile}" -Verb Print -Wait`;
        await this._execAsync(`powershell -Command "${ps}"`);
      } else if (platform === 'darwin') {
        // macOS: lpr
        const pFlag = printerName ? `-P "${printerName}"` : '';
        const nFlag = `-#${copies}`;
        await this._execAsync(`lpr ${pFlag} ${nFlag} "${htmlFile}"`);
      } else {
        // Linux: lp or lpr
        const pFlag = printerName ? `-d "${printerName}"` : '';
        const nFlag = `-n ${copies}`;
        await this._execAsync(`lp ${pFlag} ${nFlag} "${htmlFile}"`);
      }

      this._cleanupTemp(htmlFile);
      return { success: true, method: 'local', printer: printerName || 'default' };
    } catch (err) {
      this._cleanupTemp(htmlFile);
      // Fallback: try raw text via ESC/POS or simple text
      console.warn('Local HTML print failed, trying raw text fallback:', err.message);
      return await this._printRawText(bill, printerName, copies);
    }
  }

  // ─────────────────────────────────────────────
  // IP NETWORK PRINTER (RAW port 9100 / JetDirect)
  // Sends HTML converted to PostScript or raw PCL
  // ─────────────────────────────────────────────
  async printViaIP(html, bill, host, port, copies = 1) {
    // First try to generate PostScript/PDF via wkhtmltopdf, then send via socket
    const pdfFile = path.join(this.tempDir, `bill_${bill.billNo}_${Date.now()}.pdf`);
    const htmlFile = path.join(this.tempDir, `bill_${bill.billNo}_${Date.now()}.html`);
    fs.writeFileSync(htmlFile, html, 'utf8');

    try {
      // Try wkhtmltopdf → PDF → send raw to printer
      await this._execAsync(`wkhtmltopdf --quiet "${htmlFile}" "${pdfFile}"`);

      for (let i = 0; i < copies; i++) {
        await this._sendFileToIPPrinter(pdfFile, host, port);
      }

      this._cleanupTemp(htmlFile, pdfFile);
      return { success: true, method: 'ip_pdf', host, port };

    } catch (pdfErr) {
      console.warn('wkhtmltopdf unavailable, sending raw PCL to IP printer:', pdfErr.message);
      this._cleanupTemp(htmlFile, pdfFile);

      // Fallback: send raw PCL/text to IP printer
      const rawData = this._buildRawPCL(bill);
      for (let i = 0; i < copies; i++) {
        await this._sendRawToIPPrinter(rawData, host, port);
      }
      return { success: true, method: 'ip_raw', host, port };
    }
  }

  // ─────────────────────────────────────────────
  // PDF GENERATION + PRINT
  // ─────────────────────────────────────────────
  async printViaPDF(html, bill, printerName, copies = 1) {
    const pdfFile = path.join(this.tempDir, `bill_${bill.billNo}_${Date.now()}.pdf`);
    const htmlFile = path.join(this.tempDir, `bill_${bill.billNo}_${Date.now()}.html`);
    fs.writeFileSync(htmlFile, html, 'utf8');

    try {
      await this._execAsync(`wkhtmltopdf --quiet --page-size A4 "${htmlFile}" "${pdfFile}"`);
      
      const platform = process.platform;
      const pFlag = printerName ? (platform === 'win32' ? `/D:"${printerName}"` : `-P "${printerName}"`) : '';
      
      if (platform === 'win32') {
        await this._execAsync(`AcroRd32.exe /P /T "${pdfFile}" "${printerName || ''}"`);
      } else {
        await this._execAsync(`lpr ${pFlag} -#${copies} "${pdfFile}"`);
      }
      
      this._cleanupTemp(htmlFile, pdfFile);
      return { success: true, method: 'pdf', file: pdfFile };
    } catch (err) {
      this._cleanupTemp(htmlFile);
      throw new Error(`PDF print failed: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // SEND FILE TO IP PRINTER via RAW socket (port 9100)
  // ─────────────────────────────────────────────
  _sendFileToIPPrinter(filePath, host, port) {
    return new Promise((resolve, reject) => {
      const data = fs.readFileSync(filePath);
      this._sendRawToIPPrinter(data, host, port).then(resolve).catch(reject);
    });
  }

  _sendRawToIPPrinter(data, host, port) {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      const timeout = 10000;

      client.setTimeout(timeout);
      client.connect(port, host, () => {
        console.log(`Connected to printer ${host}:${port}`);
        client.write(data, () => {
          client.end();
        });
      });

      client.on('close', () => resolve({ success: true }));
      client.on('error', (err) => reject(new Error(`IP Printer error: ${err.message}`)));
      client.on('timeout', () => {
        client.destroy();
        reject(new Error(`IP Printer timeout connecting to ${host}:${port}`));
      });
    });
  }

  // ─────────────────────────────────────────────
  // RAW PCL TEXT fallback for basic printers
  // ─────────────────────────────────────────────
  _buildRawPCL(bill) {
    const lines = [
      '\x1B%-12345X@PJL\r\n',       // PJL header
      '@PJL ENTER LANGUAGE=PCL\r\n',
      '\x1BE',                        // PCL reset
      '\x1B&l0O',                     // Portrait
      '\x1B&l2A',                     // Letter paper
      '\r\n',
      `SRI VENKADESWARA WEIGH BRIDGE\r\n`,
      `${'─'.repeat(48)}\r\n`,
      `Serial No : ${bill.billNo}    Date: ${new Date(bill.dateTime).toLocaleDateString('en-IN')}\r\n`,
      `Time      : ${new Date(bill.dateTime).toLocaleTimeString('en-IN')}\r\n`,
      `${'─'.repeat(48)}\r\n`,
      `Vehicle No    : ${bill.vehicleNo}\r\n`,
      `Customer Name : ${bill.customer}\r\n`,
      `Material      : ${bill.material}\r\n`,
      `Charge        : Rs. ${bill.charges}\r\n`,
      `${'─'.repeat(48)}\r\n`,
      `Gross Weight  : ${bill.grossWeight?.value || '--'} Kg\r\n`,
      `               ${bill.grossWeight?.timestamp ? new Date(bill.grossWeight.timestamp).toLocaleString('en-IN') : ''}\r\n`,
      `Tare Weight   : ${bill.tareWeight?.value || '--'} Kg\r\n`,
      `               ${bill.tareWeight?.timestamp ? new Date(bill.tareWeight.timestamp).toLocaleString('en-IN') : ''}\r\n`,
      `${'─'.repeat(48)}\r\n`,
      `NET WEIGHT    : ${bill.netWeight || '--'} Kg\r\n`,
      `${'─'.repeat(48)}\r\n`,
      `\r\n\r\n\r\n`,
      '\x1BE',  // PCL reset
      '\x1B%-12345X'  // PJL end
    ];
    return Buffer.from(lines.join(''), 'utf8');
  }

  _printRawText(bill, printerName, copies) {
    return new Promise((resolve) => {
      const rawText = this._buildRawPCL(bill);
      const tmpFile = path.join(this.tempDir, `raw_${Date.now()}.prn`);
      fs.writeFileSync(tmpFile, rawText);

      const platform = process.platform;
      let cmd;
      if (platform === 'win32') {
        cmd = printerName ? `copy /b "${tmpFile}" "\\\\localhost\\${printerName}"` : `copy /b "${tmpFile}" PRN`;
      } else {
        const pFlag = printerName ? `-P "${printerName}"` : '';
        cmd = `lpr ${pFlag} "${tmpFile}"`;
      }

      exec(cmd, (err) => {
        this._cleanupTemp(tmpFile);
        if (err) {
          resolve({ success: false, error: err.message, method: 'raw_text' });
        } else {
          resolve({ success: true, method: 'raw_text' });
        }
      });
    });
  }

  // ─────────────────────────────────────────────
  // GET LIST OF AVAILABLE PRINTERS
  // ─────────────────────────────────────────────
  async listLocalPrinters() {
    const platform = process.platform;
    try {
      let output = '';
      if (platform === 'win32') {
        output = execSync('wmic printer get name,status /format:csv 2>nul', { timeout: 5000 }).toString();
        const lines = output.split('\n').filter(l => l.includes(','));
        return lines.slice(1).map(l => {
          const parts = l.split(',');
          return { name: parts[1]?.trim(), status: parts[2]?.trim() };
        }).filter(p => p.name);
      } else if (platform === 'darwin') {
        output = execSync('lpstat -a 2>/dev/null', { timeout: 5000 }).toString();
        return output.split('\n').filter(Boolean).map(l => ({ name: l.split(' ')[0], status: 'available' }));
      } else {
        output = execSync('lpstat -a 2>/dev/null || lpq -a 2>/dev/null | head -20', { timeout: 5000, shell: true }).toString();
        return output.split('\n').filter(Boolean).map(l => ({ name: l.split(' ')[0], status: 'available' }));
      }
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // TEST IP PRINTER CONNECTIVITY
  // ─────────────────────────────────────────────
  async testIPPrinter(host, port = 9100) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      client.setTimeout(4000);
      client.connect(port, host, () => {
        client.destroy();
        resolve({ reachable: true, host, port });
      });
      client.on('error', (err) => resolve({ reachable: false, host, port, error: err.message }));
      client.on('timeout', () => {
        client.destroy();
        resolve({ reachable: false, host, port, error: 'Timeout' });
      });
    });
  }

  // ─────────────────────────────────────────────
  // BUILD BILL HTML — exact layout matching the receipt image
  // ─────────────────────────────────────────────
  buildBillHTML(bill, company = {}) {
    const name     = company.name    || 'SRI VENKADESWARA WEIGH BRIDGE';
    const addr1    = company.addr1   || 'CHENNAI-THIRUVANAMALAI BYEPASS ROAD';
    const addr2    = company.addr2   || 'NEAR BY SANDHAI MEDU . THINDIVANAM - 604 001';
    const phone    = company.phone   || 'Ph : 9994706523 . 9543389898';
    const logo     = company.logo    || '';

    const billDate = new Date(bill.dateTime);
    const dateStr  = billDate.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' });
    const timeStr  = billDate.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true });

    const grossTime = bill.grossWeight?.timestamp
      ? new Date(bill.grossWeight.timestamp).toLocaleString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true })
      : '';
    const tareTime = bill.tareWeight?.timestamp
      ? new Date(bill.tareWeight.timestamp).toLocaleString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true })
      : '';

    const cam1 = bill.camera1Image || '';
    const cam2 = bill.camera2Image || '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Weigh Bridge Receipt - Bill #${bill.billNo}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 10mm 10mm 10mm 10mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 13px;
    color: #000;
    background: #fff;
    width: 190mm;
  }

  /* ── HEADER ── */
  .header {
    text-align: center;
    border-bottom: 3px double #000;
    padding-bottom: 6px;
    margin-bottom: 8px;
  }
  .header .logo {
    max-height: 50px;
    margin-bottom: 4px;
  }
  .header h1 {
    font-size: 20px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .header h2 {
    font-size: 13px;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 2px;
  }
  .header .addr {
    font-size: 11px;
    margin-top: 3px;
  }

  /* ── BILL META ROW ── */
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid #000;
    padding: 5px 0;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: bold;
  }
  .meta-row span { display: inline; }
  .meta-row .sep { margin: 0 6px; color: #555; }

  /* ── CAMERAS ── */
  .cameras {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
    width: 100%;
  }
  .cam-box {
    flex: 1;
    border: 1.5px solid #555;
    background: #e0e0e0;
    aspect-ratio: 16/10;
    overflow: hidden;
    position: relative;
    min-height: 100px;
  }
  .cam-box img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cam-timestamp {
    position: absolute;
    top: 4px;
    right: 6px;
    font-size: 9px;
    color: #fff;
    background: rgba(0,0,0,0.55);
    padding: 1px 4px;
    border-radius: 2px;
    font-family: monospace;
  }
  .cam-label {
    position: absolute;
    bottom: 4px;
    left: 6px;
    font-size: 9px;
    color: #fff;
    background: rgba(0,0,0,0.5);
    padding: 1px 5px;
    border-radius: 2px;
  }
  .cam-no-image {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 11px;
    background: #d8d8d8;
    min-height: 90px;
  }

  /* ── DETAILS TABLE ── */
  .details {
    display: flex;
    gap: 16px;
    margin-bottom: 0;
  }
  .left-col {
    flex: 1;
    border: 1.5px solid #000;
    padding: 0;
  }
  .left-col table {
    width: 100%;
    border-collapse: collapse;
  }
  .left-col td {
    padding: 5px 8px;
    border-bottom: 1px solid #ccc;
    font-size: 13px;
    vertical-align: top;
  }
  .left-col td:first-child {
    font-weight: bold;
    white-space: nowrap;
    width: 40%;
    border-right: 1px solid #ccc;
  }
  .left-col tr:last-child td {
    border-bottom: none;
  }

  .right-col {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 175px;
  }

  /* ── WEIGHT BOXES ── */
  .weight-boxes {
    display: flex;
    gap: 0;
    border: 2px solid #000;
    margin-bottom: 0;
  }
  .w-box {
    flex: 1;
    text-align: center;
    border-right: 2px solid #000;
    padding: 6px 4px;
  }
  .w-box:last-child { border-right: none; }
  .w-box .w-label {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .w-box .w-value {
    font-size: 17px;
    font-weight: bold;
    letter-spacing: 0.5px;
  }
  .w-box .w-time {
    font-size: 9px;
    color: #444;
    margin-top: 3px;
    font-family: monospace;
  }
  .w-box.net-box { background: #f0fff0; }
  .w-box.net-box .w-value { font-size: 20px; color: #006600; }

  /* ── FOOTER ── */
  .footer {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-top: 1px solid #000;
    padding-top: 8px;
    font-size: 11px;
  }
  .footer .generated { color: #555; }
  .footer .sign {
    text-align: right;
    border-top: 1px solid #000;
    padding-top: 4px;
    min-width: 120px;
    font-size: 11px;
  }

  /* Print: hide buttons */
  @media print {
    .no-print { display: none !important; }
  }

  /* Print action bar (shown on screen only) */
  .print-bar {
    display: flex;
    gap: 10px;
    margin-bottom: 14px;
    justify-content: flex-end;
  }
  .print-btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: bold;
  }
  .btn-print { background: #1a56db; color: #fff; }
  .btn-close  { background: #e02424; color: #fff; }
</style>
</head>
<body>

<!-- Print bar - screen only -->
<div class="print-bar no-print">
  <button class="print-btn btn-print" onclick="window.print()">🖨 Print This Bill</button>
  <button class="print-btn btn-close" onclick="window.close()">✕ Close</button>
</div>

<!-- ── HEADER ── -->
<div class="header">
  ${logo ? `<img class="logo" src="${logo}" alt="Logo" />` : ''}
  <h1>${name}</h1>
  <h2>${addr1}</h2>
  <div class="addr">${addr2} &nbsp;&nbsp; ${phone}</div>
</div>

<!-- ── META ROW ── -->
<div class="meta-row">
  <span><b>Serial No</b> :- ${bill.billNo}</span>
  <span><b>Date</b> :- ${dateStr}</span>
  <span><b>Time</b> :- ${timeStr}</span>
</div>

<!-- ── CAMERAS ── -->
<div class="cameras">
  <div class="cam-box">
    ${cam1
      ? `<img src="${cam1}" alt="Camera 1" /><span class="cam-timestamp">${grossTime}</span><span class="cam-label">IPC</span>`
      : `<div class="cam-no-image">NO CAMERA 1 IMAGE</div>`}
  </div>
  <div class="cam-box">
    ${cam2
      ? `<img src="${cam2}" alt="Camera 2" /><span class="cam-timestamp">${grossTime}</span><span class="cam-label">Channel4</span>`
      : `<div class="cam-no-image">NO CAMERA 2 IMAGE</div>`}
  </div>
</div>

<!-- ── DETAILS + WEIGHTS ── -->
<div class="details">
  <!-- Left: vehicle info -->
  <div class="left-col">
    <table>
      <tr><td>Vehicle No</td><td>:- ${bill.vehicleNo}</td></tr>
      <tr><td>Customer Name</td><td>:- ${bill.customer}</td></tr>
      <tr><td>Material</td><td>:- ${bill.material}</td></tr>
      <tr><td>Charge</td><td>:- ₹ ${bill.charges?.toFixed ? bill.charges.toFixed(2) : bill.charges}</td></tr>
    </table>
  </div>

  <!-- Right: weight boxes -->
  <div class="right-col">
    <div class="weight-boxes">
      <div class="w-box">
        <div class="w-label">Gross Weight</div>
        <div class="w-value">${bill.grossWeight?.value ? bill.grossWeight.value.toLocaleString('en-IN') + '-Kg' : '--'}</div>
        <div class="w-time">${grossTime}</div>
      </div>
      <div class="w-box">
        <div class="w-label">Tare Weight</div>
        <div class="w-value">${bill.tareWeight?.value ? bill.tareWeight.value.toLocaleString('en-IN') + '-Kg' : '--'}</div>
        <div class="w-time">${tareTime}</div>
      </div>
      <div class="w-box net-box">
        <div class="w-label">Net Weight</div>
        <div class="w-value">${bill.netWeight ? bill.netWeight.toLocaleString('en-IN') + '-Kg' : '--'}</div>
        <div class="w-time">&nbsp;</div>
      </div>
    </div>
  </div>
</div>

<!-- ── FOOTER ── -->
<div class="footer">
  <div class="generated">Printed: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; WeighBridge Pro</div>
  <div class="sign">Authorised Signature</div>
</div>

<script>
  // Auto-trigger print if opened as popup
  if (window.opener) {
    setTimeout(() => window.print(), 500);
  }
</script>
</body>
</html>`;
  }

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  _execAsync(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  _cleanupTemp(...files) {
    files.forEach(f => {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    });
  }
}

module.exports = new PrinterService();
