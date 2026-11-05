/** Lekker Story full menu catalog */
export const LEKKER_DEFAULT_INVENTORY = {
    "inv_tepung": {
        "id": "inv_tepung",
        "name": "Wheat flour mix",
        "stock": 0,
        "par": 5,
        "unit": "kg",
        "cost": 12000
    },
    "inv_coklat": {
        "id": "inv_coklat",
        "name": "Chocolate compound",
        "stock": 0,
        "par": 4,
        "unit": "kg",
        "cost": 45000
    },
    "inv_keju": {
        "id": "inv_keju",
        "name": "Cheddar cheese",
        "stock": 0,
        "par": 3,
        "unit": "kg",
        "cost": 60000
    },
    "inv_pisang": {
        "id": "inv_pisang",
        "name": "Banana",
        "stock": 0,
        "par": 6,
        "unit": "pcs",
        "cost": 3000
    },
    "inv_gula": {
        "id": "inv_gula",
        "name": "Sugar syrup",
        "stock": 0,
        "par": 4,
        "unit": "L",
        "cost": 14000
    },
    "inv_susu": {
        "id": "inv_susu",
        "name": "Milk / condensed milk",
        "stock": 0,
        "par": 12,
        "unit": "can",
        "cost": 11000
    },
    "inv_cup": {
        "id": "inv_cup",
        "name": "Cup & straw",
        "stock": 0,
        "par": 80,
        "unit": "pcs",
        "cost": 800
    },
    "inv_kopi": {
        "id": "inv_kopi",
        "name": "Coffee beans / powder",
        "stock": 0,
        "par": 3,
        "unit": "kg",
        "cost": 95000
    },
    "inv_sirup": {
        "id": "inv_sirup",
        "name": "Drink syrup & flavor",
        "stock": 0,
        "par": 6,
        "unit": "bottle",
        "cost": 35000
    },
    "inv_berry": {
        "id": "inv_berry",
        "name": "Berry & fruit prep",
        "stock": 0,
        "par": 5,
        "unit": "kg",
        "cost": 28000
    },
    "inv_ovomaltine": {
        "id": "inv_ovomaltine",
        "name": "Ovomaltine powder",
        "stock": 0,
        "par": 2,
        "unit": "kg",
        "cost": 75000
    },
    "inv_crunch": {
        "id": "inv_crunch",
        "name": "Choco crunch topping",
        "stock": 0,
        "par": 3,
        "unit": "kg",
        "cost": 42000
    },
    "inv_greentea": {
        "id": "inv_greentea",
        "name": "Green tea powder",
        "stock": 0,
        "par": 2,
        "unit": "kg",
        "cost": 65000
    },
    "inv_ayam": {
        "id": "inv_ayam",
        "name": "Chicken portion",
        "stock": 0,
        "par": 10,
        "unit": "pcs",
        "cost": 18000
    },
    "inv_bumbu": {
        "id": "inv_bumbu",
        "name": "Spice & sauce mix",
        "stock": 0,
        "par": 5,
        "unit": "pack",
        "cost": 8000
    },
    "inv_minyak": {
        "id": "inv_minyak",
        "name": "Cooking oil",
        "stock": 0,
        "par": 4,
        "unit": "L",
        "cost": 22000
    }
};

// --- FIX 2 --- Standard material costs (source: LEKKER_DEFAULT_INVENTORY.cost)
const MATERIAL_SUPPLIERS = {
    inv_tepung: 'CV. Agro Sembako',
    inv_coklat: 'PT. Coklat Nusantara',
    inv_keju: 'UD. Keju Jaya',
    inv_pisang: 'Pasar Buah Segar',
    inv_gula: 'CV. Agro Sembako',
    inv_susu: 'PT. Susu Kemasan',
    inv_cup: 'Toko Kemasan Lokal',
    inv_kopi: 'Roastery Kopi Nusantara',
    inv_sirup: 'PT. Sirup Minuman',
    inv_berry: 'Pasar Buah Segar',
    inv_ovomaltine: 'PT. Impor Snack',
    inv_crunch: 'PT. Coklat Nusantara',
    inv_greentea: 'PT. Teh Premium',
    inv_ayam: 'Supplier Ayam Potong',
    inv_bumbu: 'UD. Bumbu Dapur',
    inv_minyak: 'CV. Agro Sembako'
};

