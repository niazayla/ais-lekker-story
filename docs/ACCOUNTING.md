# Accounting & ERP Compliance — Lekker Story AIS

This document maps system features to standard accounting and internal-control expectations for restaurant ERP / AIS coursework and deployment readiness.

## 1. Chart of accounts (COA)

Standard SIA-aligned accounts are defined in `accounting.coa` (module `app.js`):

| Code | Account |
|------|---------|
| 101 | Cash Drawer |
| 102 | Bank — QRIS Settlement |
| 103 | Bank — EDC Card Merchant |
| 110 | Warehouse Raw Material Inventory |
| 210 | Unbilled Payables (Accrual GRN) |
| 211 | Accounts Payable |
| 212 | Restaurant Tax Payable (PB1) |
| 301 | Owner Equity |
| 401 | Sales Revenue |
| 501 | COGS |
| 502 | Cashier Variance Expense |
| 503 | Inventory Variance Adjustment Expense |
| 601 | Salary & Wages Expense |
| 602 | Store Operating Expense |

**Opening entry:** Debit Cash 101 / Credit Owner Equity 301 (Rp 1,500,000) on init.

## 2. Double-entry bookkeeping

Every material event posts balanced journal lines via `accounting.addJournal()`:

- **POS sale:** Debit cash/bank (101/102/103) → Credit revenue 401 + tax 212; Debit COGS 501 → Credit inventory 110.
- **GRN:** Debit inventory 110 → Credit unbilled payables 210.
- **Supplier invoice (3-way match):** Debit 210 → Credit AP 211.
- **AP payment:** Debit 211 → Credit 101.
- **Shift variance:** Debit 502 or credit gain via journal on close.
- **Stocktake:** Debit 503 or inventory adjustment journals.

Firestore persistence: `journals` + `general_ledger` collections (batch write per line).

## 3. Revenue recognition & tax (PB1)

- Subtotal and **10% PB1** split on POS checkout.
- Tax accrued to account **212**, not netted into revenue **401**.

## 4. Procure-to-pay (P2P) & internal control

| Step | Control |
|------|---------|
| PR | Manager creates purchase request |
| PO | Finance issues PO from approved PR |
| GRN | Physical receipt before inventory increase; accrual to **210** |
| 3-way match | PO + GRN + supplier invoice checklist before AP **211** |
| Payment | Finance settles AP with cash impact |

## 5. Financial reporting

Finance module provides:

- **General ledger** — transaction journal with account drill-down
- **Trial balance** — debit/credit totals per account
- **Income statement** — revenue, COGS, expenses
- **Balance sheet** — assets, liabilities, equity (must balance)

## 6. Subsidiary records

- **Inventory / stock card** — tied to BOM and POS COGS
- **Audit trail** — user, module, timestamp (`activity_logs` in Firestore)
- **Cashier shift** — opening balance, sales by method, physical count vs system

## 7. Segregation of duties (COSO)

| Function | Role |
|----------|------|
| Sales & cash handling | Cashier |
| Operations & PR | Manager |
| Recording & payment | Finance |

## 8. Pre-deployment checklist

- [ ] Firebase Auth users created for each role
- [ ] Firestore security rules restrict writes by role (recommended for production)
- [ ] `firebase.config.js` uses production project keys
- [ ] Remove or restrict `?demo=1` in production if sample data is not desired
- [ ] Backup/export strategy for `journals` and `general_ledger`

## 9. Known limitations (prototype)

- Client-side validation; production should enforce rules in Firestore Security Rules / Cloud Functions.
- Chatbot uses optional Gemini API key in session (not required for accounting).
- Single-entity, single-location; no multi-branch consolidation.
