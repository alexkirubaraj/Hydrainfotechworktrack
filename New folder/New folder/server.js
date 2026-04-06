const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

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
  id: String,
  name: String,
  dept: String,
  email: String,
  password: String
}));

const Attendance = mongoose.model('Attendance', new mongoose.Schema({
  empId: String,
  name: String,
  date: String,
  sessions: [{ in: String, out: String, lateNote: String }],
  totalWork: String,
  status: String
}));

const Activity = mongoose.model('Activity', new mongoose.Schema({
  type: String,
  empId: String,
  name: String,
  time: String,
  date: String
}));

// FIX: key field is required (not default) so findOne({key:'main'}) always works
const Settings = mongoose.model('Settings', new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  workHours: { type: Number, default: 8 },
  startTime: { type: String, default: '09:30' },
  endTime:   { type: String, default: '18:15' },
  graceMins: { type: Number, default: 15 },
  breakMins: { type: Number, default: 45 }
}));

// FIX: renamed 'id' → 'leaveId' to avoid conflict with Mongoose's built-in id virtual
const Leave = mongoose.model('Leave', new mongoose.Schema({
  leaveId:  { type: String },
  empId:    String,
  name:     String,
  type:     String,
  from:     String,
  to:       String,
  reason:   String,
  status:   { type: String, default: 'pending' },
  applied:  String
}));

// ================= HELPERS =================
function today() {
  return new Date().toISOString().split('T')[0];
}

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
  const h = Math.floor(secs/3600);
  const m = Math.floor((secs%3600)/60);
  return `${h}h ${String(m).padStart(2,'0')}m`;
}

// Get or create the single settings document
async function getSettings() {
  let s = await Settings.findOne({ key: 'main' });
  if (!s) {
    s = await Settings.create({
      key: 'main', workHours: 8, startTime: '09:30',
      endTime: '18:15', graceMins: 15, breakMins: 45
    });
    console.log('✅ Default settings created in MongoDB');
  }
  return s;
}

// ================= ROUTES =================
app.get('/', (req,res) => res.redirect('/employee'));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/employee', (req,res) => res.sendFile(path.join(__dirname,'public','employee.html')));

// ================= AUTH =================
app.post('/api/auth/admin', (req, res) => {
  const { username, password } = req.body;
  if (username === 'Vivin' && password === 'Vivin1234')
    return res.json({ ok:true, name:'Vivin', username:'Vivin' });
  if (username === 'Alex' && password === 'Alex4321')
    return res.json({ ok:true, name:'Alex', username:'Alex' });
  res.status(401).json({ ok:false, error:'Invalid credentials' });
});

app.post('/api/auth/employee', async (req,res) => {
  const { empId, password } = req.body;
  const user = await Employee.findOne({ id: empId });
  if (!user || user.password !== password)
    return res.status(401).json({ ok:false, error:'Invalid credentials' });
  res.json({ ok:true, emp:user });
});

// ================= EMPLOYEES =================
app.get('/api/employees', async (req,res) => {
  res.json(await Employee.find());
});

app.post('/api/employees', async (req,res) => {
  const { id, name, dept, email, password } = req.body;
  if (!id || !name || !dept || !email || !password)
    return res.status(400).json({ error:'All fields required' });
  if (await Employee.findOne({ id }))
    return res.status(400).json({ error:'ID exists' });
  await new Employee({ id, name, dept, email, password }).save();
  res.json({ ok:true });
});

app.delete('/api/employees/:id', async (req,res) => {
  try {
    const result = await Employee.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0)
      return res.status(404).json({ error:'Employee not found' });
    res.json({ ok:true });
  } catch(err) {
    res.status(500).json({ error:'Server error' });
  }
});

