# Hikvision Local Gateway Agent

Lightweight local bridge service for the **Attendance Management System**. 

The Hikvision attendance device (e.g. `DS-K1T320EFWX` at `192.168.0.6:80`) is located on your local office LAN. Because cloud web servers (InsForge) cannot directly access private `192.168.x.x` LAN addresses, this gateway agent runs on any local computer connected to the same LAN as the attendance machine.

It authenticates with the Hikvision machine via ISAPI Digest Auth, polls attendance logs, and pushes health heartbeats and attendance records to your InsForge cloud application over secure HTTPS.

---

## Requirements
- **Node.js**: v18.0.0 or higher installed on the office Windows computer.
- **Network**: The computer running this agent must be connected to the same local network as `192.168.0.6`.

---

## Quick Setup & Run

### Step 1: Configure Credentials
1. Open the `.env` file inside the `gateway/` folder.
2. Edit your local device password and cloud API settings:
   ```env
   # Local LAN Hikvision Credentials
   HIKVISION_IP=192.168.0.6
   HIKVISION_PORT=80
   HIKVISION_USERNAME=admin
   HIKVISION_PASSWORD=your_device_password_here

   # Cloud InsForge API Configuration
   INSFORGE_API_URL=https://ew5ub4j6.ap-southeast.insforge.app/api
# Prefer token from Device Settings → Generate connector token
CONNECTOR_TOKEN=
GATEWAY_SECRET=attendence_local_gateway_secret_2026

# Polling & Sync Timers (in seconds)
SYNC_INTERVAL_SECONDS=30
HEARTBEAT_INTERVAL_SECONDS=30
   ```

### Step 2: Start the Gateway
Open Command Prompt or PowerShell in the `gateway/` folder and run:
```cmd
node index.js
```

You will see log output verifying device connectivity:
```text
====================================================
 Hikvision Local Gateway & Attendance Sync Agent
====================================================
[Config] Target Device: http://192.168.0.6:80 (user: admin)
[Config] Cloud API URL: https://ew5ub4j6.ap-southeast.insforge.app/api
====================================================

[11:30:00 AM] Heartbeat: Device ONLINE (15ms) · Cloud API ACK
[Sync] Downloaded 4 attendance events from device. Uploading to cloud...
[Sync] Upload Success: Inserted 4, Duplicates 0, Failed 0
```

---

## Automatic Windows Startup (Run on Boot)

To run the gateway automatically whenever Windows starts:

1. Double-click `register-startup.bat` inside the `gateway/` folder.
2. It registers a hidden startup script in your Windows Startup folder (`shell:startup`).
3. Now, whenever the computer turns on or logs in, the gateway runs silently in the background!

---

## Security Assurance
- The Hikvision administrator password is stored **ONLY** in `gateway/.env` on your local office computer.
- It is **NEVER** sent across the internet, exposed to the web browser, or stored in cloud environment variables.
- Duplicate prevention: Every attendance event is stamped with a unique external ID key (`hik_<serial>_<empId>_<eventTime>_<minor>`), guaranteeing zero duplicate punches in the cloud database.
