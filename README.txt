# WorkTrack — Setup Guide

## Files in this folder:
- server.js          ← Backend (runs on Admin PC)
- admin.html         ← Admin dashboard
- employee.html      ← Employee app
- START_SERVER.bat   ← Double-click to start (Windows)
- data.json          ← Created automatically (all your data)

---

## ADMIN PC SETUP (do this once):

1. Install Node.js from https://nodejs.org  (LTS version)
2. Copy this entire folder to Admin PC (e.g. C:\WorkTrack)
3. Double-click START_SERVER.bat
4. Admin panel opens automatically in browser

---

## EMPLOYEE PC SETUP:

1. Find Admin PC's IP address:
   - On Admin PC: open Command Prompt → type: ipconfig
   - Look for "IPv4 Address" e.g. 192.168.1.10

2. On each Employee PC, open Chrome/Edge and go to:
   http://192.168.1.10:3000/employee
   (replace 192.168.1.10 with your admin PC's IP)

3. To make it a desktop app:
   - In Chrome: click ⋮ menu → More tools → Create shortcut
   - Check "Open as window" → Create
   - Now it works like a real desktop app!

---

## KEEP SERVER RUNNING WHEN SCREEN IS OFF:

Option A — Just minimize the black CMD window (server keeps running)

Option B — Run as background service (never need to reopen):
1. Open Command Prompt as Administrator
2. Run: npm install -g pm2
3. Navigate to this folder: cd C:\WorkTrack
4. Run: pm2 start server.js --name worktrack
5. Run: pm2 startup
6. Run: pm2 save
Now server auto-starts even after PC restart!

---

## DEFAULT CREDENTIALS:

Admin 1: admin1 / admin123
Admin 2: admin2 / admin456

Employees: Add them from Admin Panel → Employees → Add Employee
Give each employee their ID and password to log in.

---

## FEATURES:

✅ Employee clock in / clock out
✅ 9-hour work timer (admin can change)
✅ Admin sees live activity feed (updates every 5 seconds)
✅ Leave request → admin approves/rejects
✅ Admin can add/remove employees
✅ Admin can change work hours, start/end time, grace period
✅ Full attendance log
✅ Export CSV reports
✅ Data stored ONLY on Admin PC (data.json)



${r.duration ? ` · ${r.duration}` : ' · Working...'}
