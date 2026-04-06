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
  type: String, empId: String, name: String, time: String, date: String
}));

// Shift: 9 hours total, 8:00–17:00, break 45 min between sessions
// Session 1: 08:00–12:45 | Break 45min | Session 2: 13:30–17:00
const Settings = mongoose.model('Settings', new mongoose.Schema({
  key:           { type: String, required: true, unique: true },
  workHours:     { type: Number, default: 9 },
  startTime:     { type: String, default: '08:00' },
  endTime:       { type: String, default: '17:00' },
  graceMins:     { type: Number, default: 15 },
  breakMins:     { type: Number, default: 45 },
  session1Start: { type: String, default: '08:00' },
  session1End:   { type: String, default: '12:45' },
  session2Start: { type: String, default: '13:30' },
  session2End:   { type: String, default: '17:00' },
  adminPhone:    { type: String, default: '' }
}));

const Leave = mongoose.model('Leave', new mongoose.Schema({
  leaveId:  { type: String },
  empId:    String, name: String, type: String,
  from:     String, to: String, reason: String,
  status:   { type: String, default: 'pending' },
  applied:  String
}));

// ================= HELPERS =================
function today() { return new Date().toISOString().split('T')[0]; }

function calcTotalSeconds(sessions) {
  let total = 0;
  sessions.forEach(s => {
    if (s.in && s.out) {
      const [h1,m1] = s.in.split(':').map(Number);
      const [h2,m2] = s.out.split(':').map(Number);
      total += (h2*3600 + m2*60) - (h1*3600 + m1*60);
    }
  });
  return total;
}
function secsToStr(secs) {
  return `${Math.floor(secs/3600)}h ${String(Math.floor((secs%3600)/60)).padStart(2,'0')}m`;
}

async function getSettings() {
  let s = await Settings.findOne({ key: 'main' });
  if (!s) {
    s = await Settings.create({
      key:'main', workHours:9, startTime:'08:00', endTime:'17:00',
      graceMins:15, breakMins:45,
      session1Start:'08:00', session1End:'12:45',
      session2Start:'13:30', session2End:'17:00', adminPhone:''
    });
    console.log('✅ Default settings created');
  }
  return s;
}

// ================= ROUTES =================
app.get('/', (req,res) => res.redirect('/employee'));
app.get('/admin',    (req,res) => res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/employee', (req,res) => res.sendFile(path.join(__dirname,'public','employee.html')));

// ================= AUTH =================
app.post('/api/auth/admin', (req, res) => {
  const { username, password } = req.body;
  if (username === 'Vivin' && password === 'Vivin1234') return res.json({ ok:true, name:'Vivin', username:'Vivin' });
  if (username === 'Alex'  && password === 'Alex4321')  return res.json({ ok:true, name:'Alex',  username:'Alex' });
  res.status(401).json({ ok:false, error:'Invalid credentials' });
});
app.post('/api/auth/employee', async (req,res) => {
  const { empId, password } = req.body;
  const user = await Employee.findOne({ id: empId });
  if (!user || user.password !== password) return res.status(401).json({ ok:false, error:'Invalid credentials' });
  res.json({ ok:true, emp:user });
});

// ================= EMPLOYEES =================
app.get('/api/employees', async (req,res) => res.json(await Employee.find()));
app.post('/api/employees', async (req,res) => {
  const { id, name, dept, email, password } = req.body;
  if (!id||!name||!dept||!email||!password) return res.status(400).json({ error:'All fields required' });
  if (await Employee.findOne({ id })) return res.status(400).json({ error:'ID exists' });
  await new Employee({ id, name, dept, email, password }).save();
  res.json({ ok:true });
});
app.delete('/api/employees/:id', async (req,res) => {
  try {
    const result = await Employee.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error:'Employee not found' });
    res.json({ ok:true });
  } catch(err) { res.status(500).json({ error:'Server error' }); }
});

// ================= SETTINGS =================
app.get('/api/settings', async (req,res) => {
  try {
    const s = await getSettings();
    res.json({ workHours:s.workHours, startTime:s.startTime, endTime:s.endTime,
               graceMins:s.graceMins, breakMins:s.breakMins,
               session1Start:s.session1Start, session1End:s.session1End,
               session2Start:s.session2Start, session2End:s.session2End,
               adminPhone:s.adminPhone });
  } catch(err) { res.status(500).json({ error:'Could not load settings' }); }
});
app.put('/api/settings', async (req,res) => {
  try {
    const { workHours, startTime, endTime, graceMins, breakMins,
            session1Start, session1End, session2Start, session2End, adminPhone } = req.body;
    const s = await Settings.findOneAndUpdate(
      { key:'main' },
      { $set:{ workHours, startTime, endTime, graceMins, breakMins,
               session1Start, session1End, session2Start, session2End, adminPhone } },
      { new:true, upsert:true, setDefaultsOnInsert:true }
    );
    res.json({ workHours:s.workHours, startTime:s.startTime, endTime:s.endTime,
               graceMins:s.graceMins, breakMins:s.breakMins,
               session1Start:s.session1Start, session1End:s.session1End,
               session2Start:s.session2Start, session2End:s.session2End,
               adminPhone:s.adminPhone });
  } catch(err) { res.status(500).json({ error:'Could not save settings' }); }
});

