const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../models/User');
const DSR = require('../models/DSR');
const Attendance = require('../models/Attendance');
const CallLog = require('../models/CallLog');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB Connected for seeding');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// Sample users data
const sampleUsers = [
  {
    name: 'Super Admin',
    email: 'admin@example.com',
    phone: '9999999999',
    role: 'super_admin',
    territory: 'All India',
    team: 'Management',
    password: 'password'
  },
  {
    name: 'John Manager',
    email: 'manager@example.com',
    phone: '9999999998',
    role: 'manager',
    territory: 'North India',
    team: 'Team Alpha',
    password: 'password'
  },
  {
    name: 'Sarah Manager',
    email: 'manager2@example.com',
    phone: '9999999997',
    role: 'manager',
    territory: 'South India',
    team: 'Team Beta',
    password: 'password'
  },
  {
    name: 'Alice Caller',
    email: 'caller@example.com',
    phone: '9999999996',
    role: 'tele_caller',
    territory: 'Delhi NCR',
    team: 'Team Alpha',
    password: 'password',
    managerId: null // Will be set later
  },
  {
    name: 'Bob Caller',
    email: 'caller2@example.com',
    phone: '9999999995',
    role: 'tele_caller',
    territory: 'Mumbai',
    team: 'Team Alpha',
    password: 'password',
    managerId: null // Will be set later
  },
  {
    name: 'Charlie Caller',
    email: 'caller3@example.com',
    phone: '9999999994',
    role: 'tele_caller',
    territory: 'Bangalore',
    team: 'Team Beta',
    password: 'password',
    managerId: null // Will be set later
  },
  {
    name: 'Diana HR',
    email: 'hr@example.com',
    phone: '9999999993',
    role: 'hr',
    territory: 'Pan India',
    team: 'HR Department',
    password: 'password',
    managerId: null // Will be set later
  },
  {
    name: 'Eve HR',
    email: 'hr2@example.com',
    phone: '9999999992',
    role: 'hr',
    territory: 'Pan India',
    team: 'HR Department',
    password: 'password',
    managerId: null // Will be set later
  }
];

// Sample call statuses for different roles
const teleCallerStatuses = [
  'answered', 'not_answered', 'follow_up', 'converted'
];

const hrStatuses = [
  'interview_scheduled', 'interview_conducted', 'joined', 'not_answered', 'follow_up'
];

// Helper function to get random date in last 30 days
const getRandomDate = (daysBack = 30) => {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
  return date;
};

// Helper function to get random time
const getRandomTime = (baseDate) => {
  const time = new Date(baseDate);
  time.setHours(9 + Math.floor(Math.random() * 9)); // 9 AM to 6 PM
  time.setMinutes(Math.floor(Math.random() * 60));
  return time;
};

// Create users with hashed passwords
const createUsers = async () => {
  console.log('🔄 Creating users...');
  
  const users = [];
  
  // First, create super_admin and managers (who don't need managerId)
  const managerUsers = sampleUsers.filter(user => 
    user.role === 'super_admin' || user.role === 'manager'
  );
  
  for (const userData of managerUsers) {
    const userDataCopy = { ...userData };
    delete userDataCopy.managerId; // Remove managerId for managers
    
    const user = new User({
      ...userDataCopy
    });
    
    const savedUser = await user.save();
    users.push(savedUser);
    console.log(`✅ Created user: ${user.name} (${user.role})`);
  }
  
  // Get managers for assignment
  const managers = users.filter(user => user.role === 'manager');
  const johnManager = managers.find(m => m.name === 'John Manager');
  const sarahManager = managers.find(m => m.name === 'Sarah Manager');
  
  // Then create other users (tele_caller, hr) with assigned managers
  const otherUsers = sampleUsers.filter(user => 
    user.role === 'tele_caller' || user.role === 'hr'
  );
  
  for (const userData of otherUsers) {
    // Assign manager based on team
    let managerId;
    if (userData.team === 'Team Alpha' && johnManager) {
      managerId = johnManager._id;
    } else if (userData.team === 'Team Beta' && sarahManager) {
      managerId = sarahManager._id;
    } else if (userData.role === 'hr' && johnManager) {
      managerId = johnManager._id; // HR reports to first manager
    }
    
    const user = new User({
      ...userData,
      managerId: managerId
    });
    
    const savedUser = await user.save();
    users.push(savedUser);
    console.log(`✅ Created user: ${user.name} (${user.role})`);
  }
  
  return users;
};

