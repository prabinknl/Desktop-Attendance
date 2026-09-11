# Hikvision Attendance Gateway Agent

## Overview
The Hikvision attendance device (e.g. `DS-K1T320EFWX` at `192.168.0.6:80`) is located on your local office LAN. Because remote web servers cannot directly access private `192.168.x.x` LAN addresses, this gateway agent runs on any local computer connected to the same LAN as the attendance machine.

It authenticates with the Hikvision machine via ISAPI Digest Auth, polls attendance logs, and pushes health heartbeats and attendance records to your backend API over secure HTTPS.

## Architecture

```
[Hikvision Device on LAN] ← ISAPI Digest Auth → [Gateway Agent on LAN PC] → HTTPS → [Backend API]
```

## Setup

1. Install Node.js ≥ 18
2. Navigate to the `gateway/` folder
3. Copy `.env.example` to `.env` and fill in your credentials:

   ```env
   HIKVISION_IP=192.168.0.6
   HIKVISION_PORT=80
   HIKVISION_USERNAME=admin
   HIKVISION_PASSWORD=your_device_web_password

   # Backend API Configuration
   SERVER_URL=https://desktop-attendance.appnep.com/api
   CONNECTOR_TOKEN=copy_the_token_generated_in_Device_Settings
   ```

4. Start:
   ```bash
   node index.js
   ```

## Expected Output

```
====================================================
 Hikvision Windows Connector (Cloud Bridge)
====================================================
[Config] Target Device: http://192.168.0.6:80 (user: admin)
[Config] Cloud API URL: http://localhost:3001/api
[Config] Sync Interval: 30s
[Config] Heartbeat Interval: 10s
====================================================

[12:00:00] Heartbeat: device ONLINE (120ms)
[Sync] 3 event(s) from device — uploading
[Sync] OK inserted=3 dup=0 failed=0
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `HIKVISION_IP` | Yes | `192.168.0.6` | Device IP address |
| `HIKVISION_PORT` | No | `80` | Device port |
| `HIKVISION_USERNAME` | Yes | `admin` | Device login username |
| `HIKVISION_PASSWORD` | Yes | — | Device login password |
| `SERVER_URL` | Yes | `https://desktop-attendance.appnep.com/api` | Backend API URL; use `http://localhost:3001/api` only for local development |
| `CONNECTOR_TOKEN` | Yes | — | Per-device token from Device Settings → Generate connector token |
| `GATEWAY_SECRET` | No | — | Legacy shared secret for older deployments |
| `SYNC_INTERVAL_SECONDS` | No | `30` | Polling interval |
| `HEARTBEAT_INTERVAL_SECONDS` | No | `30` | Heartbeat interval |