// ================= LEAVES (apply & view only — no approval) =================
function formatLeave(l) {
  return { id:l.leaveId, empId:l.empId, name:l.name, type:l.type,
           from:l.from, to:l.to, reason:l.reason, status:l.status, applied:l.applied };
}
app.get('/api/leaves',        async (req,res) => res.json((await Leave.find().sort({_id:-1})).map(formatLeave)));
app.get('/api/leaves/:empId', async (req,res) => res.json((await Leave.find({empId:req.params.empId}).sort({_id:-1})).map(formatLeave)));
app.post('/api/leaves', async (req,res) => {
  try {
    const leaveId = Date.now().toString();
    await new Leave({ leaveId, empId:req.body.empId, name:req.body.name, type:req.body.type,
                      from:req.body.from, to:req.body.to, reason:req.body.reason,
                      status:'pending', applied:today() }).save();
    res.json({ ok:true });
  } catch(err) { res.status(500).json({ error:'Could not save leave request' }); }
});

// ================= ATTENDANCE =================
app.get('/api/attendance',         async (req,res) => res.json(await Attendance.find().sort({date:-1})));
app.get('/api/attendance/:empId',  async (req,res) => res.json(await Attendance.find({empId:req.params.empId})));

// ================= CHECK-IN =================
app.post('/api/checkin', async (req,res) => {
  const { empId, name, checkIn, status } = req.body;
  const date = today();
  const cfg = await getSettings();

  let rec = await Attendance.findOne({ empId, date });
  if (!rec) {
    rec = new Attendance({ empId, name, date, sessions:[], totalWork:'0h 00m', status: status||'present' });
  }

  const open = rec.sessions.find(s => s.in && !s.out);
  if (open) return res.json({ error:'Already clocked in' });
  if (rec.sessions.length >= 2) return res.json({ error:'Both sessions already completed.' });

  // Enforce minimum break between sessions
  if (rec.sessions.length >= 1) {
    const last = rec.sessions[rec.sessions.length - 1];
    if (last && last.out) {
      const [oh, om] = last.out.split(':').map(Number);
      const [ih, im] = checkIn.split(':').map(Number);
      const breakTaken = (ih*60+im) - (oh*60+om);
      if (breakTaken < cfg.breakMins) {
        const remaining = cfg.breakMins - breakTaken;
        return res.json({ error:`Break not complete. ${remaining} min(s) remaining (${cfg.breakMins}-min break required).` });
      }
    }
  }

  // Late detection for THIS session
  const [ih, im] = checkIn.split(':').map(Number);
  const nowMin = ih*60 + im;
  let lateNote = '';

  if (rec.sessions.length === 0) {
    // Session 1: late if after startTime + grace
    const [sh, sm] = cfg.startTime.split(':').map(Number);
    if (nowMin > sh*60 + sm + cfg.graceMins) {
      lateNote = `Late S1 @${checkIn}`;
      rec.status = 'late';
    }
  } else {
    // Session 2: late if after session2Start + grace
    const [s2h, s2m] = cfg.session2Start.split(':').map(Number);
    if (nowMin > s2h*60 + s2m + cfg.graceMins) {
      lateNote = `Late S2 @${checkIn}`;
      if (rec.status === 'present') rec.status = 'late';
    }
  }

  rec.sessions.push({ in: checkIn, out: null, lateNote });
  await rec.save();
  await Activity.create({ type:'checkin', empId, name, time:checkIn, date });

  res.json({ ok:true, rec, late: !!lateNote, lateNote, adminPhone: cfg.adminPhone });
});

// ================= CHECK-OUT =================
app.post('/api/checkout', async (req,res) => {
  const { empId, checkOut } = req.body;
  const date = today();

  const rec = await Attendance.findOne({ empId, date });
  if (!rec) return res.json({ error:'No record' });

  const open = rec.sessions.find(s => s.in && !s.out);
  if (!open) return res.json({ error:'No active session' });

  open.out = checkOut;
  const total = calcTotalSeconds(rec.sessions);
  rec.totalWork = secsToStr(total);

  // ATTENDANCE RULE:
  // Present  = both sessions clocked out
  // Half day = only session 1 clocked out (session 2 never started)
  // Late     = keep if either session was late (overrides present but not half day)
  const completedSessions = rec.sessions.filter(s => s.in && s.out).length;
  const wasLate = rec.status === 'late';

  if (completedSessions >= 2) {
    if (!wasLate) rec.status = 'present';
    // if wasLate, keep 'late'
  } else {
    rec.status = 'half day';
  }

  await rec.save();
  await Activity.create({ type:'checkout', empId, name:rec.name, time:checkOut, date });
  res.json(rec);
});

// ================= ACTIVITY =================
app.get('/api/activity', async (req,res) => {
  res.json(await Activity.find().sort({_id:-1}).limit(100));
});

// ================= START =================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
