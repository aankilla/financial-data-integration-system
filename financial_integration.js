#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');
const Database = require('better-sqlite3');

const VALID_STATUSES = new Set(['completed', 'pending', 'failed', 'reversed']);

function retrieve(source) {
  return new Promise((resolve, reject) => {
    try {
      if (/^https?:\/\//i.test(source)) {
        const client = source.startsWith('https') ? https : http;
        client.get(source, { timeout: 15000 }, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('timeout', () => {
          reject(new Error('Request timed out'));
        }).on('error', (err) => reject(err));
        return;
      }

      resolve(fs.readFileSync(source));
    } catch (err) {
      reject(new Error(`Could not retrieve data: ${err.message}`));
    }
  });
}

function parseTransactions(payload, dataFormat) {
  return new Promise((resolve, reject) => {
    try {
      if (dataFormat === 'json') {
        const parsed = JSON.parse(payload.toString('utf8'));
        resolve(Array.isArray(parsed) ? parsed : parsed.transactions || []);
        return;
      }

      parseStringPromise(payload.toString('utf8'))
        .then((result) => {
          const transactions = result?.transactions?.transaction || [];
          resolve(transactions.map((item) => Object.fromEntries(
            Object.entries(item).map(([key, value]) => [key, value?.[0] || ''])
          )));
        })
        .catch((err) => reject(new Error(`Invalid XML payload: ${err.message}`)));
    } catch (err) {
      reject(new Error(`Invalid ${dataFormat.toUpperCase()} payload: ${err.message}`));
    }
  });
}

function validateRecord(record) {
  const required = ['transaction_id', 'transaction_date', 'amount', 'currency', 'status'];
  const missing = required.filter((key) => !String(record[key] || '').trim());

  if (missing.length) {
    return { valid: false, reason: `missing fields: ${missing.join(', ')}` };
  }

  try {
    const amount = Number(record.amount);
    const date = new Date(record.transaction_date);
    if (Number.isNaN(amount) || Number.isNaN(date.getTime())) {
      throw new Error('invalid amount or transaction_date');
    }
    if (amount < 0 || !/^[A-Za-z]{3}$/.test(record.currency)) {
      throw new Error('invalid amount or ISO currency');
    }
    if (!VALID_STATUSES.has(String(record.status).toLowerCase())) {
      throw new Error('unsupported status');
    }
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  return { valid: true, reason: '' };
}

function createDatabase(pathName) {
  const db = new Database(pathName);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      transaction_date TEXT,
      amount REAL,
      currency TEXT,
      status TEXT,
      source TEXT
    );
    CREATE TABLE IF NOT EXISTS rejected_records (
      id INTEGER PRIMARY KEY,
      payload TEXT,
      reason TEXT,
      source TEXT
    );
  `);
  return db;
}

function importRecords(db, records, source) {
  let accepted = 0;
  let rejected = 0;
  let duplicates = 0;

  const insertTransaction = db.prepare(`
    INSERT OR IGNORE INTO transactions (transaction_id, transaction_date, amount, currency, status, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRejected = db.prepare(`
    INSERT INTO rejected_records (payload, reason, source) VALUES (?, ?, ?)
  `);

  for (const record of records) {
    const { valid, reason } = validateRecord(record);
    if (!valid) {
      insertRejected.run(JSON.stringify(record), reason, source);
      rejected += 1;
      continue;
    }

    const result = insertTransaction.run(
      record.transaction_id,
      record.transaction_date,
      Number(record.amount),
      record.currency.toUpperCase(),
      String(record.status).toLowerCase(),
      source
    );

    if (result.changes === 1) {
      accepted += 1;
    } else {
      duplicates += 1;
    }
  }

  console.log(`Imported: ${accepted}; rejected: ${rejected}; duplicates: ${duplicates}`);
}

function report(db) {
  console.log('Currency | Transactions | Total amount');
  const rows = db.prepare(`
    SELECT currency, COUNT(*), ROUND(SUM(amount), 2) AS total
    FROM transactions
    GROUP BY currency
  `).all();

  for (const row of rows) {
    console.log(`${row.currency.padEnd(8)} | ${String(row['COUNT(*)']).padStart(12)} | ${Number(row.total).toFixed(2).padStart(12)}`);
  }
}

module.exports = {
  retrieve,
  parseTransactions,
  validateRecord,
  createDatabase,
  importRecords,
  report
};

async function main() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--source') options.source = args[++i];
    else if (arg === '--format') options.format = args[++i];
    else if (arg === '--database') options.database = args[++i];
    else if (arg === '--report') options.report = true;
  }

  if (!options.report && (!options.source || !options.format)) {
    console.error('Usage: node financial_integration.js --source <file-or-url> --format <json|xml> [--database <path>] [--report]');
    process.exit(1);
  }

  const databasePath = options.database || path.join('data', 'financial.db');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = createDatabase(databasePath);

  if (options.report) {
    report(db);
  } else {
    const payload = await retrieve(options.source);
    const records = await parseTransactions(payload, options.format);
    importRecords(db, records, options.source);
  }

  db.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
