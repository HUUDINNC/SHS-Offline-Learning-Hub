require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { signToken, authenticate, authorizeRoles } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'backend/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve('public')));

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'video/mp4',
  'audio/mpeg'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    cb(null, `${Date.now()}-${safeBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max per file
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: PDF, Word, PowerPoint, TXT, MP4, MP3.'));
    }
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SHS Offline Learning Hub', timestamp: new Date().toISOString() });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
      form_level: user.form_level
    }
  });
});
// Authenticated user: Change own password
app.post('/api/auth/change-password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'Current password and a new password (min 6 characters) are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(String(current_password), user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(String(new_password), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  return res.json({ message: 'Password updated successfully' });
});

// Curriculum metadata (Forms, Subjects, Topics)
app.get('/api/curriculum', authenticate, (req, res) => {
  const forms = db.prepare('SELECT * FROM forms ORDER BY sort_order ASC, id ASC').all();
  const subjects = db.prepare('SELECT * FROM subjects ORDER BY name ASC').all();
  const topics = db.prepare(`
    SELECT t.*, f.name AS form_name, s.name AS subject_name
    FROM topics t
    JOIN forms f ON f.id = t.form_id
    JOIN subjects s ON s.id = t.subject_id
    ORDER BY f.sort_order ASC, s.name ASC, t.title ASC
  `).all();

  res.json({ forms, subjects, topics });
});

// Admin or Teacher: Create topic
app.post('/api/topics', authenticate, authorizeRoles('admin', 'teacher'), (req, res) => {
  const { form_id, subject_id, title } = req.body || {};
  if (!form_id || !subject_id || !title || !String(title).trim()) {
    return res.status(400).json({ error: 'form_id, subject_id, and topic title are required' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO topics (form_id, subject_id, title) VALUES (?, ?, ?)'
    ).run(Number(form_id), Number(subject_id), String(title).trim());

    const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(topic);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Topic already exists for this form and subject' });
    }
    return res.status(500).json({ error: 'Failed to create topic' });
  }
});

// List/Search resources
app.get('/api/resources', authenticate, (req, res) => {
  const { form_id, subject_id, topic_id, resource_type, q } = req.query;
  let sql = `
    SELECT r.*,
           f.name AS form_name,
           s.name AS subject_name,
           t.title AS topic_title,
           u.full_name AS uploader_name
    FROM resources r
    JOIN forms f ON f.id = r.form_id
    JOIN subjects s ON s.id = r.subject_id
    LEFT JOIN topics t ON t.id = r.topic_id
    JOIN users u ON u.id = r.uploaded_by
    WHERE 1=1
  `;
  const params = [];

  if (form_id) {
    sql += ' AND r.form_id = ?';
    params.push(Number(form_id));
  }
  if (subject_id) {
    sql += ' AND r.subject_id = ?';
    params.push(Number(subject_id));
  }
  if (topic_id) {
    sql += ' AND r.topic_id = ?';
    params.push(Number(topic_id));
  }
  if (resource_type) {
    sql += ' AND r.resource_type = ?';
    params.push(String(resource_type));
  }
  if (q && String(q).trim()) {
    sql += ' AND (r.title LIKE ? OR r.description LIKE ? OR t.title LIKE ? OR s.name LIKE ?)';
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY r.updated_at DESC, r.id DESC';
  const resources = db.prepare(sql).all(...params);
  res.json({ resources });
});

// Teacher or Admin: Upload resource
app.post('/api/resources', authenticate, authorizeRoles('teacher', 'admin'), upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please attach a learning resource file' });
  }

  const { title, description, resource_type, form_id, subject_id, topic_id } = req.body || {};
  if (!title || !String(title).trim() || !resource_type || !form_id || !subject_id) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'title, resource_type, form_id, and subject_id are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO resources (
        title, description, resource_type, form_id, subject_id, topic_id,
        uploaded_by, file_name, original_name, mime_type, file_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(title).trim(),
      description ? String(description).trim() : '',
      String(resource_type).trim(),
      Number(form_id),
      Number(subject_id),
      topic_id ? Number(topic_id) : null,
      req.user.id,
      req.file.filename,
      req.file.originalname,
      req.file.mimetype,
      req.file.size
    );

    const created = db.prepare(`
      SELECT r.*, f.name AS form_name, s.name AS subject_name, t.title AS topic_title, u.full_name AS uploader_name
      FROM resources r
      JOIN forms f ON f.id = r.form_id
      JOIN subjects s ON s.id = r.subject_id
      LEFT JOIN topics t ON t.id = r.topic_id
      JOIN users u ON u.id = r.uploaded_by
      WHERE r.id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json(created);
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(500).json({ error: 'Failed to save resource metadata' });
  }
});