// Create sample call logs
const createCallLogs = async (users) => {
  console.log('🔄 Creating call logs...');
  
  const callLogs = [];
  const callers = users.filter(user => user.role === 'tele_caller');
  const hrUsers = users.filter(user => user.role === 'hr');
  
  // Create call logs for tele-callers
  for (const caller of callers) {
    for (let i = 0; i < 20; i++) {
      const date = getRandomDate(7); // Last 7 days
      const hasFollowup = Math.random() > 0.7; // 30% follow-ups
      let callStatus = teleCallerStatuses[Math.floor(Math.random() * teleCallerStatuses.length)];
      
      // If callStatus is follow_up, ensure followupDate is set
      if (callStatus === 'follow_up' && !hasFollowup) {
        callStatus = 'answered'; // Change to answered if no followup
      } else if (hasFollowup && callStatus !== 'follow_up') {
        callStatus = 'follow_up'; // Set to follow_up if followup is needed
      }
      
      const callLog = new CallLog({
        userId: caller._id,
        leadId: `LD${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        callStatus: callStatus,
        comment: `Sample call log ${i + 1} for lead tracking`,
        followupDate: callStatus === 'follow_up' ? getRandomDate(-5) : null,
        createdAt: date
      });
      
      const savedCallLog = await callLog.save();
      callLogs.push(savedCallLog);
    }
    console.log(`✅ Created 20 call logs for ${caller.name}`);
  }
  
  // Create call logs for HR users
  for (const hrUser of hrUsers) {
    for (let i = 0; i < 15; i++) {
      const date = getRandomDate(7);
      const hasFollowup = Math.random() > 0.6; // 40% follow-ups
      let callStatus = hrStatuses[Math.floor(Math.random() * hrStatuses.length)];
      
      // If callStatus is follow_up, ensure followupDate is set
      if (callStatus === 'follow_up' && !hasFollowup) {
        callStatus = 'interview_scheduled'; // Change to scheduled if no followup
      } else if (hasFollowup && callStatus !== 'follow_up') {
        callStatus = 'follow_up'; // Set to follow_up if followup is needed
      }
      
      const callLog = new CallLog({
        userId: hrUser._id,
        leadId: `CA${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
        callStatus: callStatus,
        comment: `HR call log ${i + 1} for candidate screening`,
        followupDate: callStatus === 'follow_up' ? getRandomDate(-3) : null,
        createdAt: date
      });
      
      const savedCallLog = await callLog.save();
      callLogs.push(savedCallLog);
    }
    console.log(`✅ Created 15 call logs for ${hrUser.name}`);
  }
  
  return callLogs;
};

// Create sample DSRs
const createDSRs = async (users, callLogs) => {
  console.log('🔄 Creating DSRs...');
  
  const dsrs = [];
  const nonAdmins = users.filter(user => user.role !== 'super_admin');
  
  for (const user of nonAdmins) {
    // Create DSRs for last 7 days
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      // Get call logs for this user and date
      const dayCallLogs = callLogs.filter(log => 
        log.userId.toString() === user._id.toString() &&
        log.createdAt.toDateString() === date.toDateString()
      );
      
      if (dayCallLogs.length > 0) {
        let dsrData = {
          userId: user._id,
          date: date,
          callLogs: dayCallLogs.map(log => log._id),
          isSubmitted: Math.random() > 0.3, // 70% submitted
          isLocked: Math.random() > 0.5, // 50% locked
          finalRemarks: `Daily work summary for ${date.toDateString()}`
        };
        
        if (user.role === 'tele_caller') {
          // Tele-caller specific metrics
          dsrData = {
            ...dsrData,
            totalCalls: dayCallLogs.length,
            totalFollowups: dayCallLogs.filter(log => log.followupDate).length,
            notAnswered: dayCallLogs.filter(log => log.callStatus === 'not_answered').length,
            converted: dayCallLogs.filter(log => log.callStatus === 'converted').length
          };
        } else if (user.role === 'hr') {
          // HR specific metrics
          dsrData = {
            ...dsrData,
            totalCalls: dayCallLogs.length,
            interviewsScheduled: dayCallLogs.filter(log => log.callStatus === 'interview_scheduled').length,
            interviewsConducted: dayCallLogs.filter(log => log.callStatus === 'interview_conducted').length,
            joinings: dayCallLogs.filter(log => log.callStatus === 'joined').length
          };
        }
        
        const dsr = new DSR(dsrData);
        const savedDSR = await dsr.save();
        dsrs.push(savedDSR);
      }
    }
    console.log(`✅ Created DSRs for ${user.name}`);
  }
  
  return dsrs;
};

