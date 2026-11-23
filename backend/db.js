const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(process.env.DB_PATH || 'backend/school_hub.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'teacher', 'student')),
    form_level TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    UNIQUE(form_id, subject_id, title)
  );

  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('lecture_note', 'past_question', 'syllabus', 'video_guide', 'other')),
    form_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    topic_id INTEGER,
    uploaded_by INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (form_id) REFERENCES forms(id),
    FOREIGN KEY (subject_id) REFERENCES subjects(id),
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    resource_id INTEGER,
    action TEXT NOT NULL CHECK(action IN ('view', 'download', 'offline_cache')),
    accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );
`);

function seedInitialData() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (full_name, username, password_hash, role, form_level)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertUser.run('System Administrator', 'admin01', bcrypt.hashSync('Admin@123', 10), 'admin', null);
    insertUser.run('Mr. Kwame Mensah', 'teacher01', bcrypt.hashSync('Teacher@123', 10), 'teacher', null);
    insertUser.run('Ama Serwaa', 'student01', bcrypt.hashSync('Student@123', 10), 'student', 'SHS 2');
  }

  const formCount = db.prepare('SELECT COUNT(*) AS count FROM forms').get().count;
  if (formCount === 0) {
    const insertForm = db.prepare('INSERT INTO forms (name, sort_order) VALUES (?, ?)');
    insertForm.run('SHS 1', 1);
    insertForm.run('SHS 2', 2);
    insertForm.run('SHS 3', 3);
  }

  const subjectCount = db.prepare('SELECT COUNT(*) AS count FROM subjects').get().count;
  if (subjectCount === 0) {
    const insertSubject = db.prepare('INSERT INTO subjects (name) VALUES (?)');
    ['Core Mathematics', 'Integrated Science', 'English Language', 'ICT'].forEach((s) => insertSubject.run(s));
  }

  const topicCount = db.prepare('SELECT COUNT(*) AS count FROM topics').get().count;
  if (topicCount === 0) {
    const shs1 = db.prepare("SELECT id FROM forms WHERE name = 'SHS 1'").get();
    const shs2 = db.prepare("SELECT id FROM forms WHERE name = 'SHS 2'").get();
    const ict = db.prepare("SELECT id FROM subjects WHERE name = 'ICT'").get();
    const math = db.prepare("SELECT id FROM subjects WHERE name = 'Core Mathematics'").get();

    const insertTopic = db.prepare('INSERT OR IGNORE INTO topics (form_id, subject_id, title) VALUES (?, ?, ?)');
    if (shs1 && ict) insertTopic.run(shs1.id, ict.id, 'Introduction to Computing & Hardware');
    if (shs2 && ict) insertTopic.run(shs2.id, ict.id, 'Computer Networks & Internet Basics');
    if (shs2 && math) insertTopic.run(shs2.id, math.id, 'Quadratic Equations & Inequalities');
  }
}

seedInitialData();

module.exports = db;