// --- FIREBASE SDK IMPORTS ---
        import { initializeApp }                         from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
        import { getAuth, signInWithEmailAndPassword,
                 signOut, onAuthStateChanged }            from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
        import { getFirestore, doc, getDoc, getDocs,
                 addDoc, setDoc, updateDoc, deleteDoc,
                 collection, onSnapshot, query, orderBy,
                 serverTimestamp, writeBatch, runTransaction,
                 where }                                  from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
        import { getStorage, ref as storageRef,
                 uploadBytes, getDownloadURL }            from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
        import { firebaseConfig } from './config/firebase.config.js';
        import {
            LEKKER_DEFAULT_INVENTORY, LEKKER_DEFAULT_MENUS, MATERIAL_PRICE_LIST,
            computeBomCostFromIngredients, suggestMenuSellingPrice
        } from './menu-catalog.js';

        // --- FIX 2 --- Locked PO unit cost (falls back for legacy POs without unitCost)
        const poUnitCost = (po) => po.unitCost ?? state.inventory[po.itemId]?.cost ?? 0;
        const firebaseApp = initializeApp(firebaseConfig);
        const auth        = getAuth(firebaseApp);
        const db          = getFirestore(firebaseApp);
        const storage     = getStorage(firebaseApp);

        // --- FIRESTORE COLLECTION REFS ---
        const COL = {
            users:              () => collection(db, 'users'),
            products:           () => collection(db, 'products'),
            inventory:          () => collection(db, 'inventory'),
            transactions:       () => collection(db, 'transactions'),
            journals:           () => collection(db, 'journals'),
            orders:             () => collection(db, 'orders'),
            activity_logs:      () => collection(db, 'activity_logs'),
            general_ledger:     () => collection(db, 'general_ledger'),
            inventory_movements:() => collection(db, 'inventory_movements'),
        };

        // --- FIRESTORE WRITE HELPERS ---
        const fs = {
            // Write activity log to Firestore (non-blocking, silent on failure)
            log: async (action, entity) => {
                try {
                    await addDoc(COL.activity_logs(), {
                        userId:    state.currentUser?.uid  || 'system',
                        userName:  state.currentUser?.name || 'SISTEM',
                        role:      state.currentUser?.role || 'system',
                        action,
                        entity,
                        timestamp: serverTimestamp()
                    });
                } catch(e) { console.warn('[fs.log]', e.message); }
            },

            // Persist a full journal entry + post each line to general_ledger (Workflow 3)
            addJournal: async (transactionId, description, entries) => {
                try {
                    const journalId = `J-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
                    const batch = writeBatch(db);

                    // 1. Write journal document
                    batch.set(doc(db, 'journals', journalId), {
                        journalId,
                        transactionId,
                        description,
                        entries,
                        postedBy:  state.currentUser?.uid  || 'system',
                        createdAt: serverTimestamp(),
                        posted: true
                    });

                    // 2. Write one general_ledger entry per journal line (Workflow 3)
                    entries.forEach((e, idx) => {
                        if(e.debit === 0 && e.credit === 0) return;
                        const glId = `GL-${journalId}-${idx}`;
                        batch.set(doc(db, 'general_ledger', glId), {
                            journalId,
                            transactionId,
                            account:   e.account,
                            debit:     e.debit  || 0,
                            credit:    e.credit || 0,
                            date:      serverTimestamp(),
                            source:    description
                        });
                    });

                    await batch.commit();
                } catch(e) { console.warn('[fs.addJournal]', e.message); }
            },

            // Post ledger entries only (used when journal already persisted separately)
            postToLedger: async (transactionId, description, entries) => {
                try {
                    const batch = writeBatch(db);
                    entries.forEach((e, idx) => {
                        if(e.debit === 0 && e.credit === 0) return;
                        const glId = `GL-${transactionId}-${idx}-${Date.now()}`;
                        batch.set(doc(db, 'general_ledger', glId), {
                            transactionId,
                            account:  e.account,
                            debit:    e.debit  || 0,
                            credit:   e.credit || 0,
                            date:     serverTimestamp(),
                            source:   description
                        });
                    });
                    await batch.commit();
                } catch(e) { console.warn('[fs.postToLedger]', e.message); }
            },

            // Create inventory movement record (Workflow 5)
            addInventoryMovement: async (productId, quantity, movementType, source) => {
                try {
                    await addDoc(COL.inventory_movements(), {
                        productId,
                        quantity,
                        movementType, // 'IN' | 'OUT' | 'ADJUSTMENT'
                        source,
                        createdBy: state.currentUser?.uid || 'system',
                        createdAt: serverTimestamp()
                    });
                } catch(e) { console.warn('[fs.addInventoryMovement]', e.message); }
            },

            // Atomically adjust inventory stock using runTransaction (Workflow 7)
            // direction: +1 to increase, -1 to decrease
            adjustInventoryStock: async (productId, deltaQty, direction) => {
                try {
                    const invDocRef = doc(db, 'inventory', productId);
                    await runTransaction(db, async (txn) => {
                        const snap = await txn.get(invDocRef);
                        const current = snap.exists() ? (snap.data().currentStock || 0) : 0;
                        const newStock = direction > 0
                            ? current + deltaQty
                            : Math.max(0, current - deltaQty);
                        txn.set(invDocRef, {
                            productId,
                            currentStock: newStock,
                            updatedAt:    serverTimestamp()
                        }, { merge: true });
                    });
                } catch(e) { console.warn('[fs.adjustInventoryStock]', e.message); }
            },

            // Persist a purchase order / purchase request to orders collection
            persistOrder: async (orderData) => {
                try {
                    await setDoc(doc(db, 'orders', orderData.id), {
                        ...orderData,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });
                } catch(e) { console.warn('[fs.persistOrder]', e.message); }
            },

            // Update order status in Firestore
            updateOrderStatus: async (orderId, status, extra = {}) => {
                try {
                    await updateDoc(doc(db, 'orders', orderId), {
                        status,
                        ...extra,
                        updatedAt: serverTimestamp()
                    });
                } catch(e) { console.warn('[fs.updateOrderStatus]', e.message); }
            },

            // Legacy helpers kept for backward-compat (now delegate to adjustInventoryStock)
            reduceInventory: async (productId, deltaQty) => {
                return fs.adjustInventoryStock(productId, deltaQty, -1);
            },
            addInventory: async (productId, deltaQty) => {
                return fs.adjustInventoryStock(productId, deltaQty, +1);
            },
            syncProductStock: async (productId, newStock) => {
                try {
                    await setDoc(doc(db, 'inventory', productId), {
                        productId,
                        currentStock: newStock,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                } catch(e) { console.warn('[fs.syncProductStock]', e.message); }
            }
        };

        // --- REALTIME LISTENER SUBSCRIPTIONS ---
        // Set up after login; store unsub handles for cleanup on logout
        let _unsubs = [];
        const realtimeListeners = {
            attach: () => {
                if (state.useLocalOnly || sessionStorage.getItem('lekker_local_only') === '1') {
                    state.useLocalOnly = true;
                    console.info('[ERP] Local test mode — Firebase will not overwrite reset data.');
                    return;
                }
                // transactions onSnapshot → refresh manager + cashier dashboards (Workflow 4)
                const unsubTrx = onSnapshot(
                    query(COL.transactions(), orderBy('createdAt','desc')),
                    (snap) => {
                        state.sales = snap.docs.map(d => {
                            const data = d.data();
                            return {
                                id: data.transactionId,
                                items: data.items || [],
                                total: data.total,
                                subtotal: data.subtotal || 0,
                                paymentMethod: data.paymentMethod,
                                time: data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
                            };
                        });
                        if(state.currentUser?.role === 'manager') {
                            try { manager.renderDashboard(); } catch(e) {}
                        }
                        if(state.currentUser?.role === 'cashier') {
                            try { pos.render(); } catch(e) {}
                        }
                    },
                    (err) => console.warn('[onSnapshot transactions]', err.message)
                );

                // inventory onSnapshot → refresh inventory + POS (Workflow 4)
                const unsubInv = onSnapshot(
                    COL.inventory(),
                    (snap) => {
                        snap.docs.forEach(d => {
                            const data = d.data();
                            const pid = data.productId;
                            // Update state.inventory keyed by productId directly
                            if(pid && state.inventory[pid]) {
                                state.inventory[pid].stock = data.currentStock ?? state.inventory[pid].stock;
                            }
                        });
                        if(state.currentUser?.role === 'manager') {
                            try { manager.renderInventory(); } catch(e) {}
                        }
                        if(state.currentUser?.role === 'cashier') {
                            try { pos.render(); } catch(e) {}
                        }
                    },
                    (err) => console.warn('[onSnapshot inventory]', err.message)
                );

                // orders onSnapshot → sync local prs/pos state + refresh manager dashboard (Workflow 1 & 4)
                const unsubOrders = onSnapshot(
                    query(COL.orders(), orderBy('createdAt','desc')),
                    (snap) => {
                        // Merge remote orders into local state arrays
                        snap.docs.forEach(d => {
                            const data = d.data();
                            if(data.type === 'restock') {
                                // Sync into state.prs
                                const existPr = state.prs.find(p => p.id === data.id);
                                if(existPr) {
                                    existPr.status = data.status === 'approved' ? 'Approved' : existPr.status;
                                } else if(data.prId) {
                                    // Check if the PO is already in state.pos
                                    const existPo = state.pos.find(p => p.id === data.id);
                                    if(!existPo) {
                                        state.pos.push({
                                            id: data.id,
                                            prId: data.prId,
                                            itemId: data.itemId,
                                            itemName: data.itemName,
                                            qty: data.qty,
                                            unitCost: data.unitCost ?? state.inventory[data.itemId]?.cost ?? 0,
                                            supplier: data.supplier || 'Local Food Supplier',
                                            status: data.status === 'approved' ? 'Issued' :
                                                    data.status === 'received' ? 'Received' :
                                                    data.status === 'invoiced' ? 'Invoiced' : 'Issued'
                                        });
                                    }
                                }
                            }
                        });
                        if(state.currentUser?.role === 'manager') {
                            try { manager.renderDashboard(); } catch(e) {}
                            try { manager.renderInventory(); } catch(e) {}
                            try { manager.renderProcurement(); } catch(e) {}
                        }
                        if(state.currentUser?.role === 'finance') {
                            try { finance.renderPO(); } catch(e) {}
                            try { finance.renderGRN(); } catch(e) {}
                        }
                    },
                    (err) => console.warn('[onSnapshot orders]', err.message)
                );

                // journals onSnapshot → rebuild local state.journal + refresh finance ledger (Workflow 3 & 4)
                const unsubJournals = onSnapshot(
                    query(COL.journals(), orderBy('createdAt','desc')),
                    (snap) => {
                        // Rebuild state.journal from Firestore (Firestore is source of truth)
                        const fsJournals = snap.docs.map(d => {
                            const data = d.data();
                            return {
                                date: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
                                ref: data.transactionId || data.journalId,
                                description: data.description,
                                entries: data.entries || []
                            };
                        });
                        // Merge: keep local journals that aren't yet in Firestore (optimistic)
                        // Only replace if Firestore has data (avoid wiping initSetup on first load)
                        if(fsJournals.length > 0) {
                            // Keep the initial equity entry always + fs journals
                            const initEntry = state.journal.find(j => j.ref === 'JV-001');
                            state.journal = [
                                ...(initEntry ? [initEntry] : []),
                                ...fsJournals.filter(j => j.ref !== 'JV-001')
                            ];
                        }
                        if(state.currentUser?.role === 'finance') {
                            try { finance.refreshActiveView(); } catch(e) {}
                        }
                        if(state.currentUser?.role === 'manager') {
                            try { manager.renderDashboard(); } catch(e) {}
                        }
                    },
                    (err) => console.warn('[onSnapshot journals]', err.message)
                );

                // general_ledger onSnapshot → auto-refresh finance dashboard (Workflow 4)
                const unsubGL = onSnapshot(
                    COL.general_ledger(),
                    () => {
                        if(state.currentUser?.role === 'finance') {
                            try { finance.refreshActiveView(); } catch(e) {}
                        }
                    },
                    (err) => console.warn('[onSnapshot general_ledger]', err.message)
                );

                _unsubs = [unsubTrx, unsubInv, unsubOrders, unsubJournals, unsubGL];
            },
            detach: () => {
                _unsubs.forEach(fn => { try { fn(); } catch(e) {} });
                _unsubs = [];
            }
        };

        // --- 1. COMPANY CONFIG & DATA (LEKKER & JUICE / SHAKE) ---
        // MOCK_USERS removed - role/name now resolved from Firestore users/{uid}.
        // Firestore document structure: users/{uid} => { name: '...', role: 'cashier|manager|finance' }
        // If the document is missing, a safe local fallback is used (see RESTORE 2 in app.login).

        const state = {
            currentUser: null,
            inventory: structuredClone(LEKKER_DEFAULT_INVENTORY),
            menus: structuredClone(LEKKER_DEFAULT_MENUS),
            cashier: {
                cart: [],
                shiftOpen: false,
                shiftName: '',
                shiftRevenue: 0,
                shiftTax: 0,
                shiftTotalCollected: 0,
                shiftTrx: 0,
                shiftOpenTime: null,
                openingCash: 0,
                salesCashCollected: 0,
                queueCounter: 1,
                lastQueueNo: 0,
                activeShiftId: null
            },
            sales: [],
            prs: [],
            pos: [],
            grns: [],
            invoices: [],
            journal: [], 
            auditLogs: [],
            shiftLog: [],
            
            // Temporary manual JV lines State
            manualJvLines: [
                { account: '', debit: 0, credit: 0 },
                { account: '', debit: 0, credit: 0 }
            ],
            ledgerViewMode: 'all', // all, account, manual

            chartInstances: { daily: null, monthly: null, products: null, finDaily: null, finMonthly: null },
            /** When true, Firestore listeners do not overwrite local data (for accuracy testing after reset) */
            useLocalOnly: false
        };

        const EXPENSE_ACCOUNTS = ['501', '502', '503', '601', '602'];
        /** PB1 restaurant tax — 10% on POS subtotal (prices exclude tax) */
        const POS_TAX_RATE = 0.10;

        // --- 2. CHART OF ACCOUNTS (SIA STANDARD) ---
        const accounting = {
            coa: {
                '101': 'Cash Drawer',
                '102': 'Bank - QRIS Settlement',
                '103': 'Bank - EDC Card Merchant',
                '110': 'Warehouse Raw Material Inventory',
                '210': 'Unbilled Payables (Accrual GRN)',
                '211': 'Accounts Payable',
                '212': 'Restaurant Tax Payable (PB1)',
                '301': 'Owner Equity',
                '401': 'Sales Revenue',
                '501': 'Cost of Goods Sold (COGS)',
                '502': 'Cashier Variance Expense',
                '503': 'Inventory Variance Adjustment Expense',
                '601': 'Salary & Wages Expense',
                '602': 'Store Operating Expense (Electricity/Wifi)'
            },
            
            // Initial Balance (Owner equity capital injection Rp 1,500,000)
            initSetup: () => {
                state.journal = [
                    {
                        date: new Date(new Date().setDate(new Date().getDate() - 1)), // Yesterday
                        ref: 'JV-001',
                        description: 'Lekker Story Restaurant Startup Capital Injection',
                        entries: [
                            { account: '101', debit: 1500000, credit: 0 },
                            { account: '301', debit: 0, credit: 1500000 }
                        ]
                    }
                ];
                audit.addLog('SYSTEM', 'ERP initialization successful. Opening equity Rp 1,500,000 entered automatically.');
            },

            addJournal: (ref, description, entries) => {
                state.journal.push({
                    date: new Date(),
                    ref,
                    description,
                    entries
                });
                audit.addLog('ACCOUNTING', `Automatic Journal Posted Ref: ${ref} - ${description}`);
                // PERSIST: also write to Firestore journals collection (non-blocking)
                fs.addJournal(ref, description, entries);
            }
        };

        // --- 3. UTILITIES & HELPER ---
        const utils = {
            formatRp: (num) => new Intl.NumberFormat('en-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num),
            formatRpCompact: (num) => {
                const n = Number(num) || 0;
                const abs = Math.abs(n);
                const sign = n < 0 ? '-' : '';
                if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toFixed(2)}B`;
                if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toFixed(1)}M`;
                if (abs >= 1e4) return `${sign}Rp ${Math.round(abs / 1000)}K`;
                return utils.formatRp(n);
            },
            formatDate: (date) => {
                const d = new Date(date);
                return d.toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
            },
            getInventoryStockValue: () => Object.values(state.inventory).reduce((sum, i) => sum + (i.stock || 0) * (i.cost || 0), 0),
            /** BOM cost using standardized MATERIAL_PRICE_LIST (fallback: live inventory cost) */
            computeMenuBomCost: (ingredientsObj) => {
                const invLookup = { ...LEKKER_DEFAULT_INVENTORY };
                Object.values(state.inventory).forEach(i => {
                    invLookup[i.id] = {
                        ...i,
                        cost: MATERIAL_PRICE_LIST[i.id]?.defaultCost ?? i.cost
                    };
                });
                return computeBomCostFromIngredients(ingredientsObj, invLookup);
            },
            suggestMenuSellingPrice: (bomCost, category = '') => suggestMenuSellingPrice(bomCost, category),
            shortCategoryLabel: (cat) => {
                if (cat === 'all') return 'All items';
                const parts = String(cat).split('·');
                return parts.length > 1 ? parts[parts.length - 1].trim() : cat;
            },
            journalDateKey: (date, mode) => {
                const d = new Date(date);
                if (isNaN(d.getTime())) return '';
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                if (mode === 'day') return `${y}-${m}-${day}`;
                if (mode === 'month') return `${y}-${m}`;
                return '';
            },
            formatBomQty: (invId, qty) => {
                const inv = state.inventory[invId];
                if (!inv || !qty) return '—';
                return utils.formatStockQty(inv, qty);
            },
            /** Fix floating-point noise from BOM deductions (e.g. 21.410000000000004 → 21.41) */
            roundQty: (qty, decimals = 3) => {
                const n = Number(qty);
                if (isNaN(n)) return 0;
                const f = Math.pow(10, decimals);
                const v = Math.round(n * f) / f;
                return Object.is(v, -0) ? 0 : v;
            },
            /** Human-readable stock quantity (whole units for pcs/can/pack; g/ml for small kg/L) */
            formatStockQty: (itemOrInv, qty) => {
                const inv = typeof itemOrInv === 'string' ? state.inventory[itemOrInv] : itemOrInv;
                if (!inv || qty == null || isNaN(qty)) return '—';
                const n = utils.roundQty(qty, inv.unit === 'pcs' || inv.unit === 'can' || inv.unit === 'pack' ? 0 : 3);
                const u = inv.unit || '';
                if (u === 'pcs' || u === 'can' || u === 'pack') {
                    return `${Math.round(n)} ${u}`;
                }
                if (u === 'kg' && n > 0 && n < 1) return `${Math.round(n * 1000)} g`;
                if (u === 'L' && n > 0 && n < 1) return `${Math.round(n * 1000)} ml`;
                if (n % 1 === 0) return `${Math.round(n)} ${u}`;
                return `${n.toFixed(2)} ${u}`;
            },
            isStoreOpen: (date = new Date()) => {
                const mins = date.getHours() * 60 + date.getMinutes();
                return mins >= 10 * 60 && mins < 23 * 60 + 30;
            },
            tickLiveClock: () => {
                const now = new Date();
                const str = now.toLocaleString('en-GB', {
                    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                document.querySelectorAll('[data-live-clock]').forEach(el => { el.textContent = str; });
                const open = utils.isStoreOpen(now);
                document.querySelectorAll('[data-store-status]').forEach(el => {
                    el.textContent = open ? 'Open' : 'Closed';
                    el.className = `store-status ${open ? 'store-status--open' : 'store-status--closed'}`;
                });
            },
            startLiveClock: () => {
                utils.tickLiveClock();
                if (!window._lekkerClockInterval) {
                    window._lekkerClockInterval = setInterval(utils.tickLiveClock, 1000);
                }
            },
            seedInventoryStock: (level = 'demo') => {
                const demoLevels = {
                    inv_tepung: 28, inv_coklat: 18, inv_keju: 12, inv_pisang: 48,
                    inv_gula: 16, inv_susu: 36, inv_cup: 420, inv_kopi: 6,
                    inv_sirup: 14, inv_berry: 10, inv_ovomaltine: 4, inv_crunch: 8,
                    inv_greentea: 3, inv_ayam: 32, inv_bumbu: 22, inv_minyak: 12
                };
                Object.values(state.inventory).forEach(i => {
                    if (level !== 'demo') {
                        i.stock = 0;
                        return;
                    }
                    const def = LEKKER_DEFAULT_INVENTORY[i.id];
                    const par = i.par || def?.par || 5;
                    i.stock = demoLevels[i.id] ?? Math.round(par * 6);
                });
                utils.normalizeInventoryStock();
            },
            toast: (msg, type = 'info') => {
                const colors = { info: 'bg-blue-600 border-blue-800', success: 'bg-emerald-600 border-emerald-800', error: 'bg-red-600 border-red-800', warn: 'bg-amber-600 border-amber-800' };
                const icons = { info: 'circle-info', success: 'circle-check', error: 'triangle-exclamation', warn: 'circle-exclamation' };
                const t = document.createElement('div');
                t.className = `toast-enter ${colors[type]} text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 text-xs font-semibold max-w-sm pointer-events-auto border-b-4`;
                t.innerHTML = `<i class="fas fa-${icons[type]} text-lg"></i> <span>${msg}</span>`;
                document.getElementById('toast-container').appendChild(t);
                setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3500);
            },
            generateId: (prefix) => `${prefix}-${Math.floor(Math.random()*90000 + 10000)}`,

            calcPosTotals: (subtotal) => {
                const base = Math.max(0, Number(subtotal) || 0);
                const tax = Math.round(base * POS_TAX_RATE);
                return { subtotal: base, tax, grandTotal: base + tax };
            },

            /** Aggregate income (401) vs expenses (5xx) by day or month for charts */
            buildIncomeExpenseSeries: (granularity, periodCount) => {
                const buckets = {};
                const keys = [];
                const now = new Date();
                for (let i = periodCount - 1; i >= 0; i--) {
                    const d = new Date(now);
                    let key, label;
                    if (granularity === 'day') {
                        d.setHours(0, 0, 0, 0);
                        d.setDate(d.getDate() - i);
                        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                        label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    } else {
                        d.setDate(1);
                        d.setHours(0, 0, 0, 0);
                        d.setMonth(d.getMonth() - i);
                        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    }
                    keys.push({ key, label });
                    buckets[key] = { income: 0, expense: 0 };
                }
                state.journal.forEach(j => {
                    const d = new Date(j.date);
                    d.setHours(0, 0, 0, 0);
                    const key = granularity === 'day'
                        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    if (!buckets[key]) return;
                    j.entries.forEach(e => {
                        if (e.account === '401') buckets[key].income += (e.credit || 0);
                        if (EXPENSE_ACCOUNTS.includes(e.account)) buckets[key].expense += (e.debit || 0);
                    });
                });
                return {
                    labels: keys.map(k => k.label),
                    income: keys.map(k => buckets[k.key].income),
                    expense: keys.map(k => buckets[k.key].expense)
                };
            },

            computeCoaBalances: (journal = state.journal) => {
                const balances = {};
                Object.keys(accounting.coa).forEach(c => { balances[c] = 0; });
                journal.forEach(j => {
                    j.entries.forEach(e => {
                        balances[e.account] = (balances[e.account] || 0) + (e.debit || 0) - (e.credit || 0);
                    });
                });
                return balances;
            },
            getJournalDebitCreditTotals: (journal = state.journal) => {
                let debit = 0;
                let credit = 0;
                journal.forEach(j => {
                    j.entries.forEach(e => {
                        debit += e.debit || 0;
                        credit += e.credit || 0;
                    });
                });
                return { debit, credit, diff: Math.abs(debit - credit), balanced: Math.abs(debit - credit) < 1 };
            },
            updateBooksBalancedBadge: (elementId = 'fin-books-balanced', journal = state.journal) => {
                const badge = document.getElementById(elementId);
                if (!badge) return;
                const { diff, balanced } = utils.getJournalDebitCreditTotals(journal);
                badge.classList.remove('hide', 'posting-badge--ok', 'posting-badge--warn');
                if (balanced) {
                    badge.classList.add('posting-badge--ok');
                    badge.innerHTML = '<i class="fas fa-check-circle"></i> Books balanced';
                } else {
                    badge.classList.add('posting-badge--warn');
                    badge.innerHTML = `<i class="fas fa-times-circle"></i> Out of balance — ${utils.formatRp(diff)}`;
                }
            },

            renderMetricsTable: (tbodyId, granularity, periodCount) => {
                const tbody = document.getElementById(tbodyId);
                if (!tbody) return;
                const series = utils.buildIncomeExpenseSeries(granularity, periodCount);
                let totalInc = 0;
                let totalExp = 0;
                const rows = series.labels.map((label, i) => {
                    const inc = series.income[i];
                    const exp = series.expense[i];
                    const net = inc - exp;
                    totalInc += inc;
                    totalExp += exp;
                    return `<tr>
                        <td>${label}</td>
                        <td class="num-cell text-emerald-700">${utils.formatRp(inc)}</td>
                        <td class="num-cell text-red-600">${utils.formatRp(exp)}</td>
                        <td class="num-cell ${net >= 0 ? 'text-slate-800' : 'text-red-600'}">${utils.formatRp(net)}</td>
                    </tr>`;
                }).join('');
                tbody.innerHTML = rows + `<tr class="metrics-total-row">
                    <td>Total</td>
                    <td class="num-cell text-emerald-700">${utils.formatRp(totalInc)}</td>
                    <td class="num-cell text-red-600">${utils.formatRp(totalExp)}</td>
                    <td class="num-cell">${utils.formatRp(totalInc - totalExp)}</td>
                </tr>`;
            },

            renderProductSalesTable: (tbodyId) => {
                const tbody = document.getElementById(tbodyId);
                if (!tbody) return;
                const stats = {};
                state.sales.forEach(s => {
                    s.items.forEach(i => {
                        if (!stats[i.name]) stats[i.name] = { qty: 0, revenue: 0 };
                        stats[i.name].qty += i.qty;
                        stats[i.name].revenue += (i.price || 0) * i.qty;
                    });
                });
                const names = Object.keys(stats);
                if (!names.length) {
                    tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-slate-400">No sales yet</td></tr>';
                    return;
                }
                let totalQty = 0;
                let totalRev = 0;
                tbody.innerHTML = names.map(name => {
                    totalQty += stats[name].qty;
                    totalRev += stats[name].revenue;
                    return `<tr>
                        <td>${name}</td>
                        <td class="num-cell">${stats[name].qty}</td>
                        <td class="num-cell">${utils.formatRp(stats[name].revenue)}</td>
                    </tr>`;
                }).join('') + `<tr class="metrics-total-row">
                    <td>Total</td>
                    <td class="num-cell">${totalQty}</td>
                    <td class="num-cell">${utils.formatRp(totalRev)}</td>
                </tr>`;
            },

            setKpiValue: (id, value, isCurrency = true, tone = 'auto', compact = false) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = isCurrency
                    ? (compact || Math.abs(value) >= 1e7 ? utils.formatRpCompact(value) : utils.formatRp(value))
                    : String(value);
                el.title = isCurrency ? utils.formatRp(value) : '';
                el.className = 'kpi-card__value';
                if (tone === 'amber') el.classList.add('kpi-card__value--amber');
                else if (tone === 'positive') el.classList.add('kpi-card__value--positive');
                else if (tone === 'negative') el.classList.add('kpi-card__value--negative');
                else if (tone === 'auto' && isCurrency && value !== 0) {
                    el.classList.add(value >= 0 ? 'kpi-card__value--positive' : 'kpi-card__value--negative');
                }
            },

            renderIncomeExpenseChart: (canvasId, chartKey, granularity, periodCount) => {
                const el = document.getElementById(canvasId);
                if (!el || typeof Chart === 'undefined') return;
                const series = utils.buildIncomeExpenseSeries(granularity, periodCount);
                if (state.chartInstances[chartKey]) {
                    try { state.chartInstances[chartKey].destroy(); } catch (e) {}
                }
                state.chartInstances[chartKey] = new Chart(el.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: series.labels,
                        datasets: [
                            { label: 'Income', data: series.income, backgroundColor: 'rgba(16, 185, 129, 0.85)', borderRadius: 6 },
                            { label: 'Expenses', data: series.expense, backgroundColor: 'rgba(239, 68, 68, 0.85)', borderRadius: 6 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11, weight: '600' } } },
                            tooltip: {
                                callbacks: { label: (ctx) => `${ctx.dataset.label}: ${utils.formatRp(ctx.raw)}` }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (v) => {
                                        if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
                                        if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k';
                                        return v;
                                    }
                                }
                            }
                        }
                    }
                });
            },

            renderProductBarChart: (canvasId, chartKey) => {
                const el = document.getElementById(canvasId);
                if (!el || typeof Chart === 'undefined') return;
                const stats = {};
                state.sales.forEach(s => {
                    s.items.forEach(i => {
                        stats[i.name] = (stats[i.name] || 0) + (i.price || 0) * i.qty;
                    });
                });
                const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 8);
                const labels = entries.length ? entries.map(e => e[0]) : ['No sales yet'];
                const values = entries.length ? entries.map(e => e[1]) : [0];
                if (state.chartInstances[chartKey]) {
                    try { state.chartInstances[chartKey].destroy(); } catch (e) {}
                }
                state.chartInstances[chartKey] = new Chart(el.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Revenue',
                            data: values,
                            backgroundColor: 'rgba(217, 119, 6, 0.85)',
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: entries.length > 5 ? 'y' : 'x',
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: { label: (ctx) => `Revenue: ${utils.formatRp(ctx.raw)}` } }
                        },
                        scales: {
                            y: { beginAtZero: true, ticks: { callback: (v) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v } },
                            x: { ticks: { maxRotation: 45, minRotation: 0, font: { size: 10 } } }
                        }
                    }
                });
            },
            renderStockAlertsTable: (tbodyId = 'mgr-table-stock-alerts') => {
                const tbody = document.getElementById(tbodyId);
                const panel = document.getElementById('mgr-stock-alerts-panel');
                const low = Object.values(state.inventory)
                    .filter(i => i.stock < i.par)
                    .sort((a, b) => (a.stock / a.par) - (b.stock / b.par));
                if (panel) panel.classList.toggle('hide', low.length === 0);
                if (!tbody) return;
                if (!low.length) {
                    tbody.innerHTML = '';
                    return;
                }
                tbody.innerHTML = low.map(i => `
                    <tr>
                        <td class="font-semibold text-slate-700">${i.name}</td>
                        <td class="num-cell text-red-600 font-bold">${utils.formatStockQty(i, i.stock)}</td>
                        <td class="num-cell text-slate-500">${utils.formatStockQty(i, i.par)}</td>
                    </tr>
                `).join('');
            },

            /** Max portions sellable from current raw material stock (BOM) */
            getMenuAvailableStock: (menu) => {
                let min = Infinity;
                Object.entries(menu.ing || {}).forEach(([invId, reqQty]) => {
                    if (reqQty <= 0) return;
                    const inv = state.inventory[invId];
                    const stock = inv ? utils.roundQty(inv.stock, 3) : 0;
                    const portions = inv ? Math.floor(stock / reqQty) : 0;
                    min = Math.min(min, portions);
                });
                return min === Infinity ? 0 : Math.max(0, min);
            },
            normalizeInventoryStock: () => {
                Object.values(state.inventory).forEach(i => {
                    i.stock = utils.roundQty(i.stock, i.unit === 'pcs' || i.unit === 'can' || i.unit === 'pack' ? 0 : 3);
                });
            },

            /** Reset all transactional data & stock to 0 for accuracy testing */
            resetAllData: () => {
                if (!confirm(
                    'RESET TEST DATA\n\n' +
                    '• All sales, PR/PO/GRN, stock → 0\n' +
                    '• Journal keeps opening equity only (Rp 1,500,000)\n' +
                    '• Cloud data is not deleted; local demo mode prevents it from overwriting this session\n\n' +
                    'Continue?'
                )) return;

                realtimeListeners.detach();
                sessionStorage.setItem('lekker_local_only', '1');
                state.useLocalOnly = true;

                state.sales = [];
                state.prs = [];
                state.pos = [];
                state.grns = [];
                state.invoices = [];
                state.auditLogs = [];
                state.cashier.cart = [];
                state.cashier.shiftOpen = false;
                state.cashier.shiftName = '';
                state.cashier.shiftRevenue = 0;
                state.cashier.shiftTax = 0;
                state.cashier.shiftTrx = 0;
                state.cashier.salesCashCollected = 0;
                state.cashier.openingCash = 0;
                state.cashier.queueCounter = 1;
                state.inventory = structuredClone(LEKKER_DEFAULT_INVENTORY);
                state.menus = structuredClone(LEKKER_DEFAULT_MENUS);
                utils.seedInventoryStock(0);
                accounting.initSetup();
                state.auditLogs = [{
                    timestamp: new Date(),
                    module: 'SYSTEM',
                    detail: 'Accuracy test reset — local data & stock = 0',
                    user: state.currentUser?.name || 'SYSTEM'
                }];

                utils.toast('Reset complete. Dashboard should show Rp 0 and 0 transactions.', 'success');
                app.initView();
                if (state.currentUser?.role === 'manager') {
                    try { manager.renderDashboard(); } catch (e) {}
                }
                if (state.currentUser?.role === 'finance' && finance.activeTab === 'dashboard') {
                    try { finance.renderDashboard(); } catch (e) {}
                }
            },

            resumeFirebaseSync: () => {
                if (!confirm('Resume Firebase sync? Server data will appear on the dashboard again.')) return;
                sessionStorage.removeItem('lekker_local_only');
                state.useLocalOnly = false;
                realtimeListeners.detach();
                realtimeListeners.attach();
                utils.toast('Firebase sync resumed.', 'info');
                app.initView();
            },
            
            // Dynamic evaluation data builder (lecturer / ?demo=1)
            loadDemoData: () => {
                realtimeListeners.detach();
                sessionStorage.setItem('lekker_local_only', '1');
                state.useLocalOnly = true;
                utils.toast('Loading sample data…', 'info');

                utils.seedInventoryStock('demo');

                const demoMenu1 = state.menus.find(m => m.name === 'Coklat Keju') || state.menus[0];
                const demoMenu2 = state.menus.find(m => m.name === 'Classic Latte') || state.menus[10];
                const postSale = (saleId, menu, qty, payMethod, cashierName) => {
                    const lineSub = menu.price * qty;
                    const { subtotal, tax, grandTotal } = utils.calcPosTotals(lineSub);
                    let cogs = 0;
                    Object.entries(menu.ing || {}).forEach(([invId, req]) => {
                        const inv = state.inventory[invId];
                        if (inv) {
                            inv.stock -= req * qty;
                            cogs += (inv.cost || 0) * req * qty;
                        }
                    });
                    state.sales.push({
                        id: saleId, items: [{ name: menu.name, price: menu.price, qty }],
                        subtotal, tax, total: grandTotal, paymentMethod: payMethod, time: new Date()
                    });
                    const cashAcc = payMethod === 'Cash' ? '101' : payMethod === 'QRIS' ? '102' : '103';
                    const lines = [
                        { account: cashAcc, debit: grandTotal, credit: 0 },
                        { account: '401', debit: 0, credit: subtotal },
                        { account: '501', debit: cogs, credit: 0 },
                        { account: '110', debit: 0, credit: cogs }
                    ];
                    if (tax > 0) lines.splice(2, 0, { account: '212', debit: 0, credit: tax });
                    accounting.addJournal(saleId, `POS Sale (${cashierName}) — ${payMethod} [Demo]`, lines);
                };
                postSale('SALE-1011', demoMenu1, 8, 'QRIS', 'Demo Cashier');
                postSale('SALE-1012', demoMenu2, 5, 'Cash', 'Demo Cashier');

                // 3. Add PR that is automatically approved into PO, GRN, and 3-Way Match
                const prId = utils.generateId('PR');
                const poId = utils.generateId('PO');
                const grnId = utils.generateId('GRN');
                const invId = utils.generateId('INV-SYS');

                state.prs.push({ id: prId, itemId: 'inv_tepung', itemName: 'Premium Wheat Flour', qty: 15, status: 'Approved' });
                state.pos.push({ id: poId, prId: prId, itemId: 'inv_tepung', itemName: 'Premium Wheat Flour', qty: 15, unitCost: MATERIAL_PRICE_LIST.inv_tepung.defaultCost, supplier: 'CV. Agro Sembako', status: 'Invoiced' });
                state.grns.push({ id: grnId, poId: poId, itemId: 'inv_tepung', qty: 15, status: 'Matched' });
                state.inventory['inv_tepung'].stock += 15;

                accounting.addJournal(grnId, `PO Goods Receipt: ${poId} (Premium Wheat Flour)`, [
                    { account: '110', debit: 180000, credit: 0 },
                    { account: '210', debit: 0, credit: 180000 }
                ]);

                state.invoices.push({ id: invId, manualInv: 'INV-DEMO-991', poId, grnId, amount: 180000, status: 'Verified & AP Created', fileName: 'mock_invoice.jpg' });
                accounting.addJournal(invId, `AP Liability Recognition - Supplier CV. Agro Sembako`, [
                    { account: '210', debit: 180000, credit: 0 },
                    { account: '211', debit: 0, credit: 180000 }
                ]);

                // 4. Add manual expense transaction (Electricity & Wifi)
                accounting.addJournal('JV-992', 'Store Electricity & Wifi Expense Payment', [
                    { account: '602', debit: 350000, credit: 0 },
                    { account: '101', debit: 0, credit: 350000 }
                ]);

                utils.normalizeInventoryStock();
                utils.toast('Sample data loaded: sales, P2P, journal & financial reports.', 'success');
                app.initView();
                if (state.currentUser?.role === 'finance') {
                    try { finance.renderDashboard(); } catch (e) {}
                }
            }
        };

        // --- 4. AUDIT & INTERNAL CONTROL LOG ENGINE ---
        const audit = {
            addLog: (module, detail) => {
                state.auditLogs.unshift({
                    timestamp: new Date(),
                    module,
                    detail,
                    user: state.currentUser ? state.currentUser.name : 'SYSTEM'
                });
                finance.renderAuditLogs();
                // PERSIST: write to Firestore activity_logs (non-blocking)
                fs.log(`${module}: ${detail}`, module);
            },
            clearLogs: () => {
                state.auditLogs = [];
                audit.addLog('SYSTEM', 'System log cleared.');
                utils.toast('Audit log cleared.', 'info');
            }
        };

        // --- 5. APP CONTROLLER (LOGIN, AUTH, ROUTING) ---
        // RESTORE 2: login() now uses Firebase Auth (signInWithEmailAndPassword).
        // On success it reads users/{uid} from Firestore to get name+role.
        // If the Firestore document is missing, a local default is used so the
        // UI never shows a blank page. logout() calls Firebase signOut().
        // initView() restored to original role-routing logic with null guards
        // so it never crashes when a role view element is missing.
        const app = {
            fillLogin: (email) => {
                document.getElementById('login-email').value = email;
                document.getElementById('login-password').value = 'password123';
            },
            login: async () => {
                const email    = document.getElementById('login-email').value.trim();
                const password = document.getElementById('login-password').value;
                if (!email || !password) {
                    return utils.toast('Email and password are required.', 'warn');
                }
                utils.toast('Contacting authentication server...', 'info');
                try {
                    const cred = await signInWithEmailAndPassword(auth, email, password);
                    const uid  = cred.user.uid;

                    // Try to load role+name from Firestore users/{uid}
                    let userData = null;
                    try {
                        const snap = await getDoc(doc(db, 'users', uid));
                        if (snap.exists()) {
                            userData = snap.data();  // { name, role }
                        }
                    } catch (fsErr) {
                        console.warn('[app.login] Firestore read failed, using fallback:', fsErr.message);
                    }

                    // RESTORE 2b: Firestore-missing fallback - derive role from email prefix
                    // so the app always renders even when Firestore collections are empty.
                    if (!userData) {
                        const emailPrefix = email.split('@')[0].toLowerCase();
                        const roleMap = { cashier: 'cashier', manager: 'manager', finance: 'finance' };
                        const detectedRole = roleMap[emailPrefix] || 'cashier';
                        userData = { name: cred.user.displayName || emailPrefix, role: detectedRole };
                        console.warn('[app.login] Firestore doc missing - using email-derived role:', detectedRole);
                    }

                    state.currentUser = userData;
                    // Attach uid for Firestore writes
                    state.currentUser.uid = cred.user.uid;

                    // PERSIST: Upsert user document in Firestore
                    try {
                        await setDoc(doc(db, 'users', cred.user.uid), {
                            name:      state.currentUser.name,
                            email:     email,
                            role:      state.currentUser.role,
                            createdAt: serverTimestamp()
                        }, { merge: true });
                    } catch(e) { console.warn('[login] upsert user doc:', e.message); }

                    utils.toast(`Welcome, ${state.currentUser.name}!`, 'success');
                    audit.addLog('LOGIN', `User ${state.currentUser.name} logged in with role ${state.currentUser.role}`);
                    realtimeListeners.attach();
                    app.initView();
                } catch (err) {
                    utils.toast(`Login Failed: ${err.message}`, 'error');
                }
            },
            logout: async () => {
                if (state.currentUser) {
                    audit.addLog('LOGOUT', `User ${state.currentUser.name} logged out of the system.`);
                }
                realtimeListeners.detach();
                try { await signOut(auth); } catch(e) { /* silently ignore */ }
                state.currentUser = null;
                document.querySelectorAll('div[id^="view-"]').forEach(el => el.classList.add('hide'));
                const nav = document.getElementById('global-nav');
                if (nav) nav.classList.add('hide');
                const loginView = document.getElementById('view-login');
                if (loginView) loginView.classList.remove('hide');
                const emailEl = document.getElementById('login-email');
                const passEl  = document.getElementById('login-password');
                if (emailEl) emailEl.value = '';
                if (passEl)  passEl.value  = '';
            },
            initView: () => {
                if (!state.currentUser) return; // guard: never render without a user

                // Hide login, show nav
                const loginView = document.getElementById('view-login');
                const nav       = document.getElementById('global-nav');
                if (loginView) loginView.classList.add('hide');

                const nameEl  = document.getElementById('nav-user-name');
                const badgeEl = document.getElementById('nav-role-badge');
                if (nameEl)  nameEl.innerText  = state.currentUser.name;
                const roleLabel = state.currentUser.role.charAt(0).toUpperCase() + state.currentUser.role.slice(1);
                if (badgeEl) badgeEl.innerText = roleLabel;

                const tabsManager = document.getElementById('portal-tabs-manager');
                const tabsFinance = document.getElementById('portal-tabs-finance');
                if (tabsManager) tabsManager.classList.add('hide');
                if (tabsFinance) tabsFinance.classList.add('hide');

                const isCashier = state.currentUser.role === 'cashier';
                if (nav) {
                    if (isCashier) nav.classList.add('hide');
                    else nav.classList.remove('hide');
                }
                if (state.currentUser.role === 'manager' && tabsManager) tabsManager.classList.remove('hide');
                if (state.currentUser.role === 'finance' && tabsFinance) tabsFinance.classList.remove('hide');
                utils.startLiveClock();

                // Hide all role views, then show the correct one
                const allViews = ['view-cashier', 'view-manager', 'view-finance'];
                allViews.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hide');
                });

                const roleViewMap = { cashier: 'view-cashier', manager: 'view-manager', finance: 'view-finance' };
                const targetId    = roleViewMap[state.currentUser.role];

                if (targetId) {
                    const targetEl = document.getElementById(targetId);
                    if (targetEl) {
                        targetEl.classList.remove('hide');
                    } else {
                        // View element missing in DOM - show login and warn
                        console.error('[initView] View element not found:', targetId);
                        utils.toast('View not found. Please refresh the page.', 'error');
                        if (loginView) loginView.classList.remove('hide');
                        return;
                    }
                } else {
                    // Unknown role - fallback: show cashier view as default
                    console.warn('[initView] Unknown role, showing default cashier view:', state.currentUser.role);
                    const defaultEl = document.getElementById('view-cashier');
                    if (defaultEl) defaultEl.classList.remove('hide');
                    state.currentUser.role = 'cashier';
                }

                // Trigger the role-specific init
                if (state.currentUser.role === 'cashier')   pos.init();
                if (state.currentUser.role === 'manager') manager.init();
                if (state.currentUser.role === 'finance') finance.init();
            }
        };

        // RESTORE 2c: Session persistence - restore login state if user revisits the tab.
        // Uses onAuthStateChanged so Firebase handles the token refresh automatically.
        // Only runs once on page load; does NOT interfere with the logout flow.
        onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser && !state.currentUser) {
                // User is still signed in from a previous session
                let userData = null;
                try {
                    const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
                    if (snap.exists()) userData = snap.data();
                } catch (e) {
                    console.warn('[onAuthStateChanged] Firestore unavailable:', e.message);
                }
                if (!userData) {
                    const prefix = (firebaseUser.email || '').split('@')[0].toLowerCase();
                    const roleMap = { cashier: 'cashier', manager: 'manager', finance: 'finance' };
                    userData = { name: firebaseUser.displayName || prefix, role: roleMap[prefix] || 'cashier' };
                }
                state.currentUser = userData;
                state.currentUser.uid = firebaseUser.uid;
                realtimeListeners.attach();
                app.initView();
            }
            // If firebaseUser is null, the login page is already visible (default HTML state)
        });

        // --- 6. TERMINAL POS (CASHIER) LOGIC & CONTROLLER ---
        const pos = {
            activeCategory: 'all',
            init: () => {
                pos.renderCategories();
                pos.render();
                pos.renderShiftStats();
                pos.renderShiftLog();
            },
            renderShiftStats: () => {
                const c = state.cashier;
                const revEl = document.getElementById('pos-stat-shift-rev');
                const ordEl = document.getElementById('pos-stat-shift-orders');
                const cashEl = document.getElementById('pos-stat-shift-cash');
                const topStats = document.getElementById('pos-topbar-shift-stats');
                if (revEl) revEl.textContent = utils.formatRp(c.shiftRevenue || 0);
                if (ordEl) ordEl.textContent = String(c.shiftTrx || 0);
                if (cashEl) cashEl.textContent = utils.formatRp(c.salesCashCollected || 0);
                if (topStats) topStats.classList.toggle('hide', !c.shiftOpen);
                pos.updateQueueBadge();
                pos.renderActiveShiftBar();
            },
            renderActiveShiftBar: () => {
                const shiftLine = document.getElementById('pos-active-shift-time');
                const nameEl = document.getElementById('pos-active-cashier-name');
                if (!shiftLine) return;
                if (!state.cashier.shiftOpen) {
                    shiftLine.classList.add('hide');
                    return;
                }
                shiftLine.classList.remove('hide');
                if (nameEl) {
                    const since = state.cashier.shiftOpenTime
                        ? ` · ${new Date(state.cashier.shiftOpenTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                        : '';
                    nameEl.textContent = `${state.cashier.shiftName}${since}`;
                }
            },
            renderShiftLog: () => {
                /* Roster kept in state only — does not use cart UI space */
            },
            renderCategories: () => {
                const cats = [...new Set(state.menus.map(m => m.category))];
                const dropdown = document.getElementById('pos-cat-dropdown');
                const hint = document.getElementById('pos-menu-count');
                const dropdownCats = ['all', ...cats];

                if (dropdown) {
                    dropdown.innerHTML = dropdownCats.map(c => {
                        const short = utils.shortCategoryLabel(c);
                        const full = c === 'all' ? 'All items' : c;
                        return `<option value="${c.replace(/"/g, '&quot;')}" title="${full}">${short}</option>`;
                    }).join('');
                    dropdown.value = pos.activeCategory;
                }
                if (hint) {
                    const n = pos.activeCategory === 'all'
                        ? state.menus.length
                        : state.menus.filter(m => m.category === pos.activeCategory).length;
                    hint.textContent = pos.activeCategory === 'all'
                        ? `Showing all ${n} items`
                        : `${utils.shortCategoryLabel(pos.activeCategory)} · ${n} items`;
                }
            },
            filterMenu: (cat) => {
                pos.activeCategory = cat;
                const dropdown = document.getElementById('pos-cat-dropdown');
                if (dropdown) dropdown.value = cat;
                pos.renderCategories();
                pos.render();
            },
            render: () => {
                const container = document.getElementById('pos-menu-container');
                const filtered = pos.activeCategory === 'all' ? state.menus : state.menus.filter(m => m.category === pos.activeCategory);

                if(filtered.length === 0) {
                    container.innerHTML = `<div class="col-span-full text-center text-slate-400 py-12 text-sm">No items in this category. Add menus in Manager → Menu &amp; BOM.</div>`;
                    return;
                }

                container.innerHTML = filtered.map(m => {
                    const avail = utils.getMenuAvailableStock(m);
                    const stockCls = avail === 0 ? 'bg-red-100 text-red-700 border-red-200' : avail <= 3 ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200';
                    const outClass = avail === 0 ? 'pos-menu-card--out' : '';
                    return `
                    <div onclick="pos.addToCart('${m.id}')" class="pos-menu-card ${outClass} group">
                        <div class="card-emoji-bg">${m.emoji}</div>
                        <div class="flex justify-between items-start relative z-10">
                            <div class="text-3xl">${m.emoji}</div>
                            <span class="pos-stock-badge ${stockCls}">${avail} portions</span>
                        </div>
                        <div class="relative z-10">
                            <div class="font-bold text-slate-800 text-xs leading-snug group-hover:text-brand-600 transition">${m.name}</div>
                            <div class="text-brand-600 font-extrabold text-sm mt-1">${utils.formatRp(m.price)}</div>
                        </div>
                    </div>`;
                }).join('');
                pos.renderCart();
            },
            addToCart: (menuId) => {
                if(!state.cashier.shiftOpen) return utils.toast('System locked! Open cashier shift first.', 'error');
                const menu = state.menus.find(m => m.id === menuId);
                const existing = state.cashier.cart.find(c => c.id === menuId);
                
                // BOM Recipe Availability Check
                let canAdd = true;
                let outOfItem = '';
                Object.entries(menu.ing).forEach(([invId, reqQty]) => {
                    const inv = state.inventory[invId];
                    const qtyInCart = existing ? existing.qty : 0;
                    if(!inv || inv.stock < (reqQty * (qtyInCart + 1))) {
                        canAdd = false;
                        outOfItem = inv ? inv.name : 'Raw Material';
                    }
                });

                if(!canAdd) return utils.toast(`Material stock (${outOfItem}) is insufficient to prepare this menu item!`, 'error');

                if(existing) existing.qty++;
                else state.cashier.cart.push({ ...menu, qty: 1 });
                pos.renderCart();
            },
            renderCart: () => {
                const cartBox = document.getElementById('pos-cart-items');
                const countEl = document.getElementById('pos-cart-count');
                const heroTotal = document.getElementById('pos-cart-hero-total');
                const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

                if (state.cashier.cart.length === 0) {
                    cartBox.innerHTML = `
                        <div class="pos-cart-empty">
                            <i class="fas fa-shopping-basket"></i>
                            <p>No items yet — choose a menu on the left</p>
                        </div>`;
                    if (countEl) countEl.textContent = 'Cart is empty';
                    setText('pos-subtotal', 'Rp 0');
                    setText('pos-tax', 'Rp 0');
                    setText('pos-total', 'Rp 0');
                    if (heroTotal) heroTotal.textContent = 'Rp 0';
                    const btn = document.getElementById('btn-checkout');
                    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-receipt"></i> Pay &amp; print receipt'; }
                    pos.renderShiftStats();
                    return;
                }

                let subtotal = 0;
                let totalQty = 0;
                cartBox.innerHTML = state.cashier.cart.map((item, index) => {
                    const itemTotal = item.price * item.qty;
                    subtotal += itemTotal;
                    totalQty += item.qty;
                    return `
                        <div class="pos-cart-item" role="listitem">
                            <span class="pos-cart-item__name">${item.emoji ? item.emoji + ' ' : ''}${item.name}</span>
                            <span class="pos-cart-item__meta">${utils.formatRp(item.price)} per item</span>
                            <div class="pos-cart-item__qty">
                                <span class="pos-cart-item__price">${utils.formatRp(itemTotal)}</span>
                                <div class="pos-cart-item__actions">
                                    <button type="button" class="pos-cart-item__btn" onclick="pos.changeQty(${index}, -1)" aria-label="Decrease">−</button>
                                    <span class="text-sm font-black text-slate-700 min-w-[1.25rem] text-center">${item.qty}</span>
                                    <button type="button" class="pos-cart-item__btn" onclick="pos.changeQty(${index}, 1)" aria-label="Increase">+</button>
                                    <button type="button" class="pos-cart-item__btn pos-cart-item__btn--del" onclick="pos.removeItem(${index})" aria-label="Remove"><i class="fas fa-trash-can"></i></button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                const { tax, grandTotal } = utils.calcPosTotals(subtotal);
                const itemWord = state.cashier.cart.length === 1 ? 'menu' : 'menu';
                if (countEl) countEl.textContent = `${totalQty} item · ${state.cashier.cart.length} ${itemWord}`;
                setText('pos-subtotal', utils.formatRp(subtotal));
                setText('pos-tax', utils.formatRp(tax));
                setText('pos-total', utils.formatRp(grandTotal));
                if (heroTotal) heroTotal.textContent = utils.formatRp(grandTotal);
                const btn = document.getElementById('btn-checkout');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-receipt"></i> Pay &amp; print receipt'; }
                pos.renderShiftStats();
            },
            changeQty: (index, delta) => {
                const item = state.cashier.cart[index];
                if (!item) return;
                if (delta > 0) {
                    const menu = state.menus.find(m => m.id === item.id);
                    if (menu) {
                        let canAdd = true;
                        let outOfItem = '';
                        Object.entries(menu.ing || {}).forEach(([invId, reqQty]) => {
                            const inv = state.inventory[invId];
                            if (!inv || inv.stock < reqQty * (item.qty + 1)) {
                                canAdd = false;
                                outOfItem = inv ? inv.name : 'ingredient';
                            }
                        });
                        if (!canAdd) return utils.toast(`Stock of ${outOfItem} is insufficient.`, 'warn');
                    }
                    item.qty++;
                } else {
                    if (item.qty <= 1) {
                        state.cashier.cart.splice(index, 1);
                    } else {
                        item.qty--;
                    }
                }
                pos.renderCart();
            },
            removeItem: (index) => {
                state.cashier.cart.splice(index, 1);
                pos.renderCart();
            },
            checkout: async () => {
                if (!utils.isStoreOpen()) return utils.toast('Store is closed. Operating hours: 10:00 – 23:30.', 'warn');
                if (!state.cashier.shiftOpen) return utils.toast('Open cashier shift first.', 'error');
                if (state.cashier.cart.length === 0) return utils.toast('Cart is empty.', 'warn');
                if (state._checkoutBusy) return;

                const payEl = document.querySelector('input[name="pay_method"]:checked');
                if (!payEl) return utils.toast('Select a payment method.', 'warn');

                state._checkoutBusy = true;
                const btn = document.getElementById('btn-checkout');
                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...'; }

                try {
                const subtotal = state.cashier.cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
                const { tax, grandTotal } = utils.calcPosTotals(subtotal);
                const payMethod = payEl.value;
                const queueNo = state.cashier.queueCounter++;
                const cartSnapshot = [...state.cashier.cart];
                
                // 1. Calculate standard COGS (HPP) based on recipe & deduct stock
                let totalCOGS = 0;
                state.cashier.cart.forEach(item => {
                    Object.entries(item.ing).forEach(([invId, reqQty]) => {
                        const usedQty = reqQty * item.qty;
                        if(state.inventory[invId]) {
                            state.inventory[invId].stock -= usedQty;
                            totalCOGS += (usedQty * state.inventory[invId].cost);
                        }
                    });
                });

                // 2. Determine Cash/Bank Receipt Account based on payment method selection
                let receivingAccount = '101'; // Default Cash
                if(payMethod === 'QRIS') receivingAccount = '102';
                if(payMethod === 'Card') receivingAccount = '103';

                // 3. Record in the sales system (local state)
                const saleId = utils.generateId('SALE');
                state.sales.push({
                    id: saleId,
                    items: cartSnapshot,
                    subtotal,
                    tax,
                    total: grandTotal,
                    paymentMethod: payMethod,
                    shiftName: state.cashier.shiftName,
                    shiftId: state.cashier.activeShiftId,
                    queueNo,
                    time: new Date()
                });

                state.cashier.shiftRevenue += subtotal;
                state.cashier.shiftTax += tax;
                state.cashier.shiftTrx++;
                state.cashier.lastQueueNo = queueNo;
                if (payMethod === 'Cash') {
                    state.cashier.salesCashCollected += grandTotal;
                }
                utils.normalizeInventoryStock();
                const liveShift = state.shiftLog.find(s => s.shiftId === state.cashier.activeShiftId);
                if (liveShift) {
                    liveShift.revenue = state.cashier.shiftRevenue;
                    liveShift.trx = state.cashier.shiftTrx;
                    liveShift.cashCollected = state.cashier.salesCashCollected;
                }

                // 4. Double-entry: Dr kas/bank, Cr penjualan + PB1 (212), COGS
                const journalLines = [
                    { account: receivingAccount, debit: grandTotal, credit: 0 },
                    { account: '401', debit: 0, credit: subtotal },
                    { account: '212', debit: 0, credit: tax },
                    { account: '501', debit: totalCOGS, credit: 0 },
                    { account: '110', debit: 0, credit: totalCOGS }
                ];
                accounting.addJournal(saleId, `POS sale #${queueNo} (${state.cashier.shiftName}) - ${payMethod}`, journalLines);

                audit.addLog('POS', `Queue #${queueNo} | ${saleId} | ${payMethod} | ${utils.formatRp(grandTotal)}`);

                // UI first — do not wait for Firestore (Pay & Print responsiveness)
                pos.printReceipt(saleId, subtotal, tax, grandTotal, payMethod, cartSnapshot, queueNo);
                state.cashier.cart = [];
                pos.render();
                pos.renderShiftStats();
                pos.renderShiftLog();
                pos.updateQueueBadge();
                utils.toast(`Queue #${queueNo} — sale posted. Stock & journal updated.`, 'success');

                // Firestore di background
                (async () => {
                    try {
                        const batch = writeBatch(db);
                        batch.set(doc(db, 'transactions', saleId), {
                            transactionId: saleId,
                            queueNo,
                            userId: state.currentUser?.uid || 'unknown',
                            role: state.currentUser?.role || 'cashier',
                            cashierName: state.cashier.shiftName,
                            items: cartSnapshot.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
                            subtotal,
                            tax,
                            total: grandTotal,
                            totalCOGS,
                            paymentMethod: payMethod,
                            status: 'completed',
                            createdAt: serverTimestamp()
                        });
                        await batch.commit();
                        const invUpdates = [];
                        cartSnapshot.forEach(item => {
                            Object.entries(item.ing).forEach(([invId, reqQty]) => {
                                const usedQty = reqQty * item.qty;
                                invUpdates.push(fs.reduceInventory(invId, usedQty));
                                invUpdates.push(fs.syncProductStock(invId, state.inventory[invId]?.stock || 0));
                            });
                        });
                        await Promise.all(invUpdates);
                    } catch (fsErr) {
                        console.warn('[checkout] Firestore:', fsErr.message);
                    }
                })();

                } catch (err) {
                    console.error('[checkout]', err);
                    utils.toast('Transaction failed: ' + (err.message || 'error'), 'error');
                } finally {
                    state._checkoutBusy = false;
                    const btnDone = document.getElementById('btn-checkout');
                    if (btnDone) {
                        btnDone.disabled = state.cashier.cart.length === 0;
                        btnDone.innerHTML = '<i class="fas fa-receipt"></i> Pay & Print';
                    }
                }
            },
            updateQueueBadge: () => {
                const lastEl = document.getElementById('pos-queue-badge');
                const nextEl = document.getElementById('pos-queue-next');
                const last = state.cashier.lastQueueNo;
                const next = state.cashier.queueCounter;
                if (lastEl) lastEl.textContent = last > 0 ? `#${last}` : '—';
                if (nextEl) nextEl.textContent = `#${next}`;
            },
            closeReceipt: () => {
                document.getElementById('receipt-modal')?.classList.add('hide');
            },
            printReceiptPaper: () => {
                const paper = document.getElementById('receipt-content');
                if (!paper) return;
                const w = window.open('', '_blank', 'width=400,height=720');
                if (!w) {
                    utils.toast('Allow pop-ups to print the receipt.', 'warn');
                    return;
                }
                w.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
                    <style>
                        body { margin: 0; padding: 12px; font-family: Consolas, monospace; font-size: 12px; color: #1e293b; }
                        .receipt-paper { max-width: 280px; margin: 0 auto; }
                        .receipt-paper__queue-num { font-size: 36px; font-weight: 900; text-align: center; }
                        .receipt-paper__total { font-size: 14px; font-weight: 900; border-top: 2px solid #000; padding-top: 8px; margin-top: 8px; }
                        hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
                    </style></head><body>${paper.outerHTML}</body></html>`);
                w.document.close();
                w.focus();
                w.print();
                w.close();
            },
            printReceipt: (saleId, subtotal, tax, grandTotal, payMethod, items, queueNo) => {
                const c = document.getElementById('receipt-content');
                const modal = document.getElementById('receipt-modal');
                if (!c || !modal) {
                    console.warn('[printReceipt] receipt-modal missing');
                    return utils.toast(`Receipt #${queueNo} — ${utils.formatRp(grandTotal)} (${payMethod})`, 'success');
                }
                const now = new Date();
                const payIcon = payMethod === 'Cash' ? 'fa-money-bill-wave' : payMethod === 'QRIS' ? 'fa-qrcode' : 'fa-credit-card';
                c.innerHTML = `
                    <header class="receipt-paper__brand">
                        <p class="receipt-paper__logo">🍫 LEKKER STORY</p>
                        <p class="receipt-paper__tagline">Fresh bites &amp; drinks</p>
                        <p class="receipt-paper__meta">${utils.formatDate(now)}</p>
                    </header>
                    <section class="receipt-paper__queue" aria-label="Queue number">
                        <p class="receipt-paper__queue-label">Queue</p>
                        <p class="receipt-paper__queue-num">${queueNo}</p>
                    </section>
                    <hr class="receipt-paper__divider">
                    <div class="receipt-paper__row"><span>Receipt</span><span>${saleId}</span></div>
                    <div class="receipt-paper__row"><span>Cashier</span><span>${state.cashier.shiftName || '—'}</span></div>
                    <hr class="receipt-paper__divider">
                    <section class="receipt-paper__items">
                        ${items.map(i => `
                            <div class="receipt-paper__item">
                                <span class="receipt-paper__item-name">${i.name}</span>
                                <span class="receipt-paper__item-qty">${i.qty} × ${utils.formatRp(i.price)}</span>
                                <span class="receipt-paper__item-price">${utils.formatRp(i.price * i.qty)}</span>
                            </div>
                        `).join('')}
                    </section>
                    <hr class="receipt-paper__divider">
                    <div class="receipt-paper__row"><span>Subtotal</span><span>${utils.formatRp(subtotal)}</span></div>
                    <div class="receipt-paper__row"><span>PB1 (10%)</span><span>${utils.formatRp(tax)}</span></div>
                    <div class="receipt-paper__total"><span>TOTAL</span><span>${utils.formatRp(grandTotal)}</span></div>
                    <div class="receipt-paper__pay"><span><i class="fas ${payIcon}"></i> Payment</span><strong>${payMethod}</strong></div>
                    <p class="receipt-paper__thanks">Thank you — see you again!</p>
                `;
                modal.classList.remove('hide');
            },
            toggleShift: () => {
                const badge = document.getElementById('shift-status-badge');
                const btn = document.getElementById('btn-toggle-shift');
                const overlay = document.getElementById('pos-overlay-shift');
                
                if(!state.cashier.shiftOpen) {
                    const name = document.getElementById('shift-cashier-name').value.trim();
                    const opCash = parseFloat(document.getElementById('shift-opening-cash').value);
                    if(!name) return utils.toast('Cashier operator must enter a name before opening shift!', 'warn');
                    if(isNaN(opCash) || opCash < 0) return utils.toast('Drawer cash balance is invalid!', 'warn');

                    const shiftId = utils.generateId('SHIFT');
                    state.cashier.shiftOpen = true;
                    state.cashier.shiftName = name;
                    state.cashier.activeShiftId = shiftId;
                    state.cashier.openingCash = opCash;
                    state.cashier.salesCashCollected = 0;
                    state.cashier.shiftRevenue = 0;
                    state.cashier.shiftTrx = 0;
                    state.cashier.lastQueueNo = 0;
                    state.cashier.queueCounter = 1;
                    state.cashier.shiftOpenTime = new Date();

                    state.shiftLog.unshift({
                        shiftId,
                        cashierName: name,
                        openedAt: new Date(),
                        closedAt: null,
                        openingCash: opCash,
                        revenue: 0,
                        trx: 0,
                        cashCollected: 0
                    });

                    badge.className = 'shift-badge shift-badge--open';
                    badge.innerText = `Shift: ${name}`;
                    btn.innerText = 'Close shift';
                    overlay.classList.add('hide');

                    document.getElementById('nav-user-name').innerText = `${name} (Cashier)`;
                    
                    audit.addLog('POS', `Shift opened by ${name} with opening drawer cash: ${utils.formatRp(opCash)}`);
                    pos.renderShiftStats();
                    pos.renderShiftLog();
                    utils.toast(`Shift opened — ${name}. Queue starts at #1.`, 'success');
                } else {
                    // Open cash count reconciliation dialog
                    const expectedCash = state.cashier.openingCash + state.cashier.salesCashCollected;
                    const setClose = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
                    setClose('close-modal-cashier', state.cashier.shiftName);
                    setClose('close-modal-orders', String(state.cashier.shiftTrx));
                    setClose('close-modal-revenue', utils.formatRp(state.cashier.shiftRevenue));
                    setClose('close-modal-op-cash', utils.formatRp(state.cashier.openingCash));
                    setClose('close-modal-sales-cash', utils.formatRp(state.cashier.salesCashCollected));
                    setClose('close-modal-expected-cash', utils.formatRp(expectedCash));
                    document.getElementById('pos-close-shift-modal').classList.remove('hide');
                }
            },
            submitCloseShift: () => {
                const endingCashCountInput = parseFloat(document.getElementById('shift-ending-cash-count').value);
                if(isNaN(endingCashCountInput) || endingCashCountInput < 0) return utils.toast('Counted cash amount is invalid.', 'warn');

                const expectedCash = state.cashier.openingCash + state.cashier.salesCashCollected;
                const variance = endingCashCountInput - expectedCash;

                if (Math.abs(variance) > Math.max(500000, expectedCash * 3)) {
                    return utils.toast(
                        `Variance ${utils.formatRp(variance)} is too large. Recount cash (expected ≈ ${utils.formatRp(expectedCash)}).`,
                        'error'
                    );
                }

                // Record cash variance adjustment journal entry if any
                if(variance !== 0) {
                    const jvId = utils.generateId('JV');
                    if(variance < 0) { // Shortage
                        accounting.addJournal(jvId, `Cash Shortage Expense (Cashier: ${state.cashier.shiftName})`, [
                            { account: '502', debit: Math.abs(variance), credit: 0 },
                            { account: '101', debit: 0, credit: Math.abs(variance) }
                        ]);
                        audit.addLog('AUDIT', `🚨 Cash shortage detected: ${utils.formatRp(variance)} during shift ${state.cashier.shiftName}`);
                    } else { // Overage
                        accounting.addJournal(jvId, `Cash Overage Gain (Cashier: ${state.cashier.shiftName})`, [
                            { account: '101', debit: variance, credit: 0 },
                            { account: '502', debit: 0, credit: variance } 
                        ]);
                        audit.addLog('AUDIT', `🚨 Cash overage detected: ${utils.formatRp(variance)} during shift ${state.cashier.shiftName}`);
                    }
                }

                const closedName = state.cashier.shiftName;
                audit.addLog('POS', `Shift closed by ${closedName}. Orders: ${state.cashier.shiftTrx}, Revenue: ${utils.formatRp(state.cashier.shiftRevenue)}, Variance: ${utils.formatRp(variance)}`);

                const activeLog = state.shiftLog.find(s => s.shiftId === state.cashier.activeShiftId);
                if (activeLog) {
                    activeLog.closedAt = new Date();
                    activeLog.revenue = state.cashier.shiftRevenue;
                    activeLog.trx = state.cashier.shiftTrx;
                    activeLog.cashCollected = state.cashier.salesCashCollected;
                }

                state.cashier.shiftOpen = false;
                state.cashier.shiftName = '';
                state.cashier.activeShiftId = null;
                state.cashier.shiftRevenue = 0;
                state.cashier.shiftTrx = 0;
                state.cashier.salesCashCollected = 0;
                state.cashier.lastQueueNo = 0;
                document.getElementById('pos-close-shift-modal').classList.add('hide');
                const badgeEl = document.getElementById('shift-status-badge');
                if (badgeEl) { badgeEl.className = 'shift-badge shift-badge--closed'; badgeEl.innerText = 'Shift closed'; }
                const shiftBtn = document.getElementById('btn-toggle-shift');
                if (shiftBtn) shiftBtn.innerText = 'Open shift';
                document.getElementById('pos-overlay-shift').classList.remove('hide');
                document.getElementById('nav-user-name').innerText = state.currentUser.name;

                pos.renderShiftStats();
                pos.renderShiftLog();
                utils.toast(`Shift closed — ${closedName}. ${activeLog?.trx || 0} orders, ${utils.formatRp(activeLog?.revenue || 0)} revenue.`, 'info');
            }
        };

        // --- 7. MANAGER MODULE (DASHBOARD & RECIPE FORMULA) ---
        const manager = {
            selectedAdjItem: null,
            init: () => {
                manager.switchTab('dashboard');
            },
            switchTab: (tabId) => {
                document.querySelectorAll('.manager-tab').forEach(btn => btn.classList.remove('erp-nav-tab-active'));
                const active = document.querySelector(`.manager-tab[data-tab="${tabId}"]`);
                if (active) active.classList.add('erp-nav-tab-active');

                document.querySelectorAll('.mgr-content').forEach(el => el.classList.add('hide'));
                const panel = document.getElementById(`mgr-tab-${tabId}`);
                if (panel) {
                    panel.classList.remove('hide');
                    panel.classList.add('tab-panel-enter');
                    setTimeout(() => panel.classList.remove('tab-panel-enter'), 450);
                }

                if(tabId === 'dashboard') manager.renderDashboard();
                if(tabId === 'inventory') manager.renderInventory();
                if(tabId === 'procurement') manager.renderProcurement();
                if(tabId === 'menu') manager.renderMenu();
            },
            renderDashboard: () => {
                let totalRev = state.sales.reduce((sum, s) => sum + (s.subtotal ?? s.total ?? 0), 0);
                if (totalRev === 0) {
                    state.journal.forEach(j => {
                        j.entries.forEach(e => {
                            if (e.account === '401') totalRev += (e.credit || 0);
                        });
                    });
                }
                let totalExpense = 0;
                let totalCOGS = 0;
                state.journal.forEach(j => {
                    j.entries.forEach(e => {
                        if (e.account === '501') {
                            totalCOGS += (e.debit || 0);
                            totalExpense += (e.debit || 0);
                        }
                        if (EXPENSE_ACCOUNTS.includes(e.account) && e.account !== '501') {
                            totalExpense += (e.debit || 0);
                        }
                    });
                });
                const netProfit = totalRev - totalExpense;

                utils.setKpiValue('mgr-stat-revenue', totalRev);
                utils.setKpiValue('mgr-stat-net', netProfit, true, netProfit >= 0 ? 'positive' : 'negative');
                utils.setKpiValue('mgr-stat-cogs', totalCOGS, true, 'amber');
                document.getElementById('mgr-stat-trx').textContent = String(state.sales.length);

                let lowCount = 0;
                Object.values(state.inventory).forEach(i => { if (i.stock < i.par) lowCount++; });
                const pendingPrCount = state.prs.filter(p => p.status === 'Pending').length;
                const prKpi = document.getElementById('mgr-stat-pending-pr');
                const stockKpi = document.getElementById('mgr-stat-low-stock');
                if (prKpi) {
                    prKpi.textContent = String(pendingPrCount);
                    prKpi.className = 'kpi-card__value' + (pendingPrCount > 0 ? ' kpi-card__value--amber' : '');
                }
                if (stockKpi) {
                    stockKpi.textContent = String(lowCount);
                    stockKpi.className = 'kpi-card__value' + (lowCount > 0 ? ' kpi-card__value--negative' : '');
                }

                utils.renderIncomeExpenseChart('chart-daily-ie', 'daily', 'day', 7);
                utils.renderMetricsTable('mgr-table-daily', 'day', 7);
                utils.renderProductBarChart('revenueChart', 'products');
                utils.renderProductSalesTable('mgr-table-products');
                utils.renderStockAlertsTable();
            },
            renderInventory: () => {
                const tbody = document.getElementById('mgr-inventory-list');
                tbody.innerHTML = Object.values(state.inventory).map(i => {
                    const isLow = i.stock < i.par;
                    return `
                        <tr class="hover:bg-slate-50 border-b">
                            <td class="p-4 pl-6 font-bold text-slate-700">${i.name}</td>
                            <td class="p-4 ${isLow ? 'text-red-600 font-extrabold animate-pulse' : 'text-emerald-700'}">${utils.formatStockQty(i, i.stock)}</td>
                            <td class="p-4 text-slate-500 font-bold">${utils.formatStockQty(i, i.par)}</td>
                            <td class="p-4 text-slate-600 font-mono">${utils.formatRp(i.cost)}/${i.unit}</td>
                            <td class="p-4 text-right pr-6 space-x-1.5 flex justify-end">
                                <button onclick="manager.triggerManualPR('${i.id}')" class="bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-amber-200 transition">PR</button>
                                <button onclick="manager.openAdjustStockModal('${i.id}')" class="bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition" title="Stocktake"><i class="fas fa-scale-balanced"></i> Stocktake</button>
                            </td>
                        </tr>
                    `;
                }).join('');

                utils.renderStockAlertsTable();
                manager.renderProcurement();
            },
            // --- FIX 3 --- Unified P2P tracker (PR + PO) for Manager Procurement tab
            renderProcurement: () => {
                const prBox = document.getElementById('mgr-pr-list');
                if (prBox) {
                    if (state.prs.length === 0) {
                        prBox.innerHTML = `
                            <div class="text-center text-slate-400 py-8">
                                <i class="fas fa-folder-open text-3xl mb-2 block"></i>
                                No Open PRs
                            </div>`;
                    } else {
                        prBox.innerHTML = state.prs.map(p => `
                            <div class="p-4 border rounded-2xl bg-slate-50 space-y-2 border-slate-200/60 relative">
                                <div class="flex justify-between items-center">
                                    <span class="font-mono font-bold text-xs text-brand-700">${p.id}</span>
                                    <span class="text-[9px] font-black px-2 py-0.5 rounded-full ${p.status==='Pending'?'bg-amber-100 text-amber-800 border border-amber-200':'bg-emerald-100 text-emerald-800'}">${p.status}</span>
                                </div>
                                <div class="text-xs font-bold text-slate-700">${p.itemName}</div>
                                <div class="text-[10px] text-slate-500">Qty requested: ${p.qty} unit</div>
                                ${p.status === 'Pending' ? `
                                    <button onclick="manager.approvePR('${p.id}')" class="w-full bg-brand-600 hover:bg-brand-500 text-white font-black text-[10px] py-1.5 rounded-lg transition uppercase tracking-wider mt-2">Approve & Issue PO</button>
                                ` : ''}
                            </div>
                        `).join('');
                    }
                }

                const poTbody = document.getElementById('mgr-po-list');
                if (!poTbody) return;

                const poStatusBadge = (po) => {
                    const inv = state.invoices.find(i => i.poId === po.id);
                    const display = inv?.status === 'Paid' ? 'Paid' : po.status;
                    const cls = display === 'Issued' ? 'bg-blue-100 text-blue-800 border border-blue-200'
                        : display === 'Received' ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : display === 'Invoiced' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : display === 'Paid' ? 'bg-slate-800 text-white border border-slate-700'
                        : 'bg-slate-100 text-slate-700 border border-slate-200';
                    return `<span class="px-2.5 py-1 text-[10px] font-black rounded-full uppercase tracking-wider ${cls}">${display}</span>`;
                };

                if (state.pos.length === 0) {
                    poTbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400">No purchase orders issued yet.</td></tr>';
                    return;
                }

                poTbody.innerHTML = state.pos.map(po => {
                    const value = po.qty * poUnitCost(po);
                    return `
                        <tr class="hover:bg-slate-50 border-b">
                            <td class="p-4 pl-6 font-mono font-bold text-slate-700">${po.id}</td>
                            <td class="p-4 font-mono text-xs text-slate-500">${po.prId || '-'}</td>
                            <td class="p-4 font-bold text-slate-800">${po.supplier}</td>
                            <td class="p-4 font-bold text-slate-600">${po.itemName}</td>
                            <td class="p-4 text-slate-600">${po.qty}</td>
                            <td class="p-4 text-right font-black text-brand-600">${utils.formatRp(value)}</td>
                            <td class="p-4 pr-6">${poStatusBadge(po)}</td>
                        </tr>
                    `;
                }).join('');
            },
            triggerManualPR: (invId) => {
                const inv = state.inventory[invId];
                const prId = utils.generateId('PR');
                state.prs.push({
                    id: prId,
                    itemId: invId,
                    itemName: inv.name,
                    qty: inv.par * 3, // Standard reorder multiplier
                    status: 'Pending'
                });
                manager.renderInventory();
                manager.renderProcurement();
                utils.toast(`Manual PR Document (${prId}) successfully submitted!`, 'success');
                audit.addLog('PR', `Manual Purchase Request submission created for ${inv.name} qty ${inv.par * 3}`);
            },
            approvePR: (prId) => {
                const pr = state.prs.find(p => p.id === prId);
                pr.status = 'Approved';
                
                // Terbitkan PO secara otomatis ke Supplier Partner
                const poId = utils.generateId('PO');
                // --- FIX 2 --- Lock unit cost & supplier at PO creation
                state.pos.push({
                    id: poId,
                    prId,
                    itemId: pr.itemId,
                    itemName: pr.itemName,
                    qty: pr.qty,
                    unitCost: state.inventory[pr.itemId]?.cost ?? 0,
                    supplier: MATERIAL_PRICE_LIST[pr.itemId]?.supplier ?? 'Local Food Supplier',
                    status: 'Issued'
                });

                manager.renderInventory();
                manager.renderProcurement();
                utils.toast(`PR Approved! PO document (${poId}) issued to supplier.`, 'success');
                audit.addLog('PO', `PR ${prId} approved & PO ${poId} issued to supplier.`);
            },

            // --- JOURNAL SANDBOX NEW INVENTORY ---
            openAddInventoryModal: () => {
                const preset = document.getElementById('add-inv-preset');
                if (preset) {
                    const knownIds = Object.keys(MATERIAL_PRICE_LIST);
                    preset.innerHTML = '<option value="">— New custom item (manual entry) —</option>' +
                        knownIds.map(id => {
                            const inv = state.inventory[id] || LEKKER_DEFAULT_INVENTORY[id];
                            const label = inv ? inv.name : id;
                            return `<option value="${id}">${label}</option>`;
                        }).join('');
                    preset.value = '';
                }
                document.getElementById('modal-add-inventory').classList.remove('hide');
            },
            // --- FIX 2 --- Auto-fill standard cost from MATERIAL_PRICE_LIST
            onPresetInventorySelect: (invId) => {
                if (!invId) return;
                const price = MATERIAL_PRICE_LIST[invId];
                const inv = state.inventory[invId] || LEKKER_DEFAULT_INVENTORY[invId];
                if (!price || !inv) return;
                document.getElementById('add-inv-name').value = inv.name;
                document.getElementById('add-inv-unit').value = price.unit;
                document.getElementById('add-inv-cost').value = price.defaultCost;
            },
            closeAddInventoryModal: () => {
                document.getElementById('modal-add-inventory').classList.add('hide');
            },
            submitAddInventory: () => {
                const name = document.getElementById('add-inv-name').value.trim();
                const unit = document.getElementById('add-inv-unit').value.trim();
                const cost = parseFloat(document.getElementById('add-inv-cost').value);
                const par = parseFloat(document.getElementById('add-inv-par').value);
                const stock = parseFloat(document.getElementById('add-inv-stock').value);

                if(!name || !unit || isNaN(cost) || isNaN(par) || isNaN(stock)) {
                    return utils.toast('All fields must be filled in correctly.', 'warn');
                }

                const newId = 'inv_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                state.inventory[newId] = { id: newId, name, stock, par, unit, cost };
                utils.normalizeInventoryStock();

                // OPENING BALANCE JOURNAL REQUIREMENT: Dr. Inventory (110) Cr. Owner's Equity (301)
                if(stock > 0) {
                    const setupVal = stock * cost;
                    const jvId = utils.generateId('JV');
                    accounting.addJournal(jvId, `Custom Raw Material Opening Stock Deposit: ${name}`, [
                        { account: '110', debit: setupVal, credit: 0 },
                        { account: '301', debit: 0, credit: setupVal }
                    ]);
                }

                manager.renderInventory();
                manager.closeAddInventoryModal();
                utils.toast(`Raw material ${name} was successfully registered in the database!`, 'success');
                audit.addLog('REQUIREMENT', `New raw material added: ${name} (${stock} ${unit})`);

                // Reset Inputs
                document.getElementById('add-inv-name').value = '';
                document.getElementById('add-inv-unit').value = '';
                document.getElementById('add-inv-cost').value = '';
                document.getElementById('add-inv-par').value = '';
                document.getElementById('add-inv-stock').value = '';
            },

            // --- JOURNAL SANDBOX STOCK ADJUSTMENT (AUDIT) ---
            openAdjustStockModal: (invId) => {
                const inv = state.inventory[invId];
                manager.selectedAdjItem = invId;
                document.getElementById('adj-item-name').innerText = inv.name;
                document.getElementById('adj-item-sys').innerText = utils.formatStockQty(inv, inv.stock);
                document.getElementById('modal-adjust-stock').classList.remove('hide');
            },
            closeAdjustStockModal: () => {
                document.getElementById('modal-adjust-stock').classList.add('hide');
            },
            submitAdjustStock: () => {
                const invId = manager.selectedAdjItem;
                const inv = state.inventory[invId];
                const type = document.getElementById('adj-type').value;
                const qty = parseFloat(document.getElementById('adj-qty').value);
                const note = document.getElementById('adj-note').value.trim() || 'Physical Stocktake Adjustment';

                if(isNaN(qty) || qty <= 0) return utils.toast('Physical discrepancy quantity must be valid!', 'warn');

                const costVal = qty * inv.cost;
                const jvId = utils.generateId('JV');

                if(type === 'shortage') {
                    if(inv.stock < qty) return utils.toast('Stock is insufficient to reduce by that amount!', 'error');
                    inv.stock -= qty;

                    // JOURNAL: Dr. Stocktake Discrepancy Expense (503) Cr. Inventory (110)
                    accounting.addJournal(jvId, `Audit Stocktake Shortage - ${inv.name} (Note: ${note})`, [
                        { account: '503', debit: costVal, credit: 0 },
                        { account: '110', debit: 0, credit: costVal }
                    ]);
                    utils.toast(`Stock reduced! Inventory variance loss expense posted to Journal.`, 'info');
                } else {
                    inv.stock += qty;

                    // JOURNAL: Dr. Inventory (110) Cr. Inventory Variance Expense (503 / Credit Account)
                    accounting.addJournal(jvId, `Audit Stocktake Overage - ${inv.name} (Note: ${note})`, [
                        { account: '110', debit: costVal, credit: 0 },
                        { account: '503', debit: 0, credit: costVal }
                    ]);
                    utils.toast(`Stock increased! Inventory variance expense reduction posted to Journal.`, 'success');
                }

                utils.normalizeInventoryStock();
                manager.renderInventory();
                manager.closeAdjustStockModal();
                audit.addLog('AUDIT', `Physical stocktake correction performed on ${inv.name} by ${qty} ${inv.unit}`);

                // Reset
                document.getElementById('adj-qty').value = '';
                document.getElementById('adj-note').value = '';
            },

            // --- JOURNAL SANDBOX REGISTER NEW MENU ---
            openAddMenuModal: () => {
                const bomBox = document.getElementById('add-menu-bom-list');
                bomBox.innerHTML = Object.values(state.inventory).map(i => {
                    const stdCost = MATERIAL_PRICE_LIST[i.id]?.defaultCost ?? i.cost;
                    const onHand = utils.formatStockQty(i, i.stock);
                    return `
                    <div class="flex items-center justify-between py-1 bg-white px-3 rounded-lg border border-slate-100 shadow-sm text-xs">
                        <label class="flex items-center gap-2 cursor-pointer font-bold text-slate-700 min-w-0">
                            <input type="checkbox" name="bom_ing_check" value="${i.id}" class="w-4 h-4 rounded text-brand-500 border-slate-300 shrink-0">
                            <span class="min-w-0 truncate">${i.name}</span>
                            <span class="text-[9px] text-slate-400 font-mono shrink-0">${utils.formatRp(stdCost)}/${i.unit}</span>
                            <span class="text-[9px] text-emerald-700 font-bold shrink-0">${onHand}</span>
                        </label>
                        <div class="flex items-center gap-1">
                            <input type="number" name="bom_ing_qty_${i.id}" class="w-16 px-2 py-1 border rounded text-right font-mono bom-qty-input" placeholder="0.0" step="0.01" data-inv-id="${i.id}">
                            <span class="text-[10px] text-slate-400 font-bold uppercase w-8">${i.unit}</span>
                        </div>
                    </div>`;
                }).join('');
                bomBox.querySelectorAll('input[name="bom_ing_check"], .bom-qty-input').forEach(el => {
                    el.addEventListener('change', () => manager.updateSuggestedMenuPrice());
                    el.addEventListener('input', () => manager.updateSuggestedMenuPrice());
                });
                document.getElementById('add-menu-price').value = '';
                const hint = document.getElementById('add-menu-price-hint');
                if (hint) hint.textContent = 'Select recipe ingredients — price fills from standard raw material cost + margin.';
                document.getElementById('modal-add-menu').classList.remove('hide');
            },
            updateSuggestedMenuPrice: () => {
                const ingredientsObj = {};
                document.querySelectorAll('input[name="bom_ing_check"]:checked').forEach(chk => {
                    const invId = chk.value;
                    const qty = parseFloat(document.querySelector(`input[name="bom_ing_qty_${invId}"]`)?.value);
                    if (!isNaN(qty) && qty > 0) ingredientsObj[invId] = qty;
                });
                const bomCost = utils.computeMenuBomCost(ingredientsObj);
                const cat = document.getElementById('add-menu-cat')?.value || '';
                const priceEl = document.getElementById('add-menu-price');
                const hint = document.getElementById('add-menu-price-hint');
                if (Object.keys(ingredientsObj).length === 0) {
                    if (hint) hint.textContent = 'Select recipe ingredients — price fills from standard raw material cost + margin.';
                    return;
                }
                const suggested = utils.suggestMenuSellingPrice(bomCost, cat);
                const profit = suggested - bomCost;
                const marginPct = suggested > 0 ? Math.round((profit / suggested) * 100) : 0;
                if (priceEl) priceEl.value = suggested;
                if (hint) {
                    hint.innerHTML = `Standard BOM ${utils.formatRp(bomCost)} + untung ${utils.formatRp(profit)} (${marginPct}%) → <span class="text-brand-700 font-black">${utils.formatRp(suggested)}</span>`;
                }
            },
            closeAddMenuModal: () => {
                document.getElementById('modal-add-menu').classList.add('hide');
            },
            submitAddMenu: () => {
                const name = document.getElementById('add-menu-name').value.trim();
                const cat = document.getElementById('add-menu-cat').value;
                const emoji = document.getElementById('add-menu-emoji').value;

                const checkedCheckboxes = document.querySelectorAll('input[name="bom_ing_check"]:checked');
                const ingredientsObj = {};

                checkedCheckboxes.forEach(chk => {
                    const invId = chk.value;
                    const qtyInput = document.querySelector(`input[name="bom_ing_qty_${invId}"]`);
                    const qtyVal = parseFloat(qtyInput.value);
                    if(!isNaN(qtyVal) && qtyVal > 0) {
                        ingredientsObj[invId] = qtyVal;
                    }
                });

                if(!name) return utils.toast('Enter a valid menu name.', 'warn');
                if(Object.keys(ingredientsObj).length === 0) {
                    return utils.toast('Minimum recipe must select at least 1 raw material!', 'warn');
                }

                const bomCost = utils.computeMenuBomCost(ingredientsObj);
                let price = parseFloat(document.getElementById('add-menu-price').value);
                if (isNaN(price) || price <= 0) {
                    price = utils.suggestMenuSellingPrice(bomCost, cat);
                }
                if (price < bomCost) {
                    return utils.toast(`Selling price must cover BOM cost (${utils.formatRp(bomCost)}).`, 'warn');
                }

                const newMenuId = utils.generateId('MENU');
                state.menus.push({
                    id: newMenuId,
                    name,
                    price,
                    category: cat,
                    emoji,
                    ing: ingredientsObj
                });

                manager.renderMenu();
                manager.closeAddMenuModal();
                pos.renderCategories();
                const newMenu = state.menus.find(m => m.id === newMenuId);
                const avail = utils.getMenuAvailableStock(newMenu);
                if (!document.getElementById('view-cashier')?.classList.contains('hide')) pos.render();
                utils.toast(`Menu added. Cashier stock: ${avail} portion(s) available.`, 'success');
                audit.addLog('MENU', `New menu registered: ${name} (${cat}) at ${utils.formatRp(price)}`);

                // Reset
                document.getElementById('add-menu-name').value = '';
                document.getElementById('add-menu-price').value = '';
            },

            renderMenu: () => {
                const list = document.getElementById('mgr-menu-list');
                const portions = utils.getMenuAvailableStock;
                list.innerHTML = state.menus.map(m => {
                    const canMake = portions(m);
                    const stockCls = canMake === 0 ? 'text-red-600' : canMake <= 5 ? 'text-amber-700' : 'text-emerald-700';
                    return `
                    <div class="panel-plain p-5 flex flex-col justify-between min-h-[280px]">
                        <div>
                            <div class="flex justify-between items-start mb-2 gap-2">
                                <span class="text-4xl">${m.emoji}</span>
                                <span class="bg-brand-50 text-brand-700 font-extrabold border border-brand-100 text-xs px-2.5 py-1 rounded-xl shrink-0">${utils.formatRp(m.price)}</span>
                            </div>
                            <h4 class="font-extrabold text-sm text-slate-800 leading-snug">${m.name}</h4>
                            <p class="text-[10px] text-slate-500 mt-1 font-bold">${m.category}</p>
                            <p class="text-[10px] mt-2 font-bold ${stockCls}">Can make: ${canMake} portion(s)</p>
                        </div>
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs mt-3">
                            <div class="font-bold text-slate-500 uppercase text-[9px] tracking-wider mb-1.5 border-b pb-1">Recipe (per portion)</div>
                            <div class="space-y-1.5 font-medium text-slate-700 overflow-y-auto max-h-28">
                                ${Object.entries(m.ing || {}).map(([id, val]) => {
                                    const inv = state.inventory[id];
                                    const onHand = inv ? inv.stock : 0;
                                    return `
                                    <div class="flex justify-between gap-2 leading-tight">
                                        <span class="min-w-0">${inv ? inv.name : id}</span>
                                        <span class="text-right shrink-0 text-slate-600">
                                            <span class="block font-bold">${utils.formatBomQty(id, val)}</span>
                                            <span class="text-[9px] ${onHand <= 0 ? 'text-red-500' : 'text-slate-500'}">On hand: ${inv ? utils.formatStockQty(inv, onHand) : '—'}</span>
                                        </span>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    </div>`;
                }).join('');
                if (!state.menus.length) {
                    list.innerHTML = '<p class="text-slate-400 text-sm col-span-full">No menu items. Click <strong>New menu item</strong> above.</p>';
                }
            }
        };

        // --- 8. MODUL FINANCE (P2P FLOW, GRN, 3-WAY MATCH & AP) ---
        const FIN_LEGACY_TABS = {
            sales_journal: { group: 'accounting', sub: 'sales_journal' },
            adjusting: { group: 'accounting', sub: 'adjusting' },
            ledger: { group: 'accounting', sub: 'ledger' },
            trial_balance: { group: 'accounting', sub: 'trial_balance' },
            income_statement: { group: 'accounting', sub: 'income_statement' },
            balance_sheet: { group: 'accounting', sub: 'balance_sheet' },
            statements: { group: 'accounting', sub: 'income_statement' },
            po: { group: 'procurement', sub: 'po' },
            grn: { group: 'procurement', sub: 'grn' },
            ap: { group: 'procurement', sub: 'ap' }
        };

        const finance = {
            activeTab: 'dashboard',
            accountingSub: 'ledger',
            procurementSub: 'po',
            periodFilter: { mode: 'all', value: '' },
            uploadedFileRef: null,
            currentSelection: null,
            init: () => {
                accounting.initSetup();
                finance.bindAccountingSubnav();
                finance.bindProcurementSubnav();
                finance.initPeriodFilter();
                finance.switchTab('dashboard');
            },
            renderBalanceStatusBadge: (elementId, balanced, diff) => {
                const el = document.getElementById(elementId);
                if (!el) return;
                el.innerHTML = balanced
                    ? `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-emerald-500 text-white shadow-sm"><i class="fas fa-check-circle"></i> Balanced</span>`
                    : `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-red-500 text-white shadow-sm"><i class="fas fa-times-circle"></i> Not Balanced — Difference: ${utils.formatRp(diff)}</span>`;
            },
            getFilteredJournal: () => {
                const { mode, value } = finance.periodFilter;
                if (mode === 'all' || !value) return state.journal;
                return state.journal.filter(j => utils.journalDateKey(j.date, mode) === value);
            },
            getFilteredSales: () => {
                const { mode, value } = finance.periodFilter;
                if (mode === 'all' || !value) return state.sales;
                return state.sales.filter(s => utils.journalDateKey(s.time || new Date(), mode) === value);
            },
            getFilteredAuditLogs: () => {
                const { mode, value } = finance.periodFilter;
                if (mode === 'all' || !value) return state.auditLogs;
                return state.auditLogs.filter(l => utils.journalDateKey(l.timestamp, mode) === value);
            },
            getPeriodJournalRefs: () => new Set(finance.getFilteredJournal().map(j => j.ref)),
            isProcurementInPeriod: (refId) => {
                if (finance.periodFilter.mode === 'all') return true;
                if (!refId) return false;
                return finance.getPeriodJournalRefs().has(refId);
            },
            getPeriodStats: () => {
                const journal = finance.getFilteredJournal();
                const sales = finance.getFilteredSales();
                let lines = 0;
                journal.forEach(j => { lines += (j.entries?.length || 0); });
                return {
                    journals: journal.length,
                    sales: sales.length,
                    lines,
                    totalJournals: state.journal.length
                };
            },
            getPeriodLabel: () => {
                const { mode, value } = finance.periodFilter;
                if (mode === 'all') return 'All periods — full books';
                if (mode === 'day' && value) {
                    const d = new Date(`${value}T12:00:00`);
                    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                }
                if (mode === 'month' && value) {
                    const [y, m] = value.split('-').map(Number);
                    const d = new Date(y, m - 1, 1);
                    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                }
                return 'Select a period';
            },
            showPeriodFilter: (visible) => {
                const bar = document.getElementById('fin-period-filter');
                if (!bar) return;
                bar.classList.toggle('hide', !visible);
                bar.classList.toggle('fin-period-bar--active', visible && finance.periodFilter.mode !== 'all');
            },
            syncPeriodFilterUi: () => {
                const dayIn = document.getElementById('fin-filter-day');
                const monthIn = document.getElementById('fin-filter-month');
                const labelEl = document.getElementById('fin-period-label');
                const hint = document.getElementById('fin-filter-hint');
                const stats = finance.getPeriodStats();

                document.querySelectorAll('.fin-period-seg').forEach(btn => {
                    const on = btn.dataset.mode === finance.periodFilter.mode;
                    btn.classList.toggle('fin-period-seg--active', on);
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                if (dayIn) {
                    dayIn.classList.toggle('hide', finance.periodFilter.mode !== 'day');
                    if (finance.periodFilter.mode === 'day') {
                        dayIn.value = finance.periodFilter.value || new Date().toISOString().slice(0, 10);
                    }
                }
                if (monthIn) {
                    monthIn.classList.toggle('hide', finance.periodFilter.mode !== 'month');
                    if (finance.periodFilter.mode === 'month') {
                        monthIn.value = finance.periodFilter.value || new Date().toISOString().slice(0, 7);
                    }
                }
                if (labelEl) labelEl.textContent = finance.getPeriodLabel();
                const jEl = document.getElementById('fin-stat-journals');
                const sEl = document.getElementById('fin-stat-sales');
                const lEl = document.getElementById('fin-stat-lines');
                if (jEl) jEl.textContent = String(stats.journals);
                if (sEl) sEl.textContent = String(stats.sales);
                if (lEl) lEl.textContent = String(stats.lines);
                if (hint) {
                    if (finance.periodFilter.mode === 'all') {
                        hint.textContent = `Showing all data — ${stats.totalJournals} journals, ${state.sales.length} sales, ${stats.lines} GL lines. Applies to overview, ledger, trial balance, P&L, balance sheet, sales & adjusting journals, and linked procurement.`;
                    } else {
                        hint.textContent = `Filtered view — ${stats.journals} of ${stats.totalJournals} journals, ${stats.sales} sales, ${stats.lines} GL lines for ${finance.getPeriodLabel()}. All finance tables below use this period.`;
                    }
                }
                finance.showPeriodFilter(!document.getElementById('fin-period-filter')?.classList.contains('hide'));
            },
            setPeriodFilterMode: (mode) => {
                finance.periodFilter.mode = mode;
                if (mode === 'all') {
                    finance.periodFilter.value = '';
                } else if (mode === 'day') {
                    finance.periodFilter.value = document.getElementById('fin-filter-day')?.value
                        || new Date().toISOString().slice(0, 10);
                } else if (mode === 'month') {
                    finance.periodFilter.value = document.getElementById('fin-filter-month')?.value
                        || new Date().toISOString().slice(0, 7);
                }
                finance.syncPeriodFilterUi();
                finance.refreshFilteredViews();
            },
            setPeriodFilterValue: (value) => {
                finance.periodFilter.value = value;
                finance.syncPeriodFilterUi();
                finance.refreshFilteredViews();
            },
            initPeriodFilter: () => {
                const dayIn = document.getElementById('fin-filter-day');
                const monthIn = document.getElementById('fin-filter-month');
                const today = new Date().toISOString().slice(0, 10);
                const thisMonth = new Date().toISOString().slice(0, 7);
                if (dayIn) dayIn.value = today;
                if (monthIn) monthIn.value = thisMonth;
                document.querySelectorAll('.fin-period-seg').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        finance.setPeriodFilterMode(btn.dataset.mode);
                    });
                });
                dayIn?.addEventListener('change', () => {
                    if (finance.periodFilter.mode === 'day') finance.setPeriodFilterValue(dayIn.value);
                });
                monthIn?.addEventListener('change', () => {
                    if (finance.periodFilter.mode === 'month') finance.setPeriodFilterValue(monthIn.value);
                });
                finance.syncPeriodFilterUi();
            },
            refreshFilteredViews: () => {
                if (finance.activeTab === 'dashboard') {
                    finance.renderDashboard();
                } else if (finance.activeTab === 'accounting') {
                    finance.refreshAccountingViews();
                } else if (finance.activeTab === 'procurement') {
                    finance.refreshProcurementViews();
                } else if (finance.activeTab === 'audit') {
                    finance.renderAuditLogs();
                }
            },
            refreshProcurementViews: () => {
                const sub = finance.procurementSub || 'po';
                if (sub === 'po') finance.renderPO();
                else if (sub === 'grn') finance.renderGRN();
                else if (sub === 'ap') finance.renderAP();
            },
            bindAccountingSubnav: () => {
                document.getElementById('fin-accounting-subnav')?.addEventListener('click', (e) => {
                    const btn = e.target.closest('.fin-acc-sub');
                    if (!btn?.dataset.sub) return;
                    e.preventDefault();
                    finance.switchAccountingSub(btn.dataset.sub);
                });
            },
            bindProcurementSubnav: () => {
                document.getElementById('fin-procurement-subnav')?.addEventListener('click', (e) => {
                    const btn = e.target.closest('.fin-proc-sub');
                    if (!btn?.dataset.sub) return;
                    e.preventDefault();
                    finance.switchProcurementSub(btn.dataset.sub);
                });
            },
            refreshAccountingViews: () => {
                const sub = finance.accountingSub || 'ledger';
                if (sub === 'sales_journal') finance.renderSalesJournal();
                else if (sub === 'adjusting') finance.renderAdjustingEntries();
                else if (sub === 'ledger') {
                    const mode = state.ledgerViewMode || 'all';
                    if (mode === 'account') finance.renderAccountCard();
                    else if (mode === 'manual') finance.renderManualJournalForm();
                    else finance.renderLedger();
                } else if (sub === 'trial_balance') finance.renderTrialBalance();
                else if (sub === 'income_statement' || sub === 'balance_sheet') finance.renderStatements();
            },
            _hideFinancePanes: () => {
                document.querySelectorAll('.fin-content, .fin-acc-pane, .fin-proc-pane').forEach(el => el.classList.add('hide'));
            },
            _setTopFinTab: (tabId) => {
                document.querySelectorAll('.fin-tab').forEach(btn => btn.classList.remove('erp-nav-tab-active'));
                document.querySelector(`.fin-tab[data-tab="${tabId}"]`)?.classList.add('erp-nav-tab-active');
            },
            _showFinancePane: (paneId) => {
                const panel = document.getElementById(paneId);
                if (!panel) return false;
                panel.classList.remove('hide');
                panel.classList.add('tab-panel-enter');
                setTimeout(() => panel.classList.remove('tab-panel-enter'), 450);
                return true;
            },
            switchTab: (tabId) => {
                const legacy = FIN_LEGACY_TABS[tabId];
                if (legacy) {
                    finance.activeTab = legacy.group;
                    finance._setTopFinTab(legacy.group);
                    if (legacy.group === 'accounting') {
                        finance.accountingSub = legacy.sub;
                        finance.switchAccountingSub(legacy.sub);
                    } else {
                        finance.procurementSub = legacy.sub;
                        finance.switchProcurementSub(legacy.sub);
                    }
                    return;
                }

                finance.activeTab = tabId;
                finance._setTopFinTab(tabId);
                finance._hideFinancePanes();
                document.getElementById('fin-accounting-subnav')?.classList.add('hide');
                document.getElementById('fin-procurement-subnav')?.classList.add('hide');

                if (tabId === 'dashboard') {
                    finance.showPeriodFilter(true);
                    finance.syncPeriodFilterUi();
                    finance._showFinancePane('fin-tab-dashboard');
                    finance.renderDashboard();
                } else if (tabId === 'accounting') {
                    finance.switchAccountingSub(finance.accountingSub || 'ledger');
                } else if (tabId === 'procurement') {
                    finance.switchProcurementSub(finance.procurementSub || 'po');
                } else if (tabId === 'audit') {
                    finance.showPeriodFilter(true);
                    finance.syncPeriodFilterUi();
                    finance._showFinancePane('fin-tab-audit');
                    finance.renderAuditLogs();
                } else {
                    console.warn('[finance] Unknown tab:', tabId);
                    finance.switchTab('dashboard');
                }
            },
            switchAccountingSub: (subId) => {
                finance.activeTab = 'accounting';
                finance.accountingSub = subId;
                finance._setTopFinTab('accounting');
                document.querySelectorAll('.fin-acc-sub').forEach(btn => btn.classList.remove('subnav-pill-active'));
                document.querySelector(`.fin-acc-sub[data-sub="${subId}"]`)?.classList.add('subnav-pill-active');

                finance._hideFinancePanes();
                document.getElementById('fin-procurement-subnav')?.classList.add('hide');
                document.getElementById('fin-accounting-subnav')?.classList.remove('hide');
                finance.showPeriodFilter(true);
                finance.syncPeriodFilterUi();

                const paneId = `fin-tab-${subId}`;
                if (!finance._showFinancePane(paneId)) {
                    console.warn('[finance] Accounting pane missing:', paneId);
                    finance._showFinancePane('fin-tab-ledger');
                    subId = 'ledger';
                }

                if (subId === 'sales_journal') finance.renderSalesJournal();
                else if (subId === 'adjusting') finance.renderAdjustingEntries();
                else if (subId === 'ledger') finance.setLedgerViewMode(state.ledgerViewMode || 'all');
                else if (subId === 'trial_balance') finance.renderTrialBalance();
                else if (subId === 'income_statement') finance.renderIncomeStatement();
                else if (subId === 'balance_sheet') finance.renderBalanceSheet();
            },
            switchProcurementSub: (subId) => {
                finance.activeTab = 'procurement';
                finance.procurementSub = subId;
                finance._setTopFinTab('procurement');
                document.querySelectorAll('.fin-proc-sub').forEach(btn => btn.classList.remove('subnav-pill-active'));
                document.querySelector(`.fin-proc-sub[data-sub="${subId}"]`)?.classList.add('subnav-pill-active');

                finance._hideFinancePanes();
                document.getElementById('fin-accounting-subnav')?.classList.add('hide');
                document.getElementById('fin-procurement-subnav')?.classList.remove('hide');
                finance.showPeriodFilter(true);
                finance.syncPeriodFilterUi();

                const paneId = `fin-tab-${subId}`;
                if (!finance._showFinancePane(paneId)) {
                    console.warn('[finance] Procurement pane missing:', paneId);
                    finance._showFinancePane('fin-tab-po');
                    subId = 'po';
                }

                if (subId === 'po') finance.renderPO();
                else if (subId === 'grn') finance.renderGRN();
                else if (subId === 'ap') finance.renderAP();
            },
            refreshActiveView: () => {
                const legacy = FIN_LEGACY_TABS[finance.activeTab];
                if (legacy) {
                    if (legacy.group === 'accounting') finance.switchAccountingSub(legacy.sub);
                    else finance.switchProcurementSub(legacy.sub);
                    return;
                }
                if (finance.activeTab === 'dashboard') {
                    finance._hideFinancePanes();
                    document.getElementById('fin-accounting-subnav')?.classList.add('hide');
                    document.getElementById('fin-procurement-subnav')?.classList.add('hide');
                    finance.showPeriodFilter(true);
                    finance.syncPeriodFilterUi();
                    finance._showFinancePane('fin-tab-dashboard');
                    finance.renderDashboard();
                } else if (finance.activeTab === 'accounting') {
                    finance.switchAccountingSub(finance.accountingSub || 'ledger');
                } else if (finance.activeTab === 'procurement') {
                    finance.switchProcurementSub(finance.procurementSub || 'po');
                } else if (finance.activeTab === 'audit') {
                    finance.switchTab('audit');
                }
            },
            renderDashboard: () => {
                const journal = finance.getFilteredJournal();
                const b = utils.computeCoaBalances(journal);
                const cash = (b['101'] || 0) + (b['102'] || 0) + (b['103'] || 0);
                const inventory = utils.getInventoryStockValue();
                const ap = Math.abs(b['211'] || 0);
                const revenue = Math.abs(b['401'] || 0);
                let totalExpense = 0;
                journal.forEach(j => {
                    j.entries.forEach(e => {
                        if (EXPENSE_ACCOUNTS.includes(e.account)) totalExpense += (e.debit || 0);
                    });
                });
                const netProfit = revenue - totalExpense;

                utils.setKpiValue('fin-kpi-cash', cash, true, 'auto', true);
                utils.setKpiValue('fin-kpi-inventory', inventory, true, 'auto', true);
                utils.setKpiValue('fin-kpi-ap', ap, true, 'amber');
                utils.setKpiValue('fin-kpi-revenue', revenue, true, 'positive');
                utils.setKpiValue('fin-kpi-expense', totalExpense);
                utils.setKpiValue('fin-kpi-net', netProfit, true, netProfit >= 0 ? 'positive' : 'negative');

                utils.updateBooksBalancedBadge('fin-books-balanced', journal);
                finance.syncPeriodFilterUi();
                utils.renderIncomeExpenseChart('fin-chart-monthly', 'finMonthly', 'month', 6);
                utils.renderMetricsTable('fin-table-monthly', 'month', 6);

                const keyAccounts = ['101', '102', '110', '210', '211', '301', '401', '501'];
                const balBody = document.getElementById('fin-table-balances');
                if (balBody) {
                    balBody.innerHTML = keyAccounts.map(code => {
                        const net = b[code] || 0;
                        const isDebitNormal = code.startsWith('1') || code.startsWith('5') || code.startsWith('6');
                        const display = isDebitNormal ? net : -net;
                        if (display === 0) return '';
                        return `<tr>
                            <td class="font-mono text-slate-500">${code}</td>
                            <td>${accounting.coa[code]}</td>
                            <td class="num-cell">${utils.formatRp(Math.abs(display))}</td>
                        </tr>`;
                    }).filter(Boolean).join('') || '<tr><td colspan="3" class="p-4 text-center text-slate-400">No balances yet</td></tr>';
                }

                const grnPending = state.pos.filter(p => p.status === 'Issued').length;
                const matchedGrnIds = state.invoices.map(i => i.grnId);
                const matchPending = state.grns.filter(g => !matchedGrnIds.includes(g.id)).length;
                const apReady = state.invoices.filter(inv => inv.status === 'Verified & AP Created').length;
                const gEl = document.getElementById('fin-pipe-grn');
                const mEl = document.getElementById('fin-pipe-match');
                const aEl = document.getElementById('fin-pipe-ap');
                if (gEl) gEl.textContent = String(grnPending);
                if (mEl) mEl.textContent = String(matchPending);
                if (aEl) aEl.textContent = String(apReady);
                document.querySelectorAll('.pipeline-card').forEach(card => {
                    const val = parseInt(card.querySelector('.pipeline-card__value')?.textContent || '0', 10);
                    card.classList.toggle('pipeline-card--active', val > 0);
                });

                const recentBody = document.getElementById('fin-table-recent');
                if (recentBody) {
                    const recent = [...journal].reverse().slice(0, 5);
                    if (!recent.length) {
                        recentBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">No journal entries for this period</td></tr>';
                    } else {
                        recentBody.innerHTML = recent.map(j => {
                            let deb = 0;
                            let cred = 0;
                            j.entries.forEach(e => { deb += e.debit || 0; cred += e.credit || 0; });
                            return `<tr>
                                <td>${utils.formatDate(j.date)}</td>
                                <td class="font-mono text-brand-700">${j.ref}</td>
                                <td>${j.description}</td>
                                <td class="num-cell text-emerald-700">${utils.formatRp(deb)}</td>
                                <td class="num-cell text-brand-700">${utils.formatRp(cred)}</td>
                            </tr>`;
                        }).join('');
                    }
                }
            },

            renderSalesJournal: () => {
                const tbody = document.getElementById('fin-sales-journal-tbody');
                if (!tbody) return;
                const rows = [];
                finance.getFilteredSales().forEach(s => {
                    const j = state.journal.find(x => x.ref === s.id);
                    const gl = j ? j.entries.map(e =>
                        `${e.debit ? 'Dr' : 'Cr'} ${e.account} ${utils.formatRpCompact(e.debit || e.credit)}`
                    ).join('; ') : '—';
                    rows.push(`<tr>
                        <td>${utils.formatDate(s.time || new Date())}</td>
                        <td class="font-mono font-bold">${s.id}</td>
                        <td>${s.paymentMethod || '—'}</td>
                        <td class="num-cell">${utils.formatRp(s.total || s.subtotal || 0)}</td>
                        <td class="text-[10px] text-slate-600">${gl}</td>
                    </tr>`);
                });
                tbody.innerHTML = rows.length
                    ? rows.join('')
                    : '<tr><td colspan="5" class="p-4 text-center text-slate-400">No POS sales posted yet. Use Cashier or load sample data.</td></tr>';
            },
            renderAdjustingEntries: () => {
                const tbody = document.getElementById('fin-adjusting-tbody');
                if (!tbody) return;
                const adjusting = finance.getFilteredJournal().filter(j =>
                    j.ref !== 'JV-001' && (
                        (j.ref.startsWith('JV-') && j.ref !== 'JV-001') ||
                        j.ref.startsWith('INV') ||
                        /expense|adjust|electricity|wifi/i.test(j.description)
                    )
                );
                tbody.innerHTML = adjusting.length ? adjusting.map(j => {
                    let deb = 0, cred = 0;
                    const accts = j.entries.map(e => {
                        deb += e.debit || 0;
                        cred += e.credit || 0;
                        return `[${e.account}]`;
                    }).join(' ');
                    return `<tr>
                        <td>${utils.formatDate(j.date)}</td>
                        <td class="font-mono font-bold text-brand-700">${j.ref}</td>
                        <td>${j.description}</td>
                        <td class="text-[10px]">${accts}</td>
                        <td class="num-cell">${utils.formatRp(deb)}</td>
                        <td class="num-cell">${utils.formatRp(cred)}</td>
                    </tr>`;
                }).join('') : '<tr><td colspan="6" class="p-4 text-center text-slate-400">No adjusting entries. Post manual JVs in Ledger.</td></tr>';
            },
            renderIncomeStatement: () => {
                finance.renderStatements();
            },
            renderBalanceSheet: () => {
                finance.renderStatements();
            },
            renderPO: () => {
                const tbody = document.getElementById('fin-po-list');
                if (!tbody) return;
                const pendingPOs = state.pos.filter(po =>
                    finance.isProcurementInPeriod(po.id) ||
                    state.grns.some(g => g.poId === po.id && finance.isProcurementInPeriod(g.id))
                );
                finance.syncPeriodFilterUi();
                if(pendingPOs.length === 0) {
                    const msg = finance.periodFilter.mode === 'all'
                        ? 'No active POs have been issued by the Manager.'
                        : 'No purchase orders with journal activity in this period.';
                    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">${msg}</td></tr>`;
                    return;
                }
                tbody.innerHTML = pendingPOs.map(po => {
                    const costVal = po.qty * poUnitCost(po);
                    return `
                        <tr class="hover:bg-slate-50 border-b">
                            <td class="p-4 pl-6 font-mono font-bold text-slate-700">${po.id}</td>
                            <td class="p-4 font-bold text-slate-800">${po.supplier}</td>
                            <td class="p-4 font-bold text-slate-600">${po.itemName} (x${po.qty})</td>
                            <td class="p-4 text-right font-black text-brand-600">${utils.formatRp(costVal)}</td>
                            <td class="p-4">
                                <span class="px-2.5 py-1 text-[10px] font-black rounded-full uppercase tracking-wider ${po.status==='Issued'?'bg-blue-100 text-blue-800 border border-blue-200':po.status==='Received'?'bg-amber-100 text-amber-800 border border-amber-200':'bg-emerald-100 text-emerald-800'}">${po.status}</span>
                            </td>
                            <td class="p-4 text-right pr-6">
                                ${po.status === 'Issued' ? `
                                    <button onclick="finance.switchTab('procurement'); finance.switchProcurementSub('grn')" class="text-emerald-600 hover:text-emerald-800 hover:underline font-bold text-xs flex items-center justify-end gap-1"><i class="fas fa-bell text-amber-500 animate-pulse mr-1"></i> Confirm Goods Receipt <i class="fas fa-chevron-right text-[10px]"></i></button>
                                ` : `-`}
                            </td>
                        </tr>
                    `;
                }).join('');
            },
            renderGRN: () => {
                const container = document.getElementById('fin-grn-container');
                const pendingGrnPOs = state.pos.filter(po =>
                    po.status === 'Issued' && (
                        finance.isProcurementInPeriod(po.id) ||
                        state.grns.some(g => g.poId === po.id && finance.isProcurementInPeriod(g.id))
                    )
                );
                finance.syncPeriodFilterUi();
                if(pendingGrnPOs.length === 0) {
                    container.innerHTML = `
                        <div class="text-center text-slate-400 py-12">
                            <i class="fas fa-box-open text-5xl mb-3 block text-slate-300"></i>
                            No PO items are ready for receipt (all GRNs processed).
                        </div>`;
                    return;
                }

                const bannerHtml = `
                    <div class="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-2xl px-5 py-3 shadow-sm">
                        <i class="fas fa-triangle-exclamation text-amber-500 text-xl animate-pulse"></i>
                        <div>
                            <p class="text-amber-800 font-black text-xs uppercase tracking-wider">⚠️ ${pendingGrnPOs.length} PO Awaiting Confirm Goods Receipt</p>
                            <p class="text-amber-700 text-[10px] mt-0.5">Raw material stock <span class="font-black">does NOT increase</span> until the "Confirm Arrival" button below is clicked. Click to record the GRN & update the stock card.</p>
                        </div>
                    </div>`;

                container.innerHTML = bannerHtml + pendingGrnPOs.map(po => `
                    <div class="border border-slate-200/70 p-5 rounded-2xl bg-slate-50 flex justify-between items-center shadow-sm">
                        <div>
                            <div class="font-mono font-bold text-slate-800 text-xs">${po.id} <span class="text-slate-400 font-normal">(${po.supplier})</span></div>
                            <div class="text-sm font-black text-slate-700 mt-1">${po.itemName}</div>
                            <div class="text-[10px] text-slate-400 font-bold mt-0.5">Qty ordered: ${po.qty}</div>
                        </div>
                        <button onclick="finance.submitGRN('${po.id}')" class="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-lg transition uppercase tracking-wider flex items-center gap-2">
                            <i class="fas fa-check-double"></i> Confirm Arrival
                        </button>
                    </div>
                `).join('');
            },
            submitGRN: (poId) => {
                const po = state.pos.find(p => p.id === poId);
                po.status = 'Received';

                const grnId = utils.generateId('GRN');
                state.grns.push({
                    id: grnId,
                    poId,
                    itemId: po.itemId,
                    qty: po.qty,
                    status: 'Matched'
                });

                // Update stock card (Inventory increase) & GRN accrual journal (Unbilled Payables)
                const inv = state.inventory[po.itemId];
                if(inv) {
                    inv.stock += po.qty;
                    utils.normalizeInventoryStock();
                    const totalVal = po.qty * poUnitCost(po);

                    // PERSIST stok ke Firestore supaya Manager bisa lihat update lintas session
                    fs.adjustInventoryStock(po.itemId, po.qty, +1);

                    // JOURNAL: Dr. Inventory (110) Cr. Unbilled Payables (210)
                    accounting.addJournal(grnId, `Warehouse Receipt (GRN) PO: ${poId} - ${inv.name}`, [
                        { account: '110', debit: totalVal, credit: 0 },
                        { account: '210', debit: 0, credit: totalVal }
                    ]);
                    
                    finance.renderGRN();
                    manager.renderInventory();
                    manager.renderProcurement();
                    utils.toast(`GRN Receipt Confirmation (${grnId}) recorded! Raw material stock increased.`, 'success');
                    audit.addLog('GRN', `Warehouse receipt ${grnId} for PO ${poId} completed. Inventory ${inv.name} increased by ${po.qty}`);
                }
            },
            renderAP: () => {
                const list = document.getElementById('fin-match-list');
                const matchedGrns = state.invoices.map(i => i.grnId);
                const pendingAPGrns = state.grns.filter(g =>
                    !matchedGrns.includes(g.id) && finance.isProcurementInPeriod(g.id)
                );
                finance.syncPeriodFilterUi();

                if(pendingAPGrns.length === 0) {
                    list.innerHTML = `<div class="text-center text-slate-400 py-6 text-xs">All GRN documents have been completed with AP Invoice.</div>`;
                    document.getElementById('fin-match-overlay').classList.remove('hide');
                } else {
                    list.innerHTML = pendingAPGrns.map(g => {
                        const po = state.pos.find(p => p.id === g.poId);
                        return `
                            <div onclick="finance.selectMatch('${g.id}', '${po.id}')" class="p-3 border rounded-xl bg-slate-50 cursor-pointer hover:bg-brand-50 hover:border-brand-300 transition duration-300 border-slate-200/60">
                                <div class="flex justify-between items-center">
                                    <span class="font-mono font-bold text-xs text-brand-700">GRN: ${g.id}</span>
                                    <span class="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 font-bold uppercase tracking-wider">Unbilled GRN</span>
                                </div>
                                <div class="text-xs font-bold text-slate-800 mt-1.5">${po.itemName} (x${po.qty})</div>
                                <div class="text-[10px] text-slate-500 mt-1">Supplier: ${po.supplier}</div>
                            </div>
                        `;
                    }).join('');
                }

                // Render AP List for payment settlement (Bonus flow)
                const unpaidAP = state.invoices.filter(i =>
                    i.status === 'Verified & AP Created' && finance.isProcurementInPeriod(i.id)
                );
                const unpaidBox = document.getElementById('fin-unpaid-ap-list');
                
                if(unpaidAP.length === 0) {
                    unpaidBox.innerHTML = `<div class="text-center text-slate-400 py-6 text-xs border rounded-xl bg-slate-50 border-dashed">No AP liabilities (All paid).</div>`;
                } else {
                    unpaidBox.innerHTML = unpaidAP.map(ap => `
                        <div class="p-4 border border-slate-200 rounded-2xl bg-white shadow-sm flex justify-between items-center">
                            <div>
                                <div class="font-bold text-slate-800 text-xs">${ap.id} <span class="text-slate-400 font-normal">(${ap.manualInv})</span></div>
                                <div class="text-[10px] text-slate-500 mt-1">Total Payables: <span class="font-black text-slate-700">${utils.formatRp(ap.amount)}</span></div>
                            </div>
                            <button onclick="finance.payAP('${ap.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] px-3.5 py-1.5 rounded-lg transition uppercase tracking-wider shadow">LUNASI AP</button>
                        </div>
                    `).join('');
                }
            },
            selectMatch: (grnId, poId) => {
                const po = state.pos.find(p => p.id === poId);
                const inv = state.inventory[po.itemId];
                const costVal = po.qty * poUnitCost(po);

                finance.currentSelection = { grnId, poId, amount: costVal };
                document.getElementById('fin-match-overlay').classList.add('hide');

                document.getElementById('fm-po-id').innerText = poId;
                document.getElementById('fm-grn-id').innerText = grnId;
                document.getElementById('fm-supplier').innerText = po.supplier;
                document.getElementById('fm-item').innerText = `${po.itemName} (${po.qty} ${inv ? inv.unit : ''})`;
                document.getElementById('fm-standard-cost').innerText = utils.formatRp(costVal);

                // Reset Form Inputs
                document.getElementById('fm-inv-number').value = '';
                document.getElementById('fm-inv-amount').value = costVal;
                document.getElementById('fm-inv-file').value = '';
                document.getElementById('uploaded-inv-preview').classList.add('hide');
                document.getElementById('chk-po').checked = false;
                document.getElementById('chk-grn').checked = false;
                document.getElementById('chk-amt').checked = false;
                finance.uploadedFileRef = null;
            },
            simulateUpload: (e) => {
                const file = e.target.files[0];
                if(file) {
                    finance.uploadedFileRef = file.name;
                    document.getElementById('uploaded-inv-name').innerText = file.name;
                    document.getElementById('uploaded-inv-preview').classList.remove('hide');
                    utils.toast('Physical invoice attachment detected!', 'info');
                }
            },
            submitMatch: () => {
                if(!finance.currentSelection) return;

                const invNum = document.getElementById('fm-inv-number').value.trim();
                const invAmount = parseFloat(document.getElementById('fm-inv-amount').value);
                const chkPo = document.getElementById('chk-po').checked;
                const chkGrn = document.getElementById('chk-grn').checked;
                const chkAmt = document.getElementById('chk-amt').checked;

                if(!invNum) return utils.toast('Physical invoice document number is required!', 'warn');
                if(isNaN(invAmount) || invAmount <= 0) return utils.toast('Invoice amount is invalid!', 'warn');
                if(!finance.uploadedFileRef) return utils.toast('Physical invoice attachment is required!', 'warn');
                if(!chkPo || !chkGrn || !chkAmt) return utils.toast('All Internal Control Checklist items must be approved!', 'warn');

                const { poId, grnId, amount: stdCost } = finance.currentSelection;
                const invSysId = utils.generateId('INV-SYS');

                // Update PO Status
                const po = state.pos.find(p => p.id === poId);
                po.status = 'Invoiced';

                // Record AP invoice
                state.invoices.push({
                    id: invSysId,
                    manualInv: invNum,
                    poId,
                    grnId,
                    amount: invAmount,
                    status: 'Verified & AP Created',
                    fileName: finance.uploadedFileRef
                });

                // JOURNAL: Dr. Unbilled Payables (210) Cr. AP Payables (211)
                accounting.addJournal(invSysId, `3-Way Match & AP Accrual Filing - Physical Document: ${invNum}`, [
                    { account: '210', debit: stdCost, credit: 0 },
                    { account: '211', debit: 0, credit: invAmount }
                ]);

                finance.currentSelection = null;
                document.getElementById('fin-match-overlay').classList.remove('hide');
                finance.renderAP();
                utils.toast('Control successful! 3-Way Match posted in a COSO-compatible workflow.', 'success');
                audit.addLog('AP', `3-way match document successfully issued ${invSysId}. Unbilled Payables (210) closed, moved to Trade Payables AP (211)`);
            },
            payAP: (invSysId) => {
                const invoice = state.invoices.find(i => i.id === invSysId);
                invoice.status = 'Paid';

                const payId = utils.generateId('PAY');
                
                // JOURNAL: Dr. AP Payables (211) Cr. Bank QRIS/Cash (102/101)
                accounting.addJournal(payId, `AP Payable Settlement Ref: ${invoice.manualInv}`, [
                    { account: '211', debit: invoice.amount, credit: 0 },
                    { account: '102', debit: 0, credit: invoice.amount }
                ]);

                finance.renderAP();
                utils.toast('AP settlement successful! Bank funds reduced & liability cleared.', 'success');
                audit.addLog('AP', `Trade Payable ${invoice.id} amounting ${utils.formatRp(invoice.amount)} settled via Bank Transfer.`);
            },

            // --- ADVANCED ACCOUNTING LEDGER SYSTEM ---
            exportLedgerCSV: () => {
                const journal = finance.getFilteredJournal();
                if(journal.length === 0) return utils.toast('No journal data for the selected period to export!', 'warn');
                
                let csvContent = "data:text/csv;charset=utf-8,";
                csvContent += "Date,Reference Number,Journal Description,Account Code,Account Name,Debit,Credit\n";

                journal.forEach(j => {
                    const dateStr = utils.formatDate(j.date);
                    j.entries.forEach(e => {
                        const accName = accounting.coa[e.account];
                        const descSafe = j.description.replace(/,/g, ' '); // cegah comma memecah kolom
                        csvContent += `"${dateStr}","${j.ref}","${descSafe}","${e.account}","${accName}",${e.debit},${e.credit}\n`;
                    });
                });

                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", `General_Ledger_Lekker_Story_${new Date().getTime()}.csv`);
                document.body.appendChild(link); // Diperlukan untuk firefox
                link.click();
                link.remove();
                
                utils.toast('Ledger exported to CSV successfully!', 'success');
                audit.addLog('ACCOUNTING', 'Ledger CSV export downloaded by user.');
            },

            setLedgerViewMode: (mode) => {
                state.ledgerViewMode = mode;

                const tabs = { all: 'mode-ledger-all', account: 'mode-ledger-account', manual: 'mode-ledger-manual' };
                Object.entries(tabs).forEach(([k, id]) => {
                    const btn = document.getElementById(id);
                    if (!btn) return;
                    if (k === mode) {
                        if (k === 'manual') btn.className = 'px-4 py-2 rounded-lg bg-brand-600 text-white shadow transition flex items-center gap-1';
                        else btn.className = 'px-4 py-2 rounded-lg bg-white text-slate-800 shadow transition';
                    } else {
                        if (k === 'manual') btn.className = 'px-4 py-2 rounded-lg text-brand-700 hover:bg-brand-50 flex items-center gap-1 transition';
                        else btn.className = 'px-4 py-2 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition';
                    }
                });

                const subAll = document.getElementById('ledger-sub-all');
                const subAccount = document.getElementById('ledger-sub-account');
                const subManual = document.getElementById('ledger-sub-manual');
                [subAll, subAccount, subManual].forEach(el => el?.classList.add('hide'));

                if (mode === 'all' && subAll) {
                    subAll.classList.remove('hide');
                    finance.renderLedger();
                } else if (mode === 'account' && subAccount) {
                    subAccount.classList.remove('hide');
                    finance.populateAccountSelector();
                    finance.renderAccountCard();
                } else if (mode === 'manual' && subManual) {
                    subManual.classList.remove('hide');
                    finance.renderManualJournalForm();
                }
            },
            renderLedger: () => {
                const tbody = document.getElementById('fin-ledger-list');
                if (!tbody) return;
                const journal = finance.getFilteredJournal();
                if(journal.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-400">No journal entries for this period.</td></tr>';
                    document.getElementById('ledger-total-debit').innerText = 'Rp 0';
                    document.getElementById('ledger-total-credit').innerText = 'Rp 0';
                    return;
                }

                let html = '';
                let totalDebit = 0;
                let totalCredit = 0;

                // Sort journal entries newest-first (reverse of default array) for better UX
                [...journal].reverse().forEach(j => {
                    html += `
                        <tr class="bg-slate-50 border-t border-slate-200">
                            <td class="p-3 pl-6 font-bold text-slate-600 align-top">${utils.formatDate(j.date)}</td>
                            <td class="p-3 font-bold text-brand-600 font-mono align-top">${j.ref}</td>
                            <td colspan="3" class="p-3 font-bold text-slate-800 border-b border-slate-200/55">${j.description}</td>
                        </tr>
                    `;

                    j.entries.forEach(e => {
                        const isCredit = e.credit > 0;
                        totalDebit += e.debit;
                        totalCredit += e.credit;
                        html += `
                            <tr class="hover:bg-slate-100/50">
                                <td colspan="2" class="p-2"></td>
                                <td class="p-2 ${isCredit ? 'pl-10 text-slate-500' : 'text-slate-800 font-semibold'}">[${e.account}] ${accounting.coa[e.account]}</td>
                                <td class="p-2 text-right font-bold text-emerald-700">${e.debit > 0 ? utils.formatRp(e.debit) : ''}</td>
                                <td class="p-2 text-right font-bold text-brand-700 pr-6">${e.credit > 0 ? utils.formatRp(e.credit) : ''}</td>
                            </tr>
                        `;
                    });
                });

                tbody.innerHTML = html;
                document.getElementById('ledger-total-debit').innerText = utils.formatRp(totalDebit);
                document.getElementById('ledger-total-credit').innerText = utils.formatRp(totalCredit);
            },
            populateAccountSelector: () => {
                const sel = document.getElementById('ledger-account-selector');
                sel.innerHTML = Object.entries(accounting.coa).map(([code, name]) => `
                    <option value="${code}">[${code}] - ${name}</option>
                `).join('');
            },
            renderAccountCard: () => {
                const code = document.getElementById('ledger-account-selector').value;
                const tbody = document.getElementById('account-card-tbody');
                
                // Normal Balance Logic
                // Assets (1xx), Expenses (5xx, 6xx) are Debit normal
                const isDebitNormal = code.startsWith('1') || code.startsWith('5') || code.startsWith('6');

                let runningBalance = 0;
                let rowsHtml = '';

                // Filter & Sort entries
                finance.getFilteredJournal().forEach(j => {
                    j.entries.forEach(e => {
                        if (e.account === code) {
                            if (isDebitNormal) {
                                runningBalance += (e.debit - e.credit);
                            } else {
                                runningBalance += (e.credit - e.debit);
                            }

                            rowsHtml += `
                                <tr class="hover:bg-slate-50 border-b">
                                    <td class="p-4 pl-6 text-slate-500">${utils.formatDate(j.date)}</td>
                                    <td class="p-4 font-bold text-brand-600">${j.ref}</td>
                                    <td class="p-4 font-sans text-slate-700">${j.description}</td>
                                    <td class="p-4 text-right text-slate-800">${e.debit > 0 ? utils.formatRp(e.debit) : '-'}</td>
                                    <td class="p-4 text-right text-slate-800">${e.credit > 0 ? utils.formatRp(e.credit) : '-'}</td>
                                    <td class="p-4 text-right font-bold text-brand-700 pr-6">${utils.formatRp(runningBalance)}</td>
                                </tr>
                            `;
                        }
                    });
                });

                if (!rowsHtml) {
                    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">No transaction entries exist for Account [${code}].</td></tr>`;
                } else {
                    tbody.innerHTML = rowsHtml;
                }
            },
            renderManualJournalForm: () => {
                const container = document.getElementById('manual-jv-rows');
                document.getElementById('manual-jv-ref').value = utils.generateId('JV');
                
                container.innerHTML = state.manualJvLines.map((row, idx) => `
                    <div class="flex flex-col md:flex-row gap-2 items-center text-xs">
                        <select onchange="finance.updateManualLineAccount(${idx}, this.value)" class="w-full md:w-3/6 p-2.5 border rounded-xl font-bold text-slate-700 bg-white">
                            <option value="">-- Select COA Account --</option>
                            ${Object.entries(accounting.coa).map(([code, name]) => `
                                <option value="${code}" ${row.account === code ? 'selected' : ''}>[${code}] - ${name}</option>
                            `).join('')}
                        </select>
                        <div class="flex gap-2 w-full md:w-2/6">
                            <input type="number" oninput="finance.updateManualLineVal(${idx}, 'debit', this.value)" class="w-1/2 p-2 border rounded-xl text-right font-bold focus:ring-2 focus:ring-brand-500 outline-none" placeholder="Debit (Rp)" value="${row.debit || ''}">
                            <input type="number" oninput="finance.updateManualLineVal(${idx}, 'credit', this.value)" class="w-1/2 p-2 border rounded-xl text-right font-bold focus:ring-2 focus:ring-brand-500 outline-none" placeholder="Credit (Rp)" value="${row.credit || ''}">
                        </div>
                        <button onclick="finance.deleteManualJournalRow(${idx})" class="p-2 text-red-500 hover:bg-red-50 rounded-xl transition self-end md:self-auto"><i class="fas fa-trash-can"></i></button>
                    </div>
                `).join('');
                finance.validateManualJV();
            },
            addManualJournalRow: () => {
                state.manualJvLines.push({ account: '', debit: 0, credit: 0 });
                finance.renderManualJournalForm();
            },
            deleteManualJournalRow: (idx) => {
                if (state.manualJvLines.length <= 2) {
                    return utils.toast('Journal requires at least 2 paired rows!', 'warn');
                }
                state.manualJvLines.splice(idx, 1);
                finance.renderManualJournalForm();
            },
            updateManualLineAccount: (idx, val) => {
                state.manualJvLines[idx].account = val;
                finance.validateManualJV();
            },
            updateManualLineVal: (idx, key, val) => {
                state.manualJvLines[idx][key] = parseFloat(val) || 0;
                finance.validateManualJV();
            },
            validateManualJV: () => {
                let totalDebit = 0;
                let totalCredit = 0;
                let hasEmptyAccount = false;

                state.manualJvLines.forEach(line => {
                    totalDebit += line.debit;
                    totalCredit += line.credit;
                    if (!line.account) hasEmptyAccount = true;
                });

                document.getElementById('manual-jv-total-debit').innerText = utils.formatRp(totalDebit);
                document.getElementById('manual-jv-total-credit').innerText = utils.formatRp(totalCredit);

                const statusBox = document.getElementById('manual-jv-validation-status');
                const isBalanced = (totalDebit === totalCredit) && (totalDebit > 0);
                
                if (isBalanced && !hasEmptyAccount) {
                    statusBox.className = "text-emerald-600 flex items-center gap-1";
                    statusBox.innerHTML = `<i class="fas fa-check-circle"></i> Journal Balanced (Ready to Post)`;
                    return true;
                } else {
                    statusBox.className = "text-red-600 flex items-center gap-1";
                    const errMsg = (totalDebit !== totalCredit) ? 'Journal Not Balanced' : hasEmptyAccount ? 'An account is empty' : 'Debit/Credit missing';
                    statusBox.innerHTML = `<i class="fas fa-circle-exclamation"></i> ${errMsg}`;
                    return false;
                }
            },
            postManualJournal: () => {
                if (!finance.validateManualJV()) {
                    return utils.toast('Post rejected! Ensure journal is balanced, no empty accounts, and all amounts are positive.', 'error');
                }

                const desc = document.getElementById('manual-jv-desc').value.trim();
                const ref = document.getElementById('manual-jv-ref').value.trim() || utils.generateId('JV');

                if (!desc) return utils.toast('Manual journal transaction description is required!', 'warn');

                // Filter out zero lines
                const entries = state.manualJvLines.map(line => ({
                    account: line.account,
                    debit: line.debit,
                    credit: line.credit
                })).filter(line => line.debit > 0 || line.credit > 0);

                // Post
                accounting.addJournal(ref, `JV Manual: ${desc}`, entries);
                utils.toast('Success! Manual journal voucher posted to the Ledger.', 'success');
                audit.addLog('ACCOUNTING', `Manual JV Posted: ${ref} - ${desc}`);

                // Reset
                state.manualJvLines = [
                    { account: '', debit: 0, credit: 0 },
                    { account: '', debit: 0, credit: 0 }
                ];
                document.getElementById('manual-jv-desc').value = '';
                finance.setLedgerViewMode('all');
                finance.refreshFilteredViews();
            },

            // --- TRIAL BALANCE RENDER ---
            renderTrialBalance: () => {
                const tbody = document.getElementById('trial-balance-tbody');
                const journal = finance.getFilteredJournal();
                
                // Calculate balance for each COA
                const balances = {};
                Object.keys(accounting.coa).forEach(c => { balances[c] = 0; });

                journal.forEach(j => {
                    j.entries.forEach(e => {
                        balances[e.account] += (e.debit - e.credit);
                    });
                });

                let totalDebit = 0;
                let totalCredit = 0;
                let html = '';

                Object.entries(balances).forEach(([code, net]) => {
                    // Normal Balance Rule
                    // Assets (1) & Expenses (5, 6) are Debit
                    // Liabilities (2), Equity (3), Revenues (4) are Credit
                    const isDebitNormal = code.startsWith('1') || code.startsWith('5') || code.startsWith('6');
                    
                    let debVal = 0;
                    let credVal = 0;

                    if (isDebitNormal) {
                        if (net >= 0) debVal = net;
                        else credVal = Math.abs(net);
                    } else {
                        if (net <= 0) credVal = Math.abs(net);
                        else debVal = net;
                    }

                    if (debVal === 0 && credVal === 0) return; // Skip zero balance accounts for clarity

                    totalDebit += debVal;
                    totalCredit += credVal;

                    html += `
                        <tr class="hover:bg-slate-50 border-b">
                            <td class="p-4 pl-6 font-bold text-slate-500">${code}</td>
                            <td class="p-4 font-sans text-slate-700 font-semibold">${accounting.coa[code]}</td>
                            <td class="p-4 text-right font-bold text-slate-800">${debVal > 0 ? utils.formatRp(debVal) : '-'}</td>
                            <td class="p-4 text-right font-bold text-slate-800 pr-6">${credVal > 0 ? utils.formatRp(credVal) : '-'}</td>
                        </tr>
                    `;
                });

                tbody.innerHTML = html;
                document.getElementById('trial-balance-total-debit').innerText = utils.formatRp(totalDebit);
                document.getElementById('trial-balance-total-credit').innerText = utils.formatRp(totalCredit);

                const tbDiff = Math.abs(totalDebit - totalCredit);
                const tbBalanced = tbDiff < 1;
                finance.renderBalanceStatusBadge('tb-balance-indicator', tbBalanced, tbDiff);
            },

            renderStatements: () => {
                const journal = finance.getFilteredJournal();
                // Calculate each COA balance from the general ledger
                const balances = {};
                Object.keys(accounting.coa).forEach(c => { balances[c] = 0; });

                journal.forEach(j => {
                    j.entries.forEach(e => {
                        balances[e.account] += (e.debit - e.credit);
                    });
                });

                // Trial balance totals (for badge — same rules as renderTrialBalance)
                let tbTotalDebit = 0;
                let tbTotalCredit = 0;
                Object.entries(balances).forEach(([code, net]) => {
                    const isDebitNormal = code.startsWith('1') || code.startsWith('5') || code.startsWith('6');
                    let debVal = 0;
                    let credVal = 0;
                    if (isDebitNormal) {
                        if (net >= 0) debVal = net;
                        else credVal = Math.abs(net);
                    } else {
                        if (net <= 0) credVal = Math.abs(net);
                        else debVal = net;
                    }
                    if (debVal === 0 && credVal === 0) return;
                    tbTotalDebit += debVal;
                    tbTotalCredit += credVal;
                });
                const tbDiff = Math.abs(tbTotalDebit - tbTotalCredit);
                finance.renderBalanceStatusBadge('tb-balance-indicator', tbDiff < 1, tbDiff);

                // INCOME STATEMENT CALCULATION
                const revenue = Math.abs(balances['401']); 
                const cogs = Math.abs(balances['501']); 
                const grossMargin = revenue - cogs;
                
                const shortBeban = balances['502']; // Cashier variance
                const adjustBeban = balances['503']; // Inventory stocktake variance
                const salaryBeban = Math.abs(balances['601']); // Salaries
                const operBeban = Math.abs(balances['602']); // Electricity/Wifi

                const totalExpense = shortBeban + adjustBeban + salaryBeban + operBeban;
                const netIncome = grossMargin - totalExpense;

                document.getElementById('stmt-inc-revenue').innerText = utils.formatRp(revenue);
                document.getElementById('stmt-inc-total-rev').innerText = utils.formatRp(revenue);
                document.getElementById('stmt-inc-cogs').innerText = `(${utils.formatRp(cogs)})`;
                document.getElementById('stmt-inc-gross').innerText = utils.formatRp(grossMargin);
                document.getElementById('stmt-inc-shortage').innerText = utils.formatRp(shortBeban);
                document.getElementById('stmt-inc-adjust-expense').innerText = utils.formatRp(adjustBeban);
                document.getElementById('stmt-inc-expense-601').innerText = utils.formatRp(salaryBeban);
                document.getElementById('stmt-inc-expense-602').innerText = utils.formatRp(operBeban);
                document.getElementById('stmt-inc-net').innerText = utils.formatRp(netIncome);

                // BALANCE SHEET CALCULATION
                const assetCash = balances['101'];
                const assetQris = balances['102'];
                const assetCard = balances['103'];
                const assetInventory = balances['110'];
                const totalAssets = assetCash + assetQris + assetCard + assetInventory;

                // --- FIX 1 --- Credit-normal accounts: use absolute balance for display & totals
                const liabAccrual = Math.abs(balances['210']);
                const liabAP = Math.abs(balances['211']);
                const liabTaxPayable = Math.abs(balances['212']); // Tax accrued in POS
                const equityCapital = Math.abs(balances['301']);
                const equityRetained = netIncome; // Automatically move profit/loss to equity
                const totalLiabEquity = liabAccrual + liabAP + liabTaxPayable + equityCapital + equityRetained;
                const bsDiff = Math.abs(totalAssets - totalLiabEquity);
                const bsBalanced = bsDiff < 1;
                finance.renderBalanceStatusBadge('bs-balance-indicator', bsBalanced, bsDiff);

                document.getElementById('stmt-bal-cash').innerText = utils.formatRp(assetCash);
                document.getElementById('stmt-bal-qris').innerText = utils.formatRp(assetQris);
                document.getElementById('stmt-bal-card').innerText = utils.formatRp(assetCard);
                document.getElementById('stmt-bal-inventory').innerText = utils.formatRp(assetInventory);
                document.getElementById('stmt-bal-total-assets').innerText = utils.formatRp(totalAssets);

                document.getElementById('stmt-bal-accrual').innerText = utils.formatRp(liabAccrual);
                document.getElementById('stmt-bal-ap').innerText = utils.formatRp(liabAP);
                document.getElementById('stmt-bal-taxpayable').innerText = utils.formatRp(liabTaxPayable);
                document.getElementById('stmt-bal-equity').innerText = utils.formatRp(equityCapital);
                document.getElementById('stmt-bal-retained').innerText = utils.formatRp(equityRetained);
                document.getElementById('stmt-bal-total-liab-eq').innerText = utils.formatRp(totalLiabEquity);
            },
            renderAuditLogs: () => {
                const container = document.getElementById('fin-audit-logs');
                const logs = finance.getFilteredAuditLogs();
                if(logs.length === 0) {
                    container.innerHTML = '<div class="text-slate-400 text-center py-4">No activity recorded for this period.</div>';
                    return;
                }
                container.innerHTML = logs.map(l => `
                    <div class="border-b border-slate-100 py-2 flex items-start gap-2 leading-relaxed">
                        <span class="text-slate-400 font-bold">[${utils.formatDate(l.timestamp)}]</span>
                        <span class="text-brand-700 font-bold uppercase tracking-wider text-[10px] bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">${l.module}</span>
                        <span class="text-slate-600 font-bold flex-1">${l.detail}</span>
                        <span class="text-indigo-600 font-extrabold text-[10px] bg-indigo-50 px-1.5 rounded">${l.user}</span>
                    </div>
                `).join('');
            }
        };

        // RESTORE 3: ES modules have private scope - onclick= attributes in HTML
        // can't see module-local variables. Expose all interactive objects on window.
        // This is the standard pattern for module-based vanilla JS with inline handlers.
        window.app      = app;
        window.pos      = pos;
        window.manager  = manager;
        window.finance  = finance;
        window.audit    = audit;
        window.utils    = utils;

        // Demo / evaluation UI (?demo=1 in URL — for grading & sandbox)
        const isDemoMode = new URLSearchParams(location.search).has('demo');
        if (isDemoMode) {
            document.querySelectorAll('.demo-only').forEach(el => el.classList.remove('hide'));
        }

        utils.startLiveClock();
        document.getElementById('app-loader')?.classList.add('hide');
        console.log('Lekker Story ERP — Firebase Auth active.', isDemoMode ? '(Demo mode)' : '', `Menus: ${state.menus.length}`);

