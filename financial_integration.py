import argparse
import json
import sqlite3
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

VALID_STATUSES = {'completed', 'pending', 'failed', 'reversed'}

def retrieve(source):
    try:
        if source.startswith(('http://', 'https://')):
            with urllib.request.urlopen(source, timeout=15) as response:
                return response.read()
        return Path(source).read_bytes()
    except (OSError, ValueError) as exc:
        raise RuntimeError(f'Could not retrieve data: {exc}') from exc

def parse_transactions(payload, data_format):
    try:
        if data_format == 'json':
            data = json.loads(payload.decode('utf-8'))
            return data['transactions'] if isinstance(data, dict) else data
        root = ET.fromstring(payload)
        return [{child.tag: (child.text or '').strip() for child in item}
                for item in root.findall('.//transaction')]
    except (UnicodeDecodeError, json.JSONDecodeError, ET.ParseError, KeyError) as exc:
        raise RuntimeError(f'Invalid {data_format.upper()} payload: {exc}') from exc

def validate(record):
    required = ('transaction_id', 'transaction_date', 'amount', 'currency', 'status')
    missing = [key for key in required if not str(record.get(key, '')).strip()]
    if missing:
        return False, 'missing fields: ' + ', '.join(missing)
    try:
        amount = float(record['amount'])
        date.fromisoformat(record['transaction_date'])
    except (TypeError, ValueError):
        return False, 'invalid amount or transaction_date'
    if amount < 0 or len(record['currency']) != 3 or not record['currency'].isalpha():
        return False, 'invalid amount or ISO currency'
    if record['status'].lower() not in VALID_STATUSES:
        return False, 'unsupported status'
    return True, ''

def database(path):
    connection = sqlite3.connect(path)
    connection.executescript('''
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY, transaction_date TEXT, amount REAL,
        currency TEXT, status TEXT, source TEXT);
      CREATE TABLE IF NOT EXISTS rejected_records (
        id INTEGER PRIMARY KEY, payload TEXT, reason TEXT, source TEXT);
    ''')
    return connection

def import_records(connection, records, source):
    accepted = rejected = duplicates = 0
    for record in records:
        valid, reason = validate(record)
        if not valid:
            connection.execute('INSERT INTO rejected_records(payload, reason, source) VALUES (?, ?, ?)',
                               (json.dumps(record), reason, source))
            rejected += 1
            continue
        cursor = connection.execute('INSERT OR IGNORE INTO transactions VALUES (?, ?, ?, ?, ?, ?)',
            (record['transaction_id'], record['transaction_date'], float(record['amount']),
             record['currency'].upper(), record['status'].lower(), source))
        accepted += bool(cursor.rowcount)
        duplicates += not bool(cursor.rowcount)
    connection.commit()
    print(f'Imported: {accepted}; rejected: {rejected}; duplicates: {duplicates}')

def report(connection):
    print('Currency | Transactions | Total amount')
    for row in connection.execute('SELECT currency, COUNT(*), ROUND(SUM(amount), 2) FROM transactions GROUP BY currency'):
        print(f'{row[0]:8} | {row[1]:12} | {row[2]:12.2f}')

def main():
    parser = argparse.ArgumentParser(description='Financial REST data integration')
    parser.add_argument('--source')
    parser.add_argument('--format', choices=('json', 'xml'))
    parser.add_argument('--database', default='data/financial.db')
    parser.add_argument('--report', action='store_true')
    args = parser.parse_args()
    Path(args.database).parent.mkdir(parents=True, exist_ok=True)
    connection = database(args.database)
    if args.report:
        report(connection)
    elif args.source and args.format:
        import_records(connection, parse_transactions(retrieve(args.source), args.format), args.source)
    else:
        parser.error('provide --report or both --source and --format')

if __name__ == '__main__':
    main()
