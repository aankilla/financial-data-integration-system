# Financial Data Integration System

A Python project that retrieves financial transactions from REST endpoints or local fixtures, parses JSON and XML, validates records, and stores accepted data in SQLite for reporting.

## Features

- Retrieves data from REST API URLs with timeout and HTTP error handling
- Parses both JSON and XML transaction payloads
- Validates required fields, amounts, ISO currency codes, dates, and statuses
- Saves valid records and rejected-record reasons in SQLite
- Produces an amount-by-currency report

## Run

python financial_integration.py --source fixtures/transactions.json --format json
python financial_integration.py --source fixtures/transactions.xml --format xml
python financial_integration.py --report

For a REST source, pass an HTTPS URL to --source. The database is created at data/financial.db.