// Download / view resource file & log access
app.get('/api/resources/:id/file', authenticate, (req, res) => {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(req.params.id));
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  const fullPath = path.join(uploadDir, resource.file_name);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Stored file missing on server' });
  }

  const logAction = req.query.action === 'offline_cache' ? 'offline_cache' : 'view';
  db.prepare('INSERT INTO access_logs (user_id, resource_id, action) VALUES (?, ?, ?)').run(
    req.user.id,
    resource.id,
    logAction
  );

  res.setHeader('Content-Type', resource.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(resource.original_name)}"`);
  return res.sendFile(fullPath);
});

// Teacher (own) or Admin: Delete resource
app.delete('/api/resources/:id', authenticate, authorizeRoles('teacher', 'admin'), (req, res) => {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(req.params.id));
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  if (req.user.role !== 'admin' && resource.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete resources you uploaded' });
  }

  db.prepare('DELETE FROM resources WHERE id = ?').run(resource.id);
  const fullPath = path.join(uploadDir, resource.file_name);
  if (fs.existsSync(fullPath)) {
    fs.unlink(fullPath, () => {});
  }

  return res.json({ message: 'Resource deleted' });
});

// Admin: Basic stats & users list
app.get('/api/admin/overview', authenticate, authorizeRoles('admin'), (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    resources: db.prepare('SELECT COUNT(*) AS count FROM resources').get().count,
    topics: db.prepare('SELECT COUNT(*) AS count FROM topics').get().count,
    accessLogs: db.prepare('SELECT COUNT(*) AS count FROM access_logs').get().count
  };
  const users = db.prepare('SELECT id, full_name, username, role, form_level, is_active, created_at FROM users ORDER BY id ASC').all();
  res.json({ stats, users });
});
// Admin: Create a single user
app.post('/api/admin/users', authenticate, authorizeRoles('admin'), (req, res) => {
  const { full_name, username, password, role, form_level } = req.body || {};
  if (!full_name || !username || !password || !role) {
    return res.status(400).json({ error: 'full_name, username, password, and role are required' });
  }
  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const hash = bcrypt.hashSync(String(password), 10);
    const result = db.prepare(`
      INSERT INTO users (full_name, username, password_hash, role, form_level)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      String(full_name).trim(),
      String(username).trim(),
      hash,
      role,
      role === 'student' && form_level ? String(form_level).trim() : null
    );
    return res.status(201).json({ id: result.lastInsertRowid, message: 'User created successfully' });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username / Index ID already exists' });
    }
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// Admin: Bulk import users via CSV text (columns: full_name,username,password,role,form_level)
app.post('/api/admin/users/bulk', authenticate, authorizeRoles('admin'), (req, res) => {
  const { csv } = req.body || {};
  if (!csv || !String(csv).trim()) {
    return res.status(400).json({ error: 'CSV content is required' });
  }

  const lines = String(csv)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO users (full_name, username, password_hash, role, form_level)
    VALUES (?, ?, ?, ?, ?)
  `);

  let created = 0;
  let skipped = 0;
  const importedUsers = [];

  const importTx = db.transaction((rows) => {
    rows.forEach((line, idx) => {
      const parts = line.split(',').map((p) => p.trim());
      if (idx === 0 && parts[0].toLowerCase() === 'full_name') return;

      const [full_name, username, password, rawRole, form_level] = parts;
      const role = (rawRole || 'student').toLowerCase();

      if (!full_name || !username || !password || !['admin', 'teacher', 'student'].includes(role)) {
        skipped++;
        return;
      }

      const cleanForm = role === 'student' && form_level ? form_level : null;
      const hash = bcrypt.hashSync(password, 10);
      const info = insertStmt.run(full_name, username, hash, role, cleanForm);

      if (info.changes > 0) {
        created++;
        importedUsers.push({ full_name, username, password, role, form_level: cleanForm });
      } else {
        skipped++;
      }
    });
  });

  importTx(lines);
  return res.json({
    created,
    skipped,
    importedUsers,
    message: `Imported ${created} user(s), skipped ${skipped}.`
  });
});
// Admin: Toggle user active/inactive status
app.patch('/api/admin/users/:id/toggle', authenticate, authorizeRoles('admin'), (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own admin account' });
  }
  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const nextState = user.is_active ? 0 : 1;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(nextState, userId);
  return res.json({ id: userId, is_active: nextState });
});
// Admin: Reset a user's password to a temporary password
app.post('/api/admin/users/:id/reset-password', authenticate, authorizeRoles('admin'), (req, res) => {
  const userId = Number(req.params.id);
  const tempPassword = (req.body && req.body.new_password) ? String(req.body.new_password) : 'Shs@2026';

  if (tempPassword.length < 6) {
    return res.status(400).json({ error: 'Temporary password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const hash = bcrypt.hashSync(tempPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  return res.json({ message: `Password for ${user.username} reset to "${tempPassword}"` });
});

// Fallback to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

// Multer & general error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SHS Offline Learning Hub server running at http://localhost:${PORT}`);
  console.log(`Accessible on local LAN via your PC's IPv4 address on port ${PORT}`);
});