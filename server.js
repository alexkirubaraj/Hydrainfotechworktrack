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
  sessions: [
    {
      in: String,
      out: String,
      lateNote: String
    }
  ],
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

// ✅ FIX 1: Settings stored in MongoDB (persists across restarts)
const SettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'main' },
  workHours: { type: Number, default: 9 },
  startTime: { type: String, default: '09:30' },
  endTime: { type: String, default: '18:30' },
  graceMins: { type: Number, default: 15 },
  breakMins: { type: Number, default: 45 }
});
const Settings = mongoose.model('Settings', SettingsSchema);

// ✅ FIX 2: Leaves stored in MongoDB (persists across restarts)
const LeaveSchema = new mongoose.Schema({
  id: { type: String, default: () => Date.now().toString() },
  empId: String,
  name: String,
  type: String,
  from: String,
  to: String,
  reason: String,
  status: { type: String, default: 'pending' },
  applied: { type: String, default: () => new Date().toISOString().split('T')[0] }
});
const Leave = mongoose.model('Leave', LeaveSchema);

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

// Helper: get or create settings doc
async function getSettings() {
  let s = await Settings.findOne({ key: 'main' });
  if (!s) {
    s = await Settings.create({ key: 'main' });
  }
  return s;
}

// ================= ROUTES =================

// Pages
app.get('/', (req,res)=>res.redirect('/employee'));

app.get('/admin', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','admin.html'));
});

app.get('/employee', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','employee.html'));
});

// ================= AUTH =================
app.post('/api/auth/admin', (req, res) => {
  const { username, password } = req.body;

  if (username === 'Vivin' && password === 'Vivin1234') {
    return res.json({ ok:true, name:'Vivin', username:'Vivin' });
  }

  if (username === 'Alex' && password === 'Alex4321') {
    return res.json({ ok:true, name:'Alex', username:'Alex' });
  }

  res.status(401).json({ ok:false, error:'Invalid credentials' });
});

app.post('/api/auth/employee', async (req,res)=>{
  const { empId, password } = req.body;

  const user = await Employee.findOne({ id: empId });

  if (!user || user.password !== password) {
    return res.status(401).json({ ok:false, error:'Invalid credentials' });
  }

  res.json({ ok:true, emp:user });
});

// ================= EMPLOYEES =================
app.get('/api/employees', async (req,res)=>{
  const data = await Employee.find();
  res.json(data);
});

app.post('/api/employees', async (req,res)=>{
  const { id, name, dept, email, password } = req.body;

  if (!id || !name || !dept || !email || !password) {
    return res.status(400).json({ error:'All fields required' });
  }

  const exists = await Employee.findOne({ id });
  if (exists) return res.status(400).json({ error:'ID exists' });

  const emp = new Employee({ id, name, dept, email, password });
  await emp.save();

  res.json({ ok:true });
});

app.delete('/api/employees/:id', async (req,res)=>{
  try {
    const result = await Employee.deleteOne({ id: req.params.id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error:'Employee not found' });
    }

    res.json({ ok:true });

  } catch (err) {
    res.status(500).json({ error:'Server error' });
  }
});

// ================= SETTINGS (✅ NOW PERSISTED IN MONGODB) =================
app.get('/api/settings', async (req,res)=>{
  const s = await getSettings();
  res.json({
    workHours: s.workHours,
    startTime: s.startTime,
    endTime: s.endTime,
    graceMins: s.graceMins,
    breakMins: s.breakMins
  });
});

app.put('/api/settings', async (req,res)=>{
  const { workHours, startTime, endTime, graceMins, breakMins } = req.body;
  const s = await Settings.findOneAndUpdate(
    { key: 'main' },
    { workHours, startTime, endTime, graceMins, breakMins },
    { new: true, upsert: true }
  );
  res.json({
    workHours: s.workHours,
    startTime: s.startTime,
    endTime: s.endTime,
    graceMins: s.graceMins,
    breakMins: s.breakMins
  });
});

// ================= LEAVES (✅ NOW PERSISTED IN MONGODB) =================
app.get('/api/leaves', async (req,res)=>{
  const data = await Leave.find().sort({ id: -1 });
  res.json(data);
});

app.get('/api/leaves/:empId', async (req,res)=>{
  const data = await Leave.find({ empId: req.params.empId }).sort({ id: -1 });
  res.json(data);
});

app.post('/api/leaves', async (req,res)=>{
  const leave = new Leave({
    id: Date.now().toString(),
    ...req.body,
    status: 'pending',
    applied: today()
  });
  await leave.save();
  res.json({ ok:true });
});

app.put('/api/leaves/:id', async (req,res)=>{
  await Leave.findOneAndUpdate(
    { id: req.params.id },
    { status: req.body.status }
  );
  res.json({ ok:true });
});

// ================= ATTENDANCE =================
app.get('/api/attendance', async (req,res)=>{
  const data = await Attendance.find().sort({ date: -1 });
  res.json(data);
});

app.get('/api/attendance/:empId', async (req,res)=>{
  const data = await Attendance.find({ empId: req.params.empId });
  res.json(data);
});

// ================= CHECK-IN =================
app.post('/api/checkin', async (req,res)=>{
  const { empId,name,checkIn,status } = req.body;
  const date = today();

  let rec = await Attendance.findOne({ empId,date });

  if (!rec) {
    rec = new Attendance({
      empId,
      name,
      date,
      sessions: [],
      totalWork: '0h 00m',
      status: status || 'present'
    });
  }

  const open = rec.sessions.find(s=>s.in && !s.out);
  if (open) return res.json({ error:'Already clocked in' });

  rec.sessions.push({ in:checkIn, out:null });

  await rec.save();

  await Activity.create({
    type:'checkin',
    empId,
    name,
    time:checkIn,
    date
  });

  res.json({ ok:true });
});

// ================= CHECK-OUT =================
app.post('/api/checkout', async (req,res)=>{
  const { empId, checkOut } = req.body;
  const date = today();

  const rec = await Attendance.findOne({ empId,date });

  if (!rec) return res.json({ error:'No record' });

  const open = rec.sessions.find(s=>s.in && !s.out);
  if (!open) return res.json({ error:'No active session' });

  open.out = checkOut;

  const total = calcTotalSeconds(rec.sessions);
  rec.totalWork = secsToStr(total);

  await rec.save();

  await Activity.create({
    type:'checkout',
    empId,
    name:rec.name,
    time:checkOut,
    date
  });

  res.json(rec);
});

// ================= ACTIVITY =================
app.get('/api/activity', async (req,res)=>{
  const data = await Activity.find().sort({_id:-1}).limit(100);
  res.json(data);
});

// ================= START =================
app.listen(PORT, ()=>{
  console.log(`🚀 Server running on port ${PORT}`);
});
