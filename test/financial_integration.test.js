const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateRecord, parseTransactions, createDatabase, importRecords } = require('../financial_integration');

test('validates a well-formed transaction record', () => {
  const result = validateRecord({
    transaction_id: 'txn-100',
    transaction_date: '2026-07-10',
    amount: '15.75',
    currency: 'usd',
    status: 'completed'
  });

  assert.equal(result.valid, true);
  assert.equal(result.reason, '');
});

test('parses JSON transactions into an array', async () => {
  const payload = Buffer.from(JSON.stringify({ transactions: [{ transaction_id: 'a' }] }));
  const records = await parseTransactions(payload, 'json');
  assert.equal(records.length, 1);
  assert.equal(records[0].transaction_id, 'a');
});

test('imports valid records into the database', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-'));
  const dbPath = path.join(tempDir, 'transactions.db');
  const db = createDatabase(dbPath);

  try {
    importRecords(db, [{
      transaction_id: 'txn-200',
      transaction_date: '2026-07-20',
      amount: '19.99',
      currency: 'usd',
      status: 'completed'
    }], 'fixture');

    const row = db.prepare('SELECT COUNT(*) AS count FROM transactions').get();
    assert.equal(row.count, 1);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
