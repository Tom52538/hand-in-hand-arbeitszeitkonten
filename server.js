const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware-Konfiguration
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session-Konfiguration
app.use(session({
  secret: process.env.SESSION_SECRET || 'geheimer_schluessel',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // auf true setzen, wenn HTTPS verwendet wird
}));

// PostgreSQL-Datenbankverbindung einrichten
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Erstellen der Datenbanktabellen (falls noch nicht vorhanden)
// Tabelle für Mitarbeiter
pool.query(`
  CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    mo_hours DOUBLE PRECISION DEFAULT 0,
    di_hours DOUBLE PRECISION DEFAULT 0,
    mi_hours DOUBLE PRECISION DEFAULT 0,
    do_hours DOUBLE PRECISION DEFAULT 0,
    fr_hours DOUBLE PRECISION DEFAULT 0
  );
`)
  .then(() => console.log("Tabelle 'employees' ist bereit."))
  .catch(err => console.error("Fehler bei Tabelle 'employees':", err));

// Tabelle für Arbeitszeiten
pool.query(`
  CREATE TABLE IF NOT EXISTS work_hours (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    break_time DOUBLE PRECISION DEFAULT 0,
    net_hours DOUBLE PRECISION,
    comment TEXT
  );
`)
  .then(() => console.log("Tabelle 'work_hours' ist bereit."))
  .catch(err => console.error("Fehler bei Tabelle 'work_hours':", err));

// Basis-Endpunkt: Ausliefern der index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Endpunkt für das Erfassen der Arbeitszeiten
app.post('/log-hours', async (req, res) => {
  try {
    const { employeeName, date, startTime, endTime, breakTime, comment } = req.body;
    if (!employeeName || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Fehlende erforderliche Felder.' });
    }
    
    // Mitarbeiter-ID anhand des Namens ermitteln
    const employeeResult = await pool.query('SELECT id FROM employees WHERE name = $1', [employeeName]);
    if (employeeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Mitarbeiter nicht gefunden.' });
    }
    const employeeId = employeeResult.rows[0].id;
    
    // Hilfsfunktion zum Parsen der Zeit im Format "HH:MM"
    function parseTime(timeStr) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    }
    
    // Berechnung der Netto-Arbeitszeit
    const startMinutes = parseTime(startTime);
    const endMinutes = parseTime(endTime);
    const totalMinutes = endMinutes - startMinutes;
    const breakMinutes = parseInt(breakTime, 10) || 0;
    const netHours = (totalMinutes - breakMinutes) / 60;
    
    // Datensatz in der Tabelle work_hours einfügen
    await pool.query(`
      INSERT INTO work_hours (employee_id, date, start_time, end_time, break_time, net_hours, comment)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [employeeId, date, startTime, endTime, breakTime, netHours, comment]);
    
    res.json({ message: 'Arbeitszeit erfolgreich erfasst.' });
  } catch (error) {
    console.error("Fehler in /log-hours:", error);
    res.status(500).json({ error: 'Interner Serverfehler.' });
  }
});

// Einfacher Admin-Login (Passwort wird über die Umgebungsvariable ADMIN_PASSWORD geprüft)
app.post('/admin-login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ message: 'Admin angemeldet.' });
  } else {
    res.status(401).json({ error: 'Falsches Passwort.' });
  }
});

// Beispiel-Endpunkt für Admin: Alle Arbeitszeiten abrufen
app.get('/admin-work-hours', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Zugriff verweigert.' });
  }
  
  try {
    const result = await pool.query(`
      SELECT wh.id, e.name AS employee, wh.date, wh.start_time, wh.end_time, wh.break_time, wh.net_hours, wh.comment
      FROM work_hours wh
      JOIN employees e ON wh.employee_id = e.id
      ORDER BY wh.date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Fehler in /admin-work-hours:", error);
    res.status(500).json({ error: 'Interner Serverfehler.' });
  }
});

// Server starten
app.listen(port, () => {
  console.log(`Server läuft auf Port ${port}`);
});
