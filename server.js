const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

// ================= SCHEMAS =================
const Employee = mongoose.model('Employee', new mongoose.Schema({
  id: String, name: String, dept: String, email: String, password: String
}));

const Attendance = mongoose.model('Attendance', new mongoose.Schema({
  empId: String, name: String, date: String,
  sessions: [{ in: String, out: String, lateNote: String }],
  totalWork: String, status: String
}));

const Activity = mongoose.model('Activity', new mongoose.Schema({
  type: String, empId: String, name: String, time: String, date: String, note: String
}));

// ================= SETTINGS =================
// 8-hour shift  |  S1: 09:30–13:30  |  Break 45 min  |  S2: 14:15–17:30
let settings = {
  workHours: 8,
  startTime: '09:30',
  endTime: '17:30',
  graceMins: 15,
  breakMins: 45,
  session1End: '13:30',
  session2Start: '14:15',
  adminPhone: ''
};

// ================= HELPERS =================
function today() { return new Date().toISOString().split('T')[0]; }

function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function calcTotalSeconds(sessions) {
  return sessions.reduce((total, s) => {
    if (s.in && s.out) {
      const [h1, m1] = s.in.split(':').map(Number);
      const [h2, m2] = s.out.split(':').map(Number);
      return total + (h2 * 3600 + m2 * 60) - (h1 * 3600 + m1 * 60);
    }
    return total;
  }, 0);
}

function secsToStr(secs) {
  return `${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`;
}

// ================= ROUTES =================
app.get('/', (req, res) => res.redirect('/employee'));
app.get('/admin',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/employee', (req, res) => res.sendFile(path.join(__dirname, 'public', 'employee.html')));

// ================= AUTH =================
app.post('/api/auth/admin', (req, res) => {
  const { username, password } = req.body;
  if (username === 'Vivin' && password === 'Vivin1234') return res.json({ ok: true, name: 'Vivin', username: 'Vivin' });
  if (username === 'Alex'  && password === 'Alex4321')  return res.json({ ok: true, name: 'Alex',  username: 'Alex'  });
  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/auth/employee', async (req, res) => {
  const { empId, password } = req.body;
  const user = await Employee.findOne({ id: empId });
  if (!user || user.password !== password)
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  res.json({ ok: true, emp: user });
});

// ================= EMPLOYEES =================
app.get('/api/employees', async (req, res) => res.json(await Employee.find()));

app.post('/api/employees', async (req, res) => {
  const { id, name, dept, email, password } = req.body;
  if (!id || !name || !dept || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (await Employee.findOne({ id }))
    return res.status(400).json({ error: 'ID exists' });
  await new Employee({ id, name, dept, email, password }).save();
  res.json({ ok: true });
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    const r = await Employee.deleteOne({ id: req.params.id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= SETTINGS =================
app.get('/api/settings', (req, res) => res.json(settings));

app.put('/api/settings', (req, res) => {
  const { workHours, startTime, endTime, graceMins, breakMins, session1End, session2Start, adminPhone } = req.body;
  settings = {
    workHours:    workHours    ?? settings.workHours,
    startTime:    startTime    ?? settings.startTime,
    endTime:      endTime      ?? settings.endTime,
    graceMins:    graceMins    ?? settings.graceMins,
    breakMins:    breakMins    ?? settings.breakMins,
    session1End:  session1End  ?? settings.session1End,
    session2Start: session2Start ?? settings.session2Start,
    adminPhone:   adminPhone   ?? settings.adminPhone
  };
  res.json(settings);
});

// ================= LEAVE (apply only — no admin approval) =================
let leaves = [];

app.get('/api/leaves',           (req, res) => res.json(leaves));
app.get('/api/leaves/:empId',    (req, res) => res.json(leaves.filter(l => l.empId === req.params.empId)));
app.post('/api/leaves',          (req, res) => {
  leaves.push({ id: Date.now().toString(), ...req.body, status: 'pending' });
  res.json({ ok: true });
});

// ================= ATTENDANCE =================
app.get('/api/attendance',        async (req, res) => res.json(await Attendance.find().sort({ date: -1 })));
app.get('/api/attendance/:empId', async (req, res) => res.json(await Attendance.find({ empId: req.params.empId })));

// ================= CHECK-IN =================
app.post('/api/checkin', async (req, res) => {
  const { empId, name, checkIn } = req.body;
  const date = today();
  const nowMins = toMins(checkIn);

  let rec = await Attendance.findOne({ empId, date });
  if (!rec) {
    rec = new Attendance({ empId, name, date, sessions: [], totalWork: '0h 00m', status: 'present' });
  }

  // Block if already clocked in
  if (rec.sessions.find(s => s.in && !s.out))
    return res.json({ error: 'Already clocked in' });

  // Max 2 sessions per day
  if (rec.sessions.length >= 2)
    return res.json({ error: 'Both sessions already completed for today' });

  const sessionIndex = rec.sessions.length; // 0 = S1, 1 = S2

  // ── Enforce minimum break between sessions ────────────────
  if (sessionIndex === 1) {
    const s1 = rec.sessions[0];
    if (s1 && s1.out) {
      const breakTaken = nowMins - toMins(s1.out);
      if (breakTaken < settings.breakMins) {
        const rem = settings.breakMins - breakTaken;
        return res.json({ error: `Break not complete. ${rem} min(s) remaining (${settings.breakMins}-min break required).` });
      }
    }
  }

  // ── Late detection (applies to BOTH sessions) ─────────────
  let lateNote = '', isLate = false;

  if (sessionIndex === 0) {
    const graceEnd = toMins(settings.startTime) + settings.graceMins;
    if (nowMins > graceEnd) {
      isLate = true;
      lateNote = `Late S1 check-in at ${checkIn}`;
      rec.status = 'late';
    }
  } else {
    const s2GraceEnd = toMins(settings.session2Start) + settings.graceMins;
    if (nowMins > s2GraceEnd) {
      isLate = true;
      lateNote = `Late S2 check-in at ${checkIn}`;
      if (rec.status !== 'late') rec.status = 'late';
    }
  }

  rec.sessions.push({ in: checkIn, out: null, lateNote });
  await rec.save();

  await Activity.create({ type: 'checkin', empId, name, time: checkIn, date, note: lateNote || '' });

  res.json({ ok: true, rec, isLate, lateNote, sessionIndex, adminPhone: settings.adminPhone });
});

// ================= CHECK-OUT =================
app.post('/api/checkout', async (req, res) => {
  const { empId, checkOut } = req.body;
  const date = today();

  const rec = await Attendance.findOne({ empId, date });
  if (!rec) return res.json({ error: 'No record' });

  const open = rec.sessions.find(s => s.in && !s.out);
  if (!open) return res.json({ error: 'No active session' });

  open.out = checkOut;

  const completed = rec.sessions.filter(s => s.in && s.out).length;
  rec.totalWork = secsToStr(calcTotalSeconds(rec.sessions));

  // Present = both sessions done | Half Day = only 1 session done
  if (completed >= 2) {
    if (rec.status !== 'late') rec.status = 'present';
  } else {
    rec.status = 'half day';
  }

  await rec.save();
  await Activity.create({ type: 'checkout', empId, name: rec.name, time: checkOut, date });

  res.json(rec);
});

// ================= ACTIVITY =================
app.get('/api/activity', async (req, res) => {
  res.json(await Activity.find().sort({ _id: -1 }).limit(100));
});

// ================= START =================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
