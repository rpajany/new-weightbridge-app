# WeighBridge Pro — Industrial Weighing Management System

A full-stack Node.js + MongoDB application for managing weigh bridge operations. Captures live weight from a serial port, takes snapshots from two IP cameras, stores all bill records in MongoDB, and prints formatted receipts to local or network printers.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Environment Configuration](#environment-configuration)
- [Serial Port Settings](#serial-port-settings)
- [IP Camera Settings](#ip-camera-settings)
- [Printer Settings](#printer-settings)
- [MongoDB Settings](#mongodb-settings)
- [API Reference](#api-reference)
  - [Bills API](#bills-api)
  - [Printer API](#printer-api)
  - [System API](#system-api)
  - [WebSocket](#websocket)
- [Data Model](#data-model)
- [Workflow Guide](#workflow-guide)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Live weight display** — reads from weighbridge serial port in real time via WebSocket
- **Auto-stability detection** — detects when the weight reading is stable and ready to capture
- **Dual IP camera capture** — automatically snapshots both cameras at gross and tare weighing
- **MongoDB persistence** — all bill records, images, and weights stored in MongoDB
- **Auto bill numbering** — sequential bill numbers generated automatically
- **Net weight calculation** — calculated automatically as Gross − Tare
- **4 print modes** — Browser popup, Local/USB, IP Network (RAW port 9100), PDF
- **Formatted receipt** — prints exactly like a standard weigh bridge receipt with camera images, company header, and weight table
- **Records with search** — search by vehicle number, customer, or material; filter by date
- **CSV export** — export all records to CSV
- **Simulation mode** — runs without a physical serial port for development and testing

---

## Project Structure

```
weighbridge/
├── backend/
│   ├── server.js                  # Express + WebSocket entry point
│   ├── package.json               # Node.js dependencies
│   ├── .env.example               # Environment variable template
│   ├── models/
│   │   └── WeighBill.js           # MongoDB schema and model
│   ├── routes/
│   │   ├── bills.js               # Bill CRUD + weighing endpoints
│   │   └── printer.js             # Print and printer management endpoints
│   ├── services/
│   │   ├── serialService.js       # Serial port reader + WebSocket broadcaster
│   │   ├── cameraService.js       # IP camera snapshot capture
│   │   └── printerService.js      # Local, IP, and PDF print engine
│   └── public/
│       └── snapshots/             # Auto-created: saved camera snapshot files
└── frontend/
    └── public/
        └── index.html             # Single-page UI (served by Express)
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18 or higher | [nodejs.org](https://nodejs.org) |
| MongoDB | 6.0 or higher | Local install or MongoDB Atlas |
| wkhtmltopdf | Any | Optional — only needed for PDF/IP print mode |

**Install MongoDB locally (Ubuntu/Debian):**
```bash
sudo apt-get install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

**Install MongoDB locally (Windows):**
Download from [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community)

**Install wkhtmltopdf (optional, for PDF printing):**
```bash
# Ubuntu/Debian
sudo apt-get install wkhtmltopdf

# macOS
brew install wkhtmltopdf

# Windows: download installer from https://wkhtmltopdf.org/downloads.html
```

---

## Backend Setup

### 1. Install dependencies

```bash
cd weighbridge/backend
npm install
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` with your configuration (see [Environment Configuration](#environment-configuration) below).

### 3. Start the server

```bash
# Production
node server.js

# Development (auto-restart on file changes — requires nodemon)
npm install -g nodemon
npm run dev
```

The server starts on `http://localhost:3001` by default.

You will see output like:
```
✅ MongoDB connected: mongodb://localhost:27017/weighbridge
⚠️  No serial port - running in simulation mode
🚀 Weigh Bridge Server running on http://localhost:3001
📡 WebSocket server ready
```

---

## Frontend Setup

The frontend is a single HTML file (`frontend/public/index.html`) that is **served automatically by the Express backend**. There is no separate build step or framework.

Open your browser and go to:
```
http://localhost:3001
```

That is all that is required. The frontend communicates with the backend via:
- REST API calls to `/api/*`
- A WebSocket connection to `ws://localhost:3001` for live weight streaming

If you want to run the frontend on a different machine than the backend, edit the `API` constant at the top of the `<script>` section in `index.html`:

```javascript
// Change this line in frontend/public/index.html
const API = 'http://YOUR_SERVER_IP:3001/api';
```

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in your values. All settings have safe defaults so the system will run in simulation/demo mode without any configuration.

```env
# ── DATABASE ────────────────────────────────────────────────
MONGODB_URI=mongodb://localhost:27017/weighbridge

# ── SERIAL PORT (Weighbridge indicator) ──────────────────────
# Linux:   /dev/ttyUSB0  or  /dev/ttyS0
# Windows: COM3  or  COM4
# macOS:   /dev/tty.usbserial-XXXX
SERIAL_PORT=/dev/ttyUSB0
BAUD_RATE=9600

# ── IP CAMERAS ───────────────────────────────────────────────
CAMERA1_SNAPSHOT=http://192.168.1.100/snapshot.jpg
CAMERA2_SNAPSHOT=http://192.168.1.101/snapshot.jpg
CAMERA1_USER=admin
CAMERA1_PASS=password
CAMERA2_USER=admin
CAMERA2_PASS=password

# ── PRINTER ──────────────────────────────────────────────────
# Options: local | ip | html | pdf
PRINTER_TYPE=local
PRINTER_NAME=
PRINTER_IP=192.168.1.200
PRINTER_PORT=9100
PRINTER_WIDTH_MM=210
PDF_ENGINE=wkhtmltopdf

# ── COMPANY / RECEIPT ────────────────────────────────────────
COMPANY_NAME=SRI VENKADESWARA WEIGH BRIDGE
COMPANY_ADDR1=CHENNAI-THIRUVANAMALAI BYEPASS ROAD
COMPANY_ADDR2=NEAR BY SANDHAI MEDU . THINDIVANAM - 604 001
COMPANY_PHONE=Ph : 9994706523 . 9543389898
COMPANY_LOGO=

# ── SERVER ───────────────────────────────────────────────────
PORT=3001
```

---

## Serial Port Settings

The serial service reads weight data from a weighbridge indicator connected via RS-232 or USB-to-serial adapter.

### Supported data formats

The parser auto-detects the following common formats:

| Format | Example | Description |
|--------|---------|-------------|
| Plain number | `039170` | Raw integer |
| Signed number | `+039170` | With leading plus sign |
| With unit | `039170 Kg` | Number followed by unit |
| Stable/Gross tag | `ST,GS,+039170kg` | Status tag prefix |

If your weighbridge sends a different format, edit the `parseWeight()` method in `services/serialService.js`.

### Finding your serial port

**Linux:**
```bash
ls /dev/tty*
# USB adapters typically appear as /dev/ttyUSB0
# Built-in RS-232 ports appear as /dev/ttyS0
dmesg | grep tty   # see recently connected devices
```

**Windows:**
Open Device Manager → Ports (COM & LPT). Your port will be listed as `COM3`, `COM4`, etc.

**macOS:**
```bash
ls /dev/tty.*
# USB adapters appear as /dev/tty.usbserial-XXXX
```

### Common baud rates

Most weighbridge indicators use `9600`. If your display shows garbage characters, try `4800`, `19200`, or `38400`. Check your indicator's manual for the correct baud rate.

### Simulation mode

If the configured serial port is not found, the system automatically switches to **simulation mode**, which generates a realistic fluctuating weight reading. This is ideal for development, demos, and testing without physical hardware. You will see this message in the console:

```
⚠️  No serial port - running in simulation mode
```

---

## IP Camera Settings

Cameras are captured by the server by fetching an HTTP snapshot URL at the moment of gross or tare weighing.

### Snapshot URL formats by brand

| Brand | Snapshot URL format |
|-------|-------------------|
| Hikvision | `http://[IP]/ISAPI/Streaming/channels/101/picture` |
| Dahua | `http://[IP]/cgi-bin/snapshot.cgi` |
| CP Plus | `http://[IP]/snapshot.jpg` |
| Axis | `http://[IP]/axis-cgi/jpg/image.cgi` |
| Generic / Most | `http://[IP]/snapshot.jpg` or `http://[IP]/image.jpg` |

### Authentication

If your camera requires a username and password, set them in `.env`:
```env
CAMERA1_USER=admin
CAMERA1_PASS=yourpassword
```

The service uses HTTP Basic Authentication when these values are set.

### Manual image upload

If your cameras are not network accessible, you can manually upload JPEG snapshots from the camera feed panel in the UI using the **📁 Upload** button on each camera feed.

---

## Printer Settings

The system supports four printing modes configurable from the **🖨 Printer** tab in the UI or via `.env`.

### Mode: Browser Print (recommended default)

```env
PRINTER_TYPE=html
```

The server generates the receipt HTML and returns it to the browser. The browser opens it in a new popup window and calls `window.print()`, which shows the standard OS print dialog. This works on all operating systems with no additional software.

### Mode: Local / USB Printer

```env
PRINTER_TYPE=local
PRINTER_NAME=HP_LaserJet_Pro   # leave blank for system default printer
```

The server prints directly to the OS print queue using:
- `lp` / `lpr` on Linux and macOS
- PowerShell on Windows

The printer must be installed and visible to the server OS. Use the **Scan** button in the Printer tab to list available printers.

**Find printer name on Linux:**
```bash
lpstat -a
```

**Find printer name on Windows:**
```powershell
wmic printer get name
```

**Find printer name on macOS:**
```bash
lpstat -p
```

### Mode: IP Network Printer (RAW port 9100)

```env
PRINTER_TYPE=ip
PRINTER_IP=192.168.1.200
PRINTER_PORT=9100
```

The server opens a raw TCP socket connection to the printer on port 9100 (JetDirect / RAW protocol). This is the standard method supported by all HP, Epson, Canon, Ricoh, Zebra, and most other network laser printers.

Use the **📡 Test Connection** button in the Printer tab to verify the printer is reachable before printing.

If `wkhtmltopdf` is installed, the server generates a PDF and sends it as raw bytes. If not, it falls back to sending raw PCL text, which works for plain-text receipts on most laser printers but will not include camera images.

### Mode: PDF via wkhtmltopdf

```env
PRINTER_TYPE=pdf
PRINTER_NAME=                  # local printer to send PDF to
PDF_ENGINE=wkhtmltopdf
```

Generates a full PDF of the receipt including camera images, then sends it to the local print queue. Requires `wkhtmltopdf` to be installed and available on the system PATH.

### Receipt layout

The printed receipt matches the standard Indian weigh bridge format:

```
┌─────────────────────────────────────────────────────────┐
│         SRI VENKADESWARA WEIGH BRIDGE                   │
│         CHENNAI-THIRUVANAMALAI BYEPASS ROAD             │
│   NEAR BY SANDHAI MEDU . THINDIVANAM - 604 001          │
│               Ph : 9994706523                           │
├─────────────────────────────────────────────────────────┤
│  Serial No :- 4135   Date :- 15-09-2022   Time :- ...  │
├─────────────────────────────────────────────────────────┤
│  [ Camera 1 Image ]         [ Camera 2 Image ]          │
├──────────────────────┬──────────┬──────────┬────────────┤
│ Vehicle No :- TN16   │  GROSS   │   TARE   │    NET     │
│ Customer  :- KMA     │ 4635-Kg  │   --     │ 4635-Kg   │
│ Material  :- GREEN.. │ 15-09-22 │          │            │
│ Charge    :- ₹ 60.00 └──────────┴──────────┴────────────┤
└─────────────────────────────────────────────────────────┘
```

---

## MongoDB Settings

### Local MongoDB

```env
MONGODB_URI=mongodb://localhost:27017/weighbridge
```

The database and collection are created automatically on first run.

### MongoDB Atlas (cloud)

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com)
2. Click **Connect** → **Connect your application**
3. Copy the connection string and set it in `.env`:

```env
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/weighbridge?retryWrites=true&w=majority
```

### MongoDB with authentication (local)

```env
MONGODB_URI=mongodb://admin:password@localhost:27017/weighbridge?authSource=admin
```

### Useful MongoDB commands

```bash
# Open MongoDB shell
mongosh

# Switch to weighbridge database
use weighbridge

# Count all bills
db.weighbills.countDocuments()

# Find bills for a specific vehicle
db.weighbills.find({ vehicleNo: "TN32AQ2399" })

# Find today's completed bills
db.weighbills.find({
  status: "completed",
  createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
})

# Delete all records (use with caution)
db.weighbills.deleteMany({})
```

---

## API Reference

Base URL: `http://localhost:3001/api`

All request and response bodies use `application/json`. Image fields (`camera1Image`, `camera2Image`) contain base64-encoded data URIs (`data:image/jpeg;base64,...`).

---

### Bills API

#### `GET /api/bills`

List all bills with pagination, search, and date filtering.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Records per page (max 10000 for export) |
| `search` | string | — | Search across vehicleNo, customer, material |
| `date` | string | — | Filter by date in `YYYY-MM-DD` format |

**Example request:**
```
GET /api/bills?page=1&limit=20&search=TN32&date=2023-05-12
```

**Example response:**
```json
{
  "bills": [
    {
      "_id": "64a1f2e3c4b5a6d7e8f90123",
      "billNo": 4135,
      "dateTime": "2023-05-12T17:31:30.000Z",
      "vehicleNo": "TN32AQ2399",
      "material": "MSAND",
      "customer": "RPV",
      "charges": 1.00,
      "grossWeight": { "value": 39170, "timestamp": "2023-05-12T17:38:38.000Z" },
      "tareWeight":  { "value": 11500, "timestamp": "2023-05-12T17:31:29.000Z" },
      "netWeight": 27670,
      "status": "completed",
      "camera1Image": "data:image/jpeg;base64,...",
      "camera2Image": "data:image/jpeg;base64,...",
      "createdAt": "2023-05-12T17:31:30.000Z",
      "updatedAt": "2023-05-12T17:38:38.000Z"
    }
  ],
  "total": 142,
  "page": 1,
  "totalPages": 8
}
```

---

#### `GET /api/bills/:id`

Get a single bill by MongoDB `_id`.

**Example request:**
```
GET /api/bills/64a1f2e3c4b5a6d7e8f90123
```

**Response:** Single bill object (same structure as above).

---

#### `POST /api/bills`

Create a new bill. Bill number is assigned automatically.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vehicleNo` | string | ✅ | Vehicle registration number (auto-uppercased) |
| `material` | string | ✅ | Material type (e.g. MSAND, GRAVEL) |
| `customer` | string | ✅ | Customer name |
| `charges` | number | — | Service charge amount (default: 0) |

**Example request:**
```json
POST /api/bills
{
  "vehicleNo": "TN32AQ2399",
  "material": "MSAND",
  "customer": "RPV",
  "charges": 1.00
}
```

**Example response** (HTTP 201):
```json
{
  "_id": "64a1f2e3c4b5a6d7e8f90123",
  "billNo": 4136,
  "dateTime": "2023-05-12T17:31:30.000Z",
  "vehicleNo": "TN32AQ2399",
  "material": "MSAND",
  "customer": "RPV",
  "charges": 1,
  "status": "pending"
}
```

---

#### `PATCH /api/bills/:id/gross-weight`

Capture the gross weight (loaded vehicle). Reads the current stable weight from the serial port and takes snapshots from both cameras.

**Request body (optional):**

| Field | Type | Description |
|-------|------|-------------|
| `weight` | number | Override the serial port reading with a manual value |

**Example request:**
```json
PATCH /api/bills/64a1f2e3.../gross-weight
{
  "weight": 39170
}
```

**Behaviour:**
- If `weight` is provided in the body, it is used. If not, the current stable weight from the serial port is used.
- Camera snapshots are automatically captured from both cameras.
- Bill `status` changes from `pending` → `gross_weighed`.

**Response:** Updated bill object with `grossWeight`, `camera1Image`, `camera2Image` populated.

---

#### `PATCH /api/bills/:id/tare-weight`

Capture the tare weight (empty vehicle). Calculates and stores `netWeight` automatically.

**Request body (optional):**

| Field | Type | Description |
|-------|------|-------------|
| `weight` | number | Override the serial port reading with a manual value |

**Behaviour:**
- Bill must be in `gross_weighed` status, otherwise returns HTTP 400.
- `netWeight` = `grossWeight.value` − `tareWeight.value` (calculated automatically on save).
- Bill `status` changes from `gross_weighed` → `completed`.

**Response:** Updated bill object with `tareWeight` and `netWeight` populated.

---

#### `PATCH /api/bills/:id`

Update any field on a bill (general update).

**Example request:**
```json
PATCH /api/bills/64a1f2e3...
{
  "customer": "Updated Customer Name",
  "charges": 2.50
}
```

**Response:** Updated bill object.

---

#### `DELETE /api/bills/:id`

Permanently delete a bill record.

**Response:**
```json
{ "message": "Bill deleted" }
```

---

#### `POST /api/bills/:id/images`

Upload camera images manually as file attachments (multipart/form-data).

**Form fields:**

| Field | Type | Description |
|-------|------|-------------|
| `camera1` | file | JPEG image for Camera 1 (max 10 MB) |
| `camera2` | file | JPEG image for Camera 2 (max 10 MB) |

**Example (curl):**
```bash
curl -X POST http://localhost:3001/api/bills/64a1f2e3.../images \
  -F "camera1=@/path/to/cam1.jpg" \
  -F "camera2=@/path/to/cam2.jpg"
```

---

#### `GET /api/bills/serial/weight`

Get the current weight reading from the serial port.

**Response:**
```json
{
  "weight": 39170,
  "stableWeight": 39170,
  "timestamp": "2023-05-12T17:38:38.000Z"
}
```

---

#### `GET /api/bills/serial/ports`

List all serial ports detected by the server OS.

**Response:**
```json
[
  { "path": "/dev/ttyUSB0", "manufacturer": "FTDI", "serialNumber": "A1234567" },
  { "path": "/dev/ttyS0",   "manufacturer": null }
]
```

---

#### `GET /api/bills/stats/dashboard`

Get today's summary statistics for the dashboard.

**Response:**
```json
{
  "totalBills": 4135,
  "todayBills": 12,
  "completedToday": 10,
  "totalWeightToday": 312450
}
```

`totalWeightToday` is in kilograms.

---

### Printer API

#### `GET /api/printer/preview/:id`

Returns a fully rendered HTML receipt page for the given bill. Opens directly in a browser tab. Includes the company header, camera images, vehicle details, and weight table in the standard weigh bridge format.

**Query parameters (optional — override company details):**

| Parameter | Description |
|-----------|-------------|
| `companyName` | Override company name on receipt |
| `companyAddr1` | Override address line 1 |
| `companyAddr2` | Override address line 2 |
| `companyPhone` | Override phone number |

**Example:**
```
GET /api/printer/preview/64a1f2e3...
```

Returns `text/html` — open directly in browser or iframe.

---

#### `POST /api/printer/print/:id`

Trigger a server-side print job. Sends the bill to a local OS printer or IP network printer from the server.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `printerType` | string | from `.env` | `local`, `ip`, `html`, or `pdf` |
| `printerName` | string | system default | Local printer name (for `local`/`pdf` mode) |
| `ipHost` | string | from `.env` | IP address of network printer (for `ip` mode) |
| `ipPort` | number | `9100` | RAW port of network printer (for `ip` mode) |
| `copies` | number | `1` | Number of copies to print |
| `companyName` | string | from `.env` | Company name on receipt |
| `companyAddr1` | string | from `.env` | Address line 1 |
| `companyAddr2` | string | from `.env` | Address line 2 |
| `companyPhone` | string | from `.env` | Phone number |
| `companyLogo` | string | — | Logo URL or base64 data URI |

**Example request:**
```json
POST /api/printer/print/64a1f2e3...
{
  "printerType": "ip",
  "ipHost": "192.168.1.200",
  "ipPort": 9100,
  "copies": 2
}
```

**Example response (success):**
```json
{
  "success": true,
  "billNo": 4135,
  "method": "ip_pdf",
  "host": "192.168.1.200",
  "port": 9100
}
```

**Example response (error):**
```json
{
  "success": false,
  "error": "IP Printer timeout connecting to 192.168.1.200:9100"
}
```

---

#### `POST /api/printer/print-html/:id`

Returns the receipt as an HTML string for the browser to open in a popup and call `window.print()`.

**Request body:** Same optional company fields as above.

**Response:**
```json
{
  "success": true,
  "html": "<!DOCTYPE html>..."
}
```

---

#### `GET /api/printer/printers`

List all printers installed on the server OS.

**Response:**
```json
{
  "printers": [
    { "name": "HP_LaserJet_Pro_M404dn", "status": "Idle" },
    { "name": "Epson_LQ-310",           "status": "Idle" }
  ]
}
```

Returns an empty array if no printers are installed or the server OS does not support printer listing.

---

#### `POST /api/printer/test-ip`

Test whether an IP printer is reachable on its RAW port.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | ✅ | IP address of the printer |
| `port` | number | — | Port to test (default: 9100) |

**Example request:**
```json
POST /api/printer/test-ip
{
  "host": "192.168.1.200",
  "port": 9100
}
```

**Example response (online):**
```json
{ "reachable": true,  "host": "192.168.1.200", "port": 9100 }
```

**Example response (offline):**
```json
{ "reachable": false, "host": "192.168.1.200", "port": 9100, "error": "Connection refused" }
```

---

#### `GET /api/printer/status`

Returns the current printer configuration loaded from `.env`.

**Response:**
```json
{
  "defaultType":     "local",
  "localPrinter":    "HP_LaserJet_Pro",
  "ipHost":          "192.168.1.200",
  "ipPort":          9100,
  "paperWidth":      210,
  "htmlToPdfEngine": "wkhtmltopdf"
}
```

---

### System API

#### `GET /api/health`

Server health check. Returns status of MongoDB connection and serial port.

**Response:**
```json
{
  "status":     "ok",
  "mongodb":    "connected",
  "serialPort": false,
  "uptime":     3842.5
}
```

`serialPort: false` means the system is running in simulation mode. `uptime` is in seconds.

---

### WebSocket

The server exposes a WebSocket endpoint at `ws://localhost:3001` that streams live weight readings approximately once per second.

**Connect:**
```javascript
const ws = new WebSocket('ws://localhost:3001');
```

**Incoming message format (server → client):**
```json
{
  "type":         "weight",
  "weight":       39170,
  "stable":       true,
  "stableWeight": 39170,
  "timestamp":    "2023-05-12T17:38:38.000Z"
}
```

| Field | Description |
|-------|-------------|
| `weight` | Current raw reading in kilograms |
| `stable` | `true` when the last 5 readings are within ±5 Kg of each other |
| `stableWeight` | The averaged stable reading — use this value when capturing weight |
| `timestamp` | ISO 8601 timestamp of the reading |

**Outgoing message (client → server):**
```json
{ "type": "ping" }
```

The server responds with `{ "type": "pong" }`.

---

## Data Model

### WeighBill Schema

```
MongoDB Collection: weighbills
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billNo` | Number | ✅ | Auto-incrementing unique bill number |
| `dateTime` | Date | — | Bill creation timestamp (default: now) |
| `vehicleNo` | String | ✅ | Vehicle registration (stored uppercase) |
| `material` | String | ✅ | Material being weighed |
| `customer` | String | ✅ | Customer name |
| `charges` | Number | — | Service charge (default: 0) |
| `grossWeight.value` | Number | — | Gross weight in Kg |
| `grossWeight.timestamp` | Date | — | When gross weight was captured |
| `tareWeight.value` | Number | — | Tare weight in Kg |
| `tareWeight.timestamp` | Date | — | When tare weight was captured |
| `netWeight` | Number | — | Auto-calculated: Gross − Tare |
| `camera1Image` | String | — | Base64 data URI of Camera 1 snapshot |
| `camera2Image` | String | — | Base64 data URI of Camera 2 snapshot |
| `status` | String | — | `pending` → `gross_weighed` → `completed` |
| `printedAt` | Date | — | Timestamp of last print |
| `createdAt` | Date | — | Mongoose auto-timestamp |
| `updatedAt` | Date | — | Mongoose auto-timestamp |

**Status lifecycle:**

```
pending  ──(capture gross weight)──►  gross_weighed  ──(capture tare weight)──►  completed
```

---

## Workflow Guide

### Standard two-weighing workflow (Gross → Tare)

1. Vehicle arrives loaded. Operator fills in **Vehicle No**, **Material**, **Customer**, and **Charge** in the form.
2. Vehicle drives onto the scale. The live weight display updates in real time. Wait for the stability indicator to show **STABLE — READY TO CAPTURE**.
3. Click **⚖ Capture Gross Weight**. The system records the weight and automatically captures snapshots from both cameras.
4. Vehicle is unloaded at the destination. Vehicle drives back onto the scale empty.
5. Weight stabilizes again on the live display.
6. Click **⚖ Capture Tare Weight**. The system records the tare weight. Net weight is calculated and displayed automatically.
7. Click **✓ Complete & Save Bill** to finalize the record.
8. Click **🖨 Print** to print the receipt with both camera images, all weights, and vehicle details.

### Single-weighing workflow (known tare)

1. Create the bill and capture gross weight as above.
2. Enter the known tare weight in the **Manual Weight Override** field.
3. Click **⚖ Capture Tare Weight** — the manual value is used instead of the live scale reading.

### Loading an existing bill

Click any row in the **Records** tab to load that bill into the weighing form. You can then recapture weights, update details, or reprint the receipt.

---

## Troubleshooting

### Server won't start
- Ensure Node.js 18+ is installed: `node --version`
- Ensure MongoDB is running: `sudo systemctl status mongodb`
- Check that port 3001 is not in use: `lsof -i :3001` (Linux/macOS) or `netstat -ano | findstr 3001` (Windows)

### MongoDB connection error
- Verify MongoDB is running: `mongosh --eval "db.adminCommand('ping')"`
- Double-check your `MONGODB_URI` value in `.env`
- For Atlas, ensure your machine's IP address is whitelisted in the Atlas Network Access settings

### Serial port not found
- The system falls back to simulation mode automatically — this is not a crash
- Confirm the port path: `ls /dev/tty*` (Linux) or Device Manager (Windows)
- On Linux, add your user to the `dialout` group: `sudo usermod -aG dialout $USER` then log out and back in
- Check port permissions: `ls -la /dev/ttyUSB0` — should include `rw` for the `dialout` group

### Camera snapshots not capturing
- Test the snapshot URL directly in your browser first
- Verify username and password in `.env`
- Ensure the server machine and camera are on the same network (ping test: `ping 192.168.1.100`)
- Some cameras require enabling the HTTP snapshot feature in their web admin panel

### IP printer not responding
- Use the **📡 Test Connection** button in the Printer tab first
- Verify the printer's IP by printing a test page from the printer itself
- Default RAW port is `9100` — some printers use `9101` or `9102`
- Check that no firewall is blocking port 9100 between the server and printer

### Print receipt has no camera images
- Images are only included if camera snapshots were captured during weighing
- For a quick test, manually upload images using the **📁 Upload** button on each camera feed in the UI before printing
- If using `ip` mode without `wkhtmltopdf` installed, the fallback raw PCL output does not include images — install `wkhtmltopdf` for full image support in IP/PDF modes

### Browser print dialog shows blank page
- Open the receipt preview directly: `http://localhost:3001/api/printer/preview/BILL_ID`
- If the preview renders correctly, ensure your browser allows popups from `localhost`
- Try a different browser (Chrome, Firefox, Edge)
