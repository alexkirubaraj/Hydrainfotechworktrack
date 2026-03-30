const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// ================== MONGODB CONNECT ==================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

// ================== SCHEMA ==================
const AttendanceSchema = new mongoose.Schema({
  empId: String,
  name: String,
  date: String,
  sessions: [
    {
      checkIn: String,
      checkOut: String
    }
  ],
  totalWork: String,
  status: String
});

const ActivitySchema = new mongoose.Schema({
  type: String,
  empId: String,
  name: String,
  time: String,
  date: String,
  status: String
});

const Attendance = mongoose.model('Attendance', AttendanceSchema);
const Activity = mongoose.model('Activity', ActivitySchema);

// ================== HELPERS ==================
function today() {
  return new Date().toISOString().split('T')[0];
}

function calculateDuration(sessions) {
  let totalMs = 0;

  sessions.forEach(s => {
    if (s.checkIn && s.checkOut) {
      const start = new Date(`1970-01-01T${s.checkIn}`);
      const end = new Date(`1970-01-01T${s.checkOut}`);
      totalMs += (end - start);
    }
  });

  const hrs = Math.floor(totalMs / (1000 * 60 * 60));
  const mins = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${hrs}h ${mins}m`;
}

// ================== CHECK-IN ==================
app.post('/api/checkin', async (req, res) => {
  const { empId, name, checkIn, status } = req.body;
  const date = today();

  let record = await Attendance.findOne({ empId, date });

  if (!record) {
    // First session
    record = new Attendance({
      empId,
      name,
      date,
      sessions: [{ checkIn, checkOut: null }],
      totalWork: '-',
      status
    });
  } else {
    // Second session
    if (record.sessions.length >= 2) {
      return res.json({ message: "Already checked in twice today" });
    }

    record.sessions.push({ checkIn, checkOut: null });
  }

  await record.save();

  await Activity.create({
    type: 'checkin',
    empId,
    name,
    time: checkIn,
    date,
    status
  });

  res.json(record);
});

// ================== CHECK-OUT ==================
app.post('/api/checkout', async (req, res) => {
  const { empId, checkOut } = req.body;
  const date = today();

  let record = await Attendance.findOne({ empId, date });

  if (!record) return res.json({ message: "No check-in found" });

  const lastSession = record.sessions[record.sessions.length - 1];

  if (!lastSession || lastSession.checkOut) {
    return res.json({ message: "Already checked out" });
  }

  lastSession.checkOut = checkOut;

  // Calculate total work
  record.totalWork = calculateDuration(record.sessions);

  // Status logic
  const totalHours = parseInt(record.totalWork);

  if (totalHours >= 9) {
    record.status = "Full Day";
  } else {
    record.status = "Half - You are absent";
  }

  await record.save();

  await Activity.create({
    type: 'checkout',
    empId,
    name: record.name,
    time: checkOut,
    date,
    status: record.status
  });

  res.json(record);
});

// ================== GET ATTENDANCE ==================
app.get('/api/attendance', async (req, res) => {
  const data = await Attendance.find().sort({ date: -1 });
  res.json(data);
});

// ================== GET ACTIVITY ==================
app.get('/api/activity', async (req, res) => {
  const data = await Activity.find().sort({ _id: -1 }).limit(100);
  res.json(data);
});

// ================== SERVER ==================
app.listen(PORT, () => {
  console.log(`\n🚀 WorkTrack Server Running on port ${PORT}`);
});