export const MATERIAL_PRICE_LIST = Object.fromEntries(
    Object.entries(LEKKER_DEFAULT_INVENTORY).map(([id, item]) => [
        id,
        {
            defaultCost: item.cost,
            unit: item.unit,
            supplier: MATERIAL_SUPPLIERS[id] || 'Local Food Supplier'
        }
    ])
);

/** Markup multipliers aligned with catalog selling prices (BOM cost → harga jual + untung) */
export const MENU_PRICING = {
    lekkerMarkup: 1.74,
    drinkMarkup: 2.8,
    snackMarkup: 2.0,
    roundStepLekker: 500,
    roundStepDrink: 1000,
    roundStepSnack: 500,
    minPriceLekker: 5000,
    minPriceDrink: 15000,
    minPriceSnack: 10000
};

export function getStandardUnitCost(invId, inventory = LEKKER_DEFAULT_INVENTORY) {
    return MATERIAL_PRICE_LIST[invId]?.defaultCost ?? inventory[invId]?.cost ?? 0;
}

export function computeBomCostFromIngredients(ingredients, inventory = LEKKER_DEFAULT_INVENTORY) {
    if (!ingredients || typeof ingredients !== 'object') return 0;
    return Object.entries(ingredients).reduce((sum, [invId, qty]) => {
        const q = parseFloat(qty);
        if (!q || q <= 0) return sum;
        return sum + getStandardUnitCost(invId, inventory) * q;
    }, 0);
}

export function suggestMenuSellingPrice(bomCost, category = '') {
    const cat = String(category).toLowerCase();
    const isDrink = /juice|shake|coffee|smoothie|hot|minuman|drink|non-coffee/.test(cat);
    const isSnack = /snack|ayam|lauk|fried/.test(cat);
    const markup = isDrink ? MENU_PRICING.drinkMarkup
        : isSnack ? MENU_PRICING.snackMarkup
        : MENU_PRICING.lekkerMarkup;
    const step = isDrink ? MENU_PRICING.roundStepDrink
        : isSnack ? MENU_PRICING.roundStepSnack
        : MENU_PRICING.roundStepLekker;
    const raw = bomCost * markup;
    if (raw <= 0) return 0;
    const min = isDrink ? MENU_PRICING.minPriceDrink
        : isSnack ? MENU_PRICING.minPriceSnack
        : MENU_PRICING.minPriceLekker;
    const rounded = Math.ceil(raw / step) * step;
    return Math.max(min, rounded);
}

