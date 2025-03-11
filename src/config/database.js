const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/database.sqlite');

// Ensure the data directory exists
const fs = require('fs');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        return;
    }
    console.log('Connected to SQLite database');
    
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');

    // Create tables in the correct order
    const initDb = async () => {
        try {
            // Create users table first
            await new Promise((resolve, reject) => {
                db.run(`CREATE TABLE IF NOT EXISTS users (
                    telegram_id INTEGER,
                    username TEXT PRIMARY KEY,
                    anonymous_id TEXT UNIQUE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Create admins table
            await new Promise((resolve, reject) => {
                db.run(`CREATE TABLE IF NOT EXISTS admins (
                    username TEXT PRIMARY KEY,
                    is_super_admin BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (username) REFERENCES users(username)
                )`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Create contact_requests table
            await new Promise((resolve, reject) => {
                db.run(`CREATE TABLE IF NOT EXISTS contact_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_user_id INTEGER,
                    to_user_id INTEGER,
                    status TEXT DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (from_user_id) REFERENCES users (telegram_id),
                    FOREIGN KEY (to_user_id) REFERENCES users (telegram_id)
                )`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Create reports table
            await new Promise((resolve, reject) => {
                db.run(`CREATE TABLE IF NOT EXISTS reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reporter_id INTEGER,
                    reported_id INTEGER,
                    reason TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (reporter_id) REFERENCES users (telegram_id),
                    FOREIGN KEY (reported_id) REFERENCES users (telegram_id)
                )`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Insert initial admin user
            await new Promise((resolve, reject) => {
                db.run('INSERT OR IGNORE INTO users (username) VALUES (?)', ['test971222'], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Insert super admin
            await new Promise((resolve, reject) => {
                db.run('INSERT OR IGNORE INTO admins (username, is_super_admin) VALUES (?, 1)', 
                    ['test971222'], 
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });

            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Error initializing database:', error);
        }
    };

    initDb();
});

module.exports = db;
