// ═══════════════════════════════════════════════════════════
//  WorkTrack — Backend Server (Fixed)
//  Run: node server.js
//  All data saved in data.json on THIS PC (Admin PC)
// ═══════════════════════════════════════════════════════════
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    settings: { workHours:9, startTime:'09:30', endTime:'18:30', graceMins:15, breakMins:45 },
    admins: [
      { username:'admin1', password:'admin123', name:'Admin One' },
      { username:'admin2', password:'admin456', name:'Admin Two' }
    ],
    employees:[], attendance:[], leaveRequests:[], activityLog:[]
  };
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const d = defaultData();
      fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
      return d;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) { return defaultData(); }
}
function writeData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, {'Content-Type':'application/json'});
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end',  () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function serveFile(res, fp, ct) {
  fs.readFile(fp, (err, d) => {
    if (err) { json(res, 404, {error:'Not found'}); return; }
    cors(res);
    res.writeHead(200, {'Content-Type': ct});
    res.end(d);
  });
}

// FIX: Account for local timezone so midnight shifts don't log to the wrong day
function today() { 
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0]; 
}

// ── Calculate total worked seconds from sessions ──────────
function calcTotalSeconds(sessions) {
  let total = 0;
  (sessions || []).forEach(s => {
    if (s.in && s.out) {
      const [h1,m1] = s.in.split(':').map(Number);
      const [h2,m2] = s.out.split(':').map(Number);
      total += (h2*3600 + m2*60) - (h1*3600 + m1*60);
    }
  });
  return total;
}
function secsToStr(secs) {
  const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
  return `${h}h ${String(m).padStart(2,'0')}m`;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const m   = req.method;

  if (m === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // ── Static files ──────────────────────────────────────
  if (m==='GET' && (url==='/' || url==='/admin'))  { serveFile(res, path.join(__dirname,'admin.html'),    'text/html'); return; }
  if (m==='GET' && url==='/employee')              { serveFile(res, path.join(__dirname,'employee.html'), 'text/html'); return; }
if (m==='GET' && url==='/hydra.jpg')             { serveFile(res, path.join(__dirname,'hydra.jpg'),     'image/jpeg'); return; }
  // ── Settings ──────────────────────────────────────────
  if (m==='GET' && url==='/api/settings') {
    json(res, 200, readData().settings); return;
  }
  if (m==='PUT' && url==='/api/settings') {
    const b=await body(req), d=readData();
    d.settings = {...d.settings, ...b};
    writeData(d);
    json(res, 200, d.settings); return;
  }

  // ── Auth ──────────────────────────────────────────────
  if (m==='POST' && url==='/api/auth/admin') {
    const {username,password}=await body(req), d=readData();
    const a = d.admins.find(a => a.username===username && a.password===password);
    a ? json(res,200,{ok:true, name:a.name, username:a.username})
      : json(res,401,{ok:false, error:'Invalid credentials'});
    return;
  }
  if (m==='POST' && url==='/api/auth/employee') {
    const {empId,password}=await body(req), d=readData();
    const e = d.employees.find(e => e.id===empId && e.password===password);
    e ? json(res,200,{ok:true, emp:e})
      : json(res,401,{ok:false, error:'Invalid Employee ID or password'});
    return;
  }

  // ── Employees ─────────────────────────────────────────
  if (m==='GET' && url==='/api/employees') {
    json(res, 200, readData().employees); return;
  }
  if (m==='POST' && url==='/api/employees') {
    const b=await body(req), d=readData();
    if (d.employees.find(e => e.id===b.id)) { json(res,409,{error:'Employee ID already exists'}); return; }
    d.employees.push(b);
    writeData(d);
    json(res, 201, b); return;
  }
  if (m==='DELETE' && url.startsWith('/api/employees/')) {
    const id=decodeURIComponent(url.split('/api/employees/')[1]), d=readData();
    d.employees = d.employees.filter(e => e.id !== id);
    writeData(d);
    json(res, 200, {ok:true}); return;
  }

  // ── Attendance ────────────────────────────────────────
  if (m==='GET' && url==='/api/attendance') {
    json(res, 200, readData().attendance); return;
  }
  if (m==='GET' && url.startsWith('/api/attendance/')) {
    const id=decodeURIComponent(url.split('/api/attendance/')[1]), d=readData();
    json(res, 200, d.attendance.filter(a => a.empId===id)); return;
  }

  // ── Check-in ──────────────────────────────────────────
  if (m==='POST' && url==='/api/checkin') {
    const b  = await body(req);
    const d  = readData();
    const t  = today();

    let rec = d.attendance.find(a => a.empId===b.empId && a.date===t);
    // Create new record if first session today
    if (!rec) {
      rec = {
        empId:     b.empId,
        name:      b.name,
        date:      t,
        sessions:  [],
        totalWork: '0h 00m',
        status:    b.status || 'present'
      };
      d.attendance.push(rec);
    }

    const completedSessions = rec.sessions.filter(s => s.in && s.out).length;
    const hasOpenSession    = rec.sessions.some(s => s.in && !s.out);

    if (completedSessions >= 2) {
      json(res, 400, {error:'Already completed 2 sessions today'}); return;
    }
    if (hasOpenSession) {
      json(res, 400, {error:'Already clocked in — please clock out first'}); return;
    }

    // FIX: Dynamic break check from settings
    let lateMsg = null;
    if (rec.sessions.length === 1 && rec.sessions[0].out) {
      const [h, mi] = rec.sessions[0].out.split(':').map(Number);
      const expectedBack = h*60 + mi + (d.settings.breakMins || 45); 
      const [ch,cm] = b.checkIn.split(':').map(Number);
      const actualBack = ch*60 + cm;
      if (actualBack > expectedBack) {
        const delay = actualBack - expectedBack;
        lateMsg = `Late back from break by ${delay} min(s)`;
      }
    }

    // Add new session
    rec.sessions.push({ in: b.checkIn, out: null, lateNote: lateMsg || null });
    
    if (rec.sessions.length === 1) {
      rec.status = b.status || 'present';
    }

    // Activity log
    d.activityLog.unshift({
      type:   'checkin',
      empId:  b.empId,
      name:   b.name,
      time:   b.checkIn,
      date:   t,
      status: rec.status
    });
    if (d.activityLog.length > 100) d.activityLog = d.activityLog.slice(0, 100);

    writeData(d);
    json(res, 200, {rec, lateMsg}); return;
  }

  // ── Check-out ─────────────────────────────────────────
  if (m==='POST' && url==='/api/checkout') {
    const b  = await body(req);
    const d  = readData();
    const t  = today();

    const rec = d.attendance.find(a => a.empId===b.empId && a.date===t);
    if (!rec || !rec.sessions || !rec.sessions.length) {
      json(res, 400, {error:'No attendance record found for today'}); return;
    }

    // Find the open session
    const openSession = rec.sessions.find(s => s.in && !s.out);
    if (!openSession) {
      json(res, 400, {error:'No active session to close'}); return;
    }

    // Close the session
    openSession.out = b.checkOut;
    
    const totalSecs  = calcTotalSeconds(rec.sessions);
    rec.totalWork    = secsToStr(totalSecs);

    const completedSessions = rec.sessions.filter(s => s.in && s.out).length;
    if (completedSessions >= 2 && totalSecs < d.settings.workHours * 3600) {
      rec.status = 'absent';
    }

    // Activity log
    d.activityLog.unshift({
      type:     'checkout',
      empId:    b.empId,
      name:     b.name,
      time:     b.checkOut,
      date:     t,
      duration: rec.totalWork,
      status:   'checkout'
    });
    if (d.activityLog.length > 100) d.activityLog = d.activityLog.slice(0, 100);

    writeData(d);
    json(res, 200, rec); return;
  }

  // ── Activity log ──────────────────────────────────────
  if (m==='GET' && url==='/api/activity') {
    const d = readData();
    json(res, 200, d.activityLog.filter(a => a.date === today())); return;
  }

  // ── Leave Requests ────────────────────────────────────
  if (m==='GET' && url==='/api/leaves') {
    json(res, 200, readData().leaveRequests); return;
  }
  if (m==='GET' && url.startsWith('/api/leaves/')) {
    const id=decodeURIComponent(url.split('/api/leaves/')[1]), d=readData();
    json(res, 200, d.leaveRequests.filter(r => r.empId===id)); return;
  }
  if (m==='POST' && url==='/api/leaves') {
    const b=await body(req), d=readData();
    d.leaveRequests.push(b);
    writeData(d);
    json(res, 201, b); return;
  }
  if (m==='PUT' && url.startsWith('/api/leaves/')) {
    const id=decodeURIComponent(url.split('/api/leaves/')[1]);
    const b=await body(req), d=readData();
    const r = d.leaveRequests.find(r => r.id===id);
    if (!r) { json(res, 404, {error:'Leave request not found'}); return; }
    
    r.status = b.status;
    if (b.status === 'approved') {
      const s=new Date(r.from), e=new Date(r.to);
      for (let dd=new Date(s); dd<=e; dd.setDate(dd.getDate()+1)) {
        const ds = dd.toISOString().split('T')[0];
        d.attendance = d.attendance.filter(a => !(a.empId===r.empId && a.date===ds));
        d.attendance.push({
          empId:r.empId, name:r.name, date:ds,
          sessions:[], totalWork:'-', status:'holiday'
        });
      }
    }
    writeData(d);
    json(res, 200, r); return;
  }

  json(res, 404, {error:'Route not found'});
});


server.listen(PORT, '0.0.0.0', () => {
  console.log("Server running on port " + PORT);
});;
process.on('uncaughtException', err => console.error('Uncaught error:', err.message));