export const LEKKER_DEFAULT_MENUS = [
    {
        "id": "m1",
        "name": "Coklat",
        "price": 5000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m2",
        "name": "Coklat Pisang",
        "price": 5000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m3",
        "name": "Coklat Milo",
        "price": 7000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m4",
        "name": "Coklat Kacang",
        "price": 7000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m5",
        "name": "Coklat Susu Kacang",
        "price": 7000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m6",
        "name": "Coklat Pisang Kacang",
        "price": 7000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m7",
        "name": "Coklat Keju",
        "price": 7000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m8",
        "name": "Coklat Keju Pisang",
        "price": 7000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m9",
        "name": "Coklat Keju Milo",
        "price": 9000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m10",
        "name": "Coklat Keju Kacang",
        "price": 9000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m11",
        "name": "Coklat Keju Pisang Milo",
        "price": 9000,
        "category": "Lekker · Coklat",
        "emoji": "🍫",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.05,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m12",
        "name": "Keju Susu",
        "price": 5000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m13",
        "name": "Keju Pisang",
        "price": 7000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m14",
        "name": "Keju Milo",
        "price": 7000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m15",
        "name": "Keju Susu Kacang",
        "price": 7000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m16",
        "name": "Keju Susu Almond",
        "price": 8000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m17",
        "name": "Keju Pisang Kacang",
        "price": 8000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m18",
        "name": "Keju Pisang Milo",
        "price": 8000,
        "category": "Lekker · Keju",
        "emoji": "🧀",
        "ing": {
            "inv_tepung": 0.04,
            "inv_keju": 0.04,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m19",
        "name": "Nutella",
        "price": 8000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m20",
        "name": "Nutella Kacang",
        "price": 9000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m21",
        "name": "Nutella Almond",
        "price": 10000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m22",
        "name": "Nutella Keju",
        "price": 12000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m23",
        "name": "Nutella Pisang Keju",
        "price": 13000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m24",
        "name": "Nutella Almond Keju",
        "price": 14000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m25",
        "name": "Nutella Skippy",
        "price": 14000,
        "category": "Lekker · Nutella",
        "emoji": "🫙",
        "ing": {
            "inv_tepung": 0.03,
            "inv_coklat": 0.06,
            "inv_keju": 0.02,
            "inv_gula": 0.01
        }
    },
    {
        "id": "m26",
        "name": "Ovomaltine",
        "price": 8000,
        "category": "Lekker · Ovomaltine",
        "emoji": "🥛",
        "ing": {
            "inv_tepung": 0.04,
            "inv_ovomaltine": 0.05,
            "inv_susu": 0.05
        }
    },
    {
        "id": "m27",
        "name": "Ovomaltine Pisang",
        "price": 9000,
        "category": "Lekker · Ovomaltine",
        "emoji": "🥛",
        "ing": {
            "inv_tepung": 0.04,
            "inv_ovomaltine": 0.05,
            "inv_susu": 0.05
        }
    },
    {
        "id": "m28",
        "name": "Ovomaltine Keju",
        "price": 12000,
        "category": "Lekker · Ovomaltine",
        "emoji": "🥛",
        "ing": {
            "inv_tepung": 0.04,
            "inv_ovomaltine": 0.05,
            "inv_susu": 0.05
        }
    },
    {
        "id": "m29",
        "name": "Strawberry / Blueberry",
        "price": 4000,
        "category": "Lekker · Berry",
        "emoji": "🍓",
        "ing": {
            "inv_berry": 0.08,
            "inv_pisang": 0.05,
            "inv_susu": 0.05,
            "inv_cup": 1
        }
    },
    {
        "id": "m30",
        "name": "Strawberry / Blueberry Keju",
        "price": 8000,
        "category": "Lekker · Berry",
        "emoji": "🍓",
        "ing": {
            "inv_berry": 0.08,
            "inv_pisang": 0.05,
            "inv_susu": 0.05,
            "inv_cup": 1
        }
    },
    {
        "id": "m31",
        "name": "Pisang Susu",
        "price": 3000,
        "category": "Lekker · Berry",
        "emoji": "🍓",
        "ing": {
            "inv_berry": 0.08,
            "inv_pisang": 0.05,
            "inv_susu": 0.05,
            "inv_cup": 1
        }
    },
    {
        "id": "m32",
        "name": "Choco Crunch",
        "price": 5000,
        "category": "Lekker · Choco Crunch",
        "emoji": "🥣",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_crunch": 0.03
        }
    },
    {
        "id": "m33",
        "name": "Choco Crunch Pisang",
        "price": 7000,
        "category": "Lekker · Choco Crunch",
        "emoji": "🥣",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_crunch": 0.03
        }
    },
    {
        "id": "m34",
        "name": "Choco Crunch Keju",
        "price": 8000,
        "category": "Lekker · Choco Crunch",
        "emoji": "🥣",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_crunch": 0.03
        }
    },
    {
        "id": "m35",
        "name": "Choco Crunch Pisang Keju",
        "price": 9000,
        "category": "Lekker · Choco Crunch",
        "emoji": "🥣",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_crunch": 0.03
        }
    },
    {
        "id": "m36",
        "name": "Greentea",
        "price": 7000,
        "category": "Lekker · Green Tea",
        "emoji": "🍵",
        "ing": {
            "inv_greentea": 0.03,
            "inv_susu": 0.08,
            "inv_cup": 1
        }
    },
    {
        "id": "m37",
        "name": "Greentea Almond",
        "price": 9000,
        "category": "Lekker · Green Tea",
        "emoji": "🍵",
        "ing": {
            "inv_greentea": 0.03,
            "inv_susu": 0.08,
            "inv_cup": 1
        }
    },
    {
        "id": "m38",
        "name": "Greentea Keju",
        "price": 11000,
        "category": "Lekker · Green Tea",
        "emoji": "🍵",
        "ing": {
            "inv_greentea": 0.03,
            "inv_susu": 0.08,
            "inv_cup": 1
        }
    },
    {
        "id": "m39",
        "name": "Tiramisu",
        "price": 5000,
        "category": "Lekker · Mixed",
        "emoji": "✨",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_keju": 0.02
        }
    },
    {
        "id": "m40",
        "name": "Silverqueen",
        "price": 8000,
        "category": "Lekker · Mixed",
        "emoji": "✨",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_keju": 0.02
        }
    },
    {
        "id": "m41",
        "name": "Silverqueen Keju",
        "price": 12000,
        "category": "Lekker · Mixed",
        "emoji": "✨",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_keju": 0.02
        }
    },
    {
        "id": "m42",
        "name": "Oreo",
        "price": 5000,
        "category": "Lekker · Mixed",
        "emoji": "✨",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_keju": 0.02
        }
    },
    {
        "id": "m43",
        "name": "Skippy",
        "price": 6000,
        "category": "Lekker · Mixed",
        "emoji": "✨",
        "ing": {
            "inv_tepung": 0.04,
            "inv_coklat": 0.04,
            "inv_keju": 0.02
        }
    },
    {
        "id": "m44",
        "name": "Ayam Bali",
        "price": 25000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m45",
        "name": "Ayam Teriyaki",
        "price": 25000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m46",
        "name": "Ayam Saus Padang",
        "price": 25000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m47",
        "name": "Ayam Woku",
        "price": 25000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m48",
        "name": "Nasi Goreng Hongkong",
        "price": 15000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m49",
        "name": "Indomie Goreng",
        "price": 15000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m50",
        "name": "Indomie Kuah",
        "price": 15000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m51",
        "name": "Cireng",
        "price": 18000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m52",
        "name": "Kentang Goreng",
        "price": 20000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m53",
        "name": "Otak-Otak",
        "price": 18000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m54",
        "name": "Nugget",
        "price": 20000,
        "category": "Food · Snack",
        "emoji": "🍗",
        "ing": {
            "inv_ayam": 0.15,
            "inv_bumbu": 0.02,
            "inv_minyak": 0.02
        }
    },
    {
        "id": "m55",
        "name": "Kopi Susu JS",
        "price": 22000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m56",
        "name": "Long Black",
        "price": 20000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m57",
        "name": "Classic Latte",
        "price": 20000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m58",
        "name": "Caramelo Latte",
        "price": 24000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m59",
        "name": "Hazel Latte",
        "price": 24000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m60",
        "name": "French Latte",
        "price": 24000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m61",
        "name": "Mochacino",
        "price": 25000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m62",
        "name": "Avopresso",
        "price": 25000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m63",
        "name": "Black Yuzu",
        "price": 25000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m64",
        "name": "Butterscotch Sea Salt Latte",
        "price": 26000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m65",
        "name": "Coffee Matcha",
        "price": 25000,
        "category": "Drinks · Coffee",
        "emoji": "☕",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.12,
            "inv_cup": 1
        }
    },
    {
        "id": "m66",
        "name": "Classic Chocolate",
        "price": 20000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m67",
        "name": "Hazelnut Cocoa",
        "price": 22000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m68",
        "name": "Matcha Latte",
        "price": 20000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m69",
        "name": "Honey Yuzu",
        "price": 22000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m70",
        "name": "Regale Milk",
        "price": 20000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m71",
        "name": "Lychee Tea",
        "price": 18000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m72",
        "name": "Lemon Tea",
        "price": 17000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m73",
        "name": "Yuzu Purple Soda",
        "price": 25000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m74",
        "name": "Mango Ocean",
        "price": 24000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m75",
        "name": "Red Lime Blue Soda",
        "price": 24000,
        "category": "Drinks · Non-Coffee",
        "emoji": "🧋",
        "ing": {
            "inv_sirup": 0.06,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m76",
        "name": "Berrie Lover",
        "price": 25000,
        "category": "Drinks · Smoothie",
        "emoji": "🥤",
        "ing": {
            "inv_berry": 0.1,
            "inv_susu": 0.15,
            "inv_cup": 1
        }
    },
    {
        "id": "m77",
        "name": "Summer Breeze",
        "price": 25000,
        "category": "Drinks · Smoothie",
        "emoji": "🥤",
        "ing": {
            "inv_berry": 0.1,
            "inv_susu": 0.15,
            "inv_cup": 1
        }
    },
    {
        "id": "m78",
        "name": "Mango Blast",
        "price": 25000,
        "category": "Drinks · Smoothie",
        "emoji": "🥤",
        "ing": {
            "inv_berry": 0.1,
            "inv_susu": 0.15,
            "inv_cup": 1
        }
    },
    {
        "id": "m79",
        "name": "Banana Treats",
        "price": 25000,
        "category": "Drinks · Smoothie",
        "emoji": "🥤",
        "ing": {
            "inv_berry": 0.1,
            "inv_susu": 0.15,
            "inv_cup": 1
        }
    },
    {
        "id": "m80",
        "name": "Kopi Susu JS (Hot)",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m81",
        "name": "Latte (Hot)",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m82",
        "name": "Cappucino (Hot)",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m83",
        "name": "Americano (Hot)",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m84",
        "name": "Mocha (Hot)",
        "price": 22000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m85",
        "name": "Hot Chocolate",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m86",
        "name": "Hazel Cocoa (Hot)",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    },
    {
        "id": "m87",
        "name": "Matcha Latte (Hot)",
        "price": 20000,
        "category": "Drinks · Hot",
        "emoji": "♨️",
        "ing": {
            "inv_kopi": 0.02,
            "inv_susu": 0.1,
            "inv_cup": 1
        }
    }
];
export const LEKKER_BOM_PRESETS = {
    "chocolate": {
        "inv_tepung": 0.04,
        "inv_coklat": 0.05,
        "inv_gula": 0.01
    },
    "cheese": {
        "inv_tepung": 0.04,
        "inv_keju": 0.04,
        "inv_gula": 0.01
    },
    "nutella": {
        "inv_tepung": 0.03,
        "inv_coklat": 0.06,
        "inv_keju": 0.02,
        "inv_gula": 0.01
    },
    "ovomaltine": {
        "inv_tepung": 0.04,
        "inv_ovomaltine": 0.05,
        "inv_susu": 0.05
    },
    "berry": {
        "inv_berry": 0.08,
        "inv_pisang": 0.05,
        "inv_susu": 0.05,
        "inv_cup": 1
    },
    "crunch": {
        "inv_tepung": 0.04,
        "inv_coklat": 0.04,
        "inv_crunch": 0.03
    },
    "greentea": {
        "inv_greentea": 0.03,
        "inv_susu": 0.08,
        "inv_cup": 1
    },
    "mixed": {
        "inv_tepung": 0.04,
        "inv_coklat": 0.04,
        "inv_keju": 0.02
    },
    "food": {
        "inv_ayam": 0.15,
        "inv_bumbu": 0.02,
        "inv_minyak": 0.02
    },
    "coffee": {
        "inv_kopi": 0.02,
        "inv_susu": 0.12,
        "inv_cup": 1
    },
    "noncoffee": {
        "inv_sirup": 0.06,
        "inv_susu": 0.1,
        "inv_cup": 1
    },
    "smoothie": {
        "inv_berry": 0.1,
        "inv_susu": 0.15,
        "inv_cup": 1
    },
    "hotdrink": {
        "inv_kopi": 0.02,
        "inv_susu": 0.1,
        "inv_cup": 1
    }
};
