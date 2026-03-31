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

// ================= ROUTES =================

// Serve pages
app.get('/', (req,res)=>res.redirect('/employee'));

app.get('/admin', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','admin.html'));
});

app.get('/employee', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','employee.html'));
});

// ================= AUTH =================
app.post('/api/auth/admin', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Simple hardcoded admin (for now)
    if (username === 'admin' && password === 'admin123') {
      return res.json({
        ok: true,
        name: 'Admin',
        username: 'admin'
      });
    }

    if (username === 'admin2' && password === 'admin456') {
      return res.json({
        ok: true,
        name: 'Admin 2',
        username: 'admin2'
      });
    }

    return res.status(401).json({
      ok: false,
      error: 'Invalid credentials'
    });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
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
  const { id,name,password } = req.body;

  const exists = await Employee.findOne({ id });
  if (exists) return res.status(400).json({ error:'ID exists' });

  const emp = new Employee({ id,name,password });
  await emp.save();

  res.json(emp);
});

// ================= ATTENDANCE =================
app.get('/api/attendance', async (req,res)=>{
  const data = await Attendance.find();
  res.json(data);
});

app.get('/api/attendance/:id', async (req,res)=>{
  const data = await Attendance.find({ empId:req.params.id });
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

  const completed = rec.sessions.filter(s=>s.in && s.out).length;
  const open = rec.sessions.find(s=>s.in && !s.out);

  if (completed >= 2)
    return res.json({ error:'Already completed 2 sessions' });

  if (open)
    return res.json({ error:'Already clocked in' });

  let lateMsg = null;

  if (rec.sessions.length === 1 && rec.sessions[0].out) {
    const [h,m] = rec.sessions[0].out.split(':').map(Number);
    const expected = h*60 + m + 45;

    const [ch,cm] = checkIn.split(':').map(Number);
    const actual = ch*60 + cm;

    if (actual > expected) {
      lateMsg = `Late by ${actual-expected} mins`;
    }
  }

  rec.sessions.push({ in:checkIn, out:null, lateNote:lateMsg });

  await rec.save();

  await Activity.create({
    type:'checkin',
    empId,
    name,
    time:checkIn,
    date
  });

  res.json({ rec, lateMsg });
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

  const completed = rec.sessions.filter(s=>s.in && s.out).length;

  if (completed >= 2 && total < 9*3600) {
    rec.status = 'absent';
  }

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