// ================= SETTINGS — persisted in MongoDB =================
app.get('/api/settings', async (req,res) => {
  try {
    const s = await getSettings();
    res.json({
      workHours: s.workHours, startTime: s.startTime,
      endTime: s.endTime, graceMins: s.graceMins, breakMins: s.breakMins
    });
  } catch(err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

app.put('/api/settings', async (req,res) => {
  try {
    const { workHours, startTime, endTime, graceMins, breakMins } = req.body;
    // FIX: use $set so the 'key' field is never overwritten
    const s = await Settings.findOneAndUpdate(
      { key: 'main' },
      { $set: { workHours, startTime, endTime, graceMins, breakMins } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    console.log('✅ Settings saved:', s.workHours, 'hrs,', s.startTime, '-', s.endTime);
    res.json({
      workHours: s.workHours, startTime: s.startTime,
      endTime: s.endTime, graceMins: s.graceMins, breakMins: s.breakMins
    });
  } catch(err) {
    console.error('PUT /api/settings error:', err);
    res.status(500).json({ error: 'Could not save settings' });
  }
});

// ================= LEAVES — persisted in MongoDB =================

// FIX: map leaveId → id so the frontend still sees { id: "..." }
function formatLeave(l) {
  return {
    id:      l.leaveId,
    empId:   l.empId,
    name:    l.name,
    type:    l.type,
    from:    l.from,
    to:      l.to,
    reason:  l.reason,
    status:  l.status,
    applied: l.applied
  };
}

app.get('/api/leaves', async (req,res) => {
  const data = await Leave.find().sort({ _id: -1 });
  res.json(data.map(formatLeave));
});

app.get('/api/leaves/:empId', async (req,res) => {
  const data = await Leave.find({ empId: req.params.empId }).sort({ _id: -1 });
  res.json(data.map(formatLeave));
});

app.post('/api/leaves', async (req,res) => {
  try {
    const leaveId = Date.now().toString();
    const leave = new Leave({
      leaveId,
      empId:   req.body.empId,
      name:    req.body.name,
      type:    req.body.type,
      from:    req.body.from,
      to:      req.body.to,
      reason:  req.body.reason,
      status:  'pending',
      applied: today()
    });
    await leave.save();
    console.log('✅ Leave saved, leaveId:', leaveId);
    res.json({ ok:true });
  } catch(err) {
    console.error('POST /api/leaves error:', err);
    res.status(500).json({ error: 'Could not save leave request' });
  }
});

app.put('/api/leaves/:id', async (req,res) => {
  try {
    await Leave.findOneAndUpdate(
      { leaveId: req.params.id },
      { $set: { status: req.body.status } }
    );
    res.json({ ok:true });
  } catch(err) {
    console.error('PUT /api/leaves error:', err);
    res.status(500).json({ error: 'Could not update leave' });
  }
});

// ================= ATTENDANCE =================
app.get('/api/attendance', async (req,res) => {
  const data = await Attendance.find().sort({ date: -1 });
  res.json(data);
});

app.get('/api/attendance/:empId', async (req,res) => {
  const data = await Attendance.find({ empId: req.params.empId });
  res.json(data);
});

// ================= CHECK-IN =================
app.post('/api/checkin', async (req,res) => {
  const { empId, name, checkIn, status } = req.body;
  const date = today();

  let rec = await Attendance.findOne({ empId, date });
  if (!rec) {
    rec = new Attendance({
      empId, name, date, sessions: [],
      totalWork: '0h 00m', status: status || 'present'
    });
  }

  const open = rec.sessions.find(s => s.in && !s.out);
  if (open) return res.json({ error:'Already clocked in' });

  // Enforce 45-minute minimum break between sessions
  if (rec.sessions.length >= 1) {
    const settings = await Settings.findOne({ key: 'main' });
    const breakMins = settings ? settings.breakMins : 45;
    const lastSession = rec.sessions[rec.sessions.length - 1];
    if (lastSession && lastSession.out) {
      const [oh, om] = lastSession.out.split(':').map(Number);
      const [ih, im] = checkIn.split(':').map(Number);
      const breakTaken = (ih * 60 + im) - (oh * 60 + om);
      if (breakTaken < breakMins) {
        const remaining = breakMins - breakTaken;
        return res.json({ error: `Break not complete. ${remaining} min(s) remaining (${breakMins}-min break required).` });
      }
    }
  }

  rec.sessions.push({ in: checkIn, out: null });
  await rec.save();

  await Activity.create({ type:'checkin', empId, name, time:checkIn, date });
  res.json({ ok:true });
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

  // Status logic:
  // - Both sessions completed AND worked >= (workHours - breakMins) => 'present'
  // - Only session 1 completed (clocked out before session 2) => 'half day present'
  // - Late on session 1 check-in => keep 'late'
  const settings = await Settings.findOne({ key: 'main' });
  const targetSecs = (settings ? settings.workHours : 8) * 3600;
  const breakSecs  = (settings ? settings.breakMins  : 45) * 60;
  const completedSessions = rec.sessions.filter(s => s.in && s.out).length;

  if (completedSessions >= 2 && total >= (targetSecs - breakSecs - 300)) {
    // full day: both sessions done and enough hours worked (5min tolerance)
    if (rec.status !== 'late') rec.status = 'present';
  } else {
    // only session 1 done, or insufficient hours
    rec.status = 'half day present';
  }

  await rec.save();

  await Activity.create({ type:'checkout', empId, name:rec.name, time:checkOut, date });
  res.json(rec);
});

// ================= ACTIVITY =================
app.get('/api/activity', async (req,res) => {
  const data = await Activity.find().sort({ _id:-1 }).limit(100);
  res.json(data);
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
