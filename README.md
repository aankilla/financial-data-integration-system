# Financial Data Integration System

A Node.js implementation of a financial data integration workflow that retrieves transaction data from REST endpoints or local fixtures, parses JSON and XML payloads, validates records, and stores accepted data in SQLite for reporting and analysis.

## Features

- Retrieves data from REST API URLs with timeout and HTTP error handling
- Parses both JSON and XML transaction payloads
- Validates required fields, amounts, ISO currency codes, dates, and statuses
- Saves valid records and rejected-record reasons in SQLite
- Produces an amount-by-currency report

## Setup

1. Install Node.js and npm
2. Install dependencies:
   npm install

## Run

node financial_integration.js --source fixtures/transactions.json --format json
node financial_integration.js --source fixtures/transactions.xml --format xml
node financial_integration.js --report

For a REST source, pass an HTTPS URL to --source. The database is created at data/financial.db.

## Test

npm test
