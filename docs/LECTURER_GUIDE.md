# Lecturer Evaluation Guide — Lekker Story ERP

## How to open grading mode

1. Run the app via a local server (`start-server.bat` or `python -m http.server 8080`).
2. Open: **http://localhost:8080/?demo=1**
3. The header shows a **Lecturer mode** panel with:
   - **Reset to zero** — clears all stock and transactions (opening equity journal only).
   - **Load sample data** — full scenario ready for grading.

## Recommended test flow

| No | Role | What to check | Expected result |
|----|------|---------------|-----------------|
| 1 | Manager | Opening stock = 0 after reset | All materials show 0 on stock cards |
| 2 | Manager | Create PR for out-of-stock material | PR appears in the list |
| 3 | Finance | PO → GRN → 3-way match | Journals 110/210/211 are correct |
| 4 | Cashier | Open shift, sell menu items | Menu stock decreases; receipt shows **queue number** |
| 5 | Finance | General ledger & trial balance | Debit = Credit |
| 6 | Finance | Income statement & balance sheet | Figures consistent with journals |

## Sample data (Load sample data button)

Includes:

- 2 POS sales (QRIS & Cash) **without PB1 tax** (UMKM / small business)
- 1 full P2P flow (PR → PO → GRN → invoice → AP)
- 1 electricity expense journal

## Reset for accuracy testing from scratch

Use **Reset to zero** before students start a practical exam:

- `sales`, `PR`, `PO`, `GRN`, `invoice` are cleared
- Stock for all materials = **0**
- Journal contains only the owner equity opening entry (101 / 301)

Students must add stock via GRN or Manager adjustment before selling at the cashier.

## Technical notes

- Cashier shows **Stock: N** per menu (how many portions can be made from the BOM).
- PB1 tax is **not** applied at POS (UMKM brand setting).
- Pay button updates the UI immediately; Firebase sync runs in the background.