// Create sample attendance records
const createAttendance = async (users) => {
  console.log('🔄 Creating attendance records...');
  
  const attendanceRecords = [];
  const nonAdmins = users.filter(user => user.role !== 'super_admin');
  
  for (const user of nonAdmins) {
    // Create attendance for last 14 days
    for (let i = 0; i < 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      // Skip weekends (optional)
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      
      // 90% attendance rate
      if (Math.random() > 0.9) continue;
      
      const punchInTime = getRandomTime(date);
      punchInTime.setHours(9 + Math.floor(Math.random() * 2)); // 9-11 AM
      
      const punchOutTime = new Date(punchInTime);
      punchOutTime.setHours(punchInTime.getHours() + 8 + Math.random() * 2); // 8-10 hour workday
      
      const attendance = new Attendance({
        userId: user._id,
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        punchIn: {
          time: punchInTime,
          location: {
            type: 'Point',
            coordinates: [77.2090 + (Math.random() - 0.5) * 0.001, 28.6139 + (Math.random() - 0.5) * 0.001]
          },
          selfie: '/placeholder-selfie.jpg',
          address: 'Near Office Location, Delhi',
          isValidLocation: Math.random() > 0.1 // 90% valid locations
        },
        punchOut: {
          time: punchOutTime,
          location: {
            type: 'Point',
            coordinates: [77.2090 + (Math.random() - 0.5) * 0.001, 28.6139 + (Math.random() - 0.5) * 0.001]
          },
          selfie: '/placeholder-selfie.jpg',
          address: 'Near Office Location, Delhi',
          isValidLocation: Math.random() > 0.1
        },
        totalHours: (punchOutTime - punchInTime) / (1000 * 60 * 60),
        workingHours: Math.max(0, (punchOutTime - punchInTime) / (1000 * 60 * 60) - 1), // Minus 1 hour break
        status: Math.random() > 0.8 ? 'late' : 'present'
      });
      
      const savedAttendance = await attendance.save();
      attendanceRecords.push(savedAttendance);
    }
    console.log(`✅ Created attendance records for ${user.name}`);
  }
  
  return attendanceRecords;
};

// Main seeding function
const seedDatabase = async () => {
  try {
    console.log('🚀 Starting database seeding...');
    
    // Connect to database
    await connectDB();
    
    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('🧹 Clearing existing data...');
    await User.deleteMany({});
    await DSR.deleteMany({});
    await CallLog.deleteMany({});
    await Attendance.deleteMany({});
    console.log('✅ Existing data cleared');
    
    // Create sample data
    const users = await createUsers();
    
    const callLogs = await createCallLogs(users);
    const dsrs = await createDSRs(users, callLogs);
    const attendanceRecords = await createAttendance(users);
    
    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`👥 Users: ${users.length}`);
    console.log(`📞 Call Logs: ${callLogs.length}`);
    console.log(`📋 DSRs: ${dsrs.length}`);
    console.log(`⏰ Attendance Records: ${attendanceRecords.length}`);
    
    console.log('\n🔑 Login Credentials:');
    console.log('Super Admin: admin@example.com / password');
    console.log('Manager: manager@example.com / password');
    console.log('Tele-caller: caller@example.com / password');
    console.log('HR: hr@example.com / password');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

// Run seeding
if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };