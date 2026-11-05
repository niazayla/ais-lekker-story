const fs = require('fs');
const sections = [
  { cat: 'Lekker · Coklat', emoji: '🍫', bom: 'chocolate', items: [
    ['Coklat', 5000], ['Coklat Pisang', 5000], ['Coklat Milo', 7000], ['Coklat Kacang', 7000], ['Coklat Susu Kacang', 7000],
    ['Coklat Pisang Kacang', 7000], ['Coklat Keju', 7000], ['Coklat Keju Pisang', 7000], ['Coklat Keju Milo', 9000],
    ['Coklat Keju Kacang', 9000], ['Coklat Keju Pisang Milo', 9000]
  ]},
  { cat: 'Lekker · Keju', emoji: '🧀', bom: 'cheese', items: [
    ['Keju Susu', 5000], ['Keju Pisang', 7000], ['Keju Milo', 7000], ['Keju Susu Kacang', 7000], ['Keju Susu Almond', 8000],
    ['Keju Pisang Kacang', 8000], ['Keju Pisang Milo', 8000]
  ]},
  { cat: 'Lekker · Nutella', emoji: '🫙', bom: 'nutella', items: [
    ['Nutella', 8000], ['Nutella Kacang', 9000], ['Nutella Almond', 10000], ['Nutella Keju', 12000], ['Nutella Pisang Keju', 13000],
    ['Nutella Almond Keju', 14000], ['Nutella Skippy', 14000]
  ]},
  { cat: 'Lekker · Ovomaltine', emoji: '🥛', bom: 'ovomaltine', items: [
    ['Ovomaltine', 8000], ['Ovomaltine Pisang', 9000], ['Ovomaltine Keju', 12000]
  ]},
  { cat: 'Lekker · Berry', emoji: '🍓', bom: 'berry', items: [
    ['Strawberry / Blueberry', 4000], ['Strawberry / Blueberry Keju', 8000], ['Pisang Susu', 3000]
  ]},
  { cat: 'Lekker · Choco Crunch', emoji: '🥣', bom: 'crunch', items: [
    ['Choco Crunch', 5000], ['Choco Crunch Pisang', 7000], ['Choco Crunch Keju', 8000], ['Choco Crunch Pisang Keju', 9000]
  ]},
  { cat: 'Lekker · Green Tea', emoji: '🍵', bom: 'greentea', items: [
    ['Greentea', 7000], ['Greentea Almond', 9000], ['Greentea Keju', 11000]
  ]},
  { cat: 'Lekker · Mixed', emoji: '✨', bom: 'mixed', items: [
    ['Tiramisu', 5000], ['Silverqueen', 8000], ['Silverqueen Keju', 12000], ['Oreo', 5000], ['Skippy', 6000]
  ]},
  { cat: 'Food · Snack', emoji: '🍗', bom: 'food', items: [
    ['Ayam Bali', 25000], ['Ayam Teriyaki', 25000], ['Ayam Saus Padang', 25000], ['Ayam Woku', 25000],
    ['Nasi Goreng Hongkong', 15000], ['Indomie Goreng', 15000], ['Indomie Kuah', 15000], ['Cireng', 18000],
    ['Kentang Goreng', 20000], ['Otak-Otak', 18000], ['Nugget', 20000]
  ]},
  { cat: 'Drinks · Coffee', emoji: '☕', bom: 'coffee', items: [
    ['Kopi Susu JS', 22000], ['Long Black', 20000], ['Classic Latte', 20000], ['Caramelo Latte', 24000],
    ['Hazel Latte', 24000], ['French Latte', 24000], ['Mochacino', 25000], ['Avopresso', 25000],
    ['Black Yuzu', 25000], ['Butterscotch Sea Salt Latte', 26000], ['Coffee Matcha', 25000]
  ]},
  { cat: 'Drinks · Non-Coffee', emoji: '🧋', bom: 'noncoffee', items: [
    ['Classic Chocolate', 20000], ['Hazelnut Cocoa', 22000], ['Matcha Latte', 20000], ['Honey Yuzu', 22000],
    ['Regale Milk', 20000], ['Lychee Tea', 18000], ['Lemon Tea', 17000], ['Yuzu Purple Soda', 25000],
    ['Mango Ocean', 24000], ['Red Lime Blue Soda', 24000]
  ]},
  { cat: 'Drinks · Smoothie', emoji: '🥤', bom: 'smoothie', items: [
    ['Berrie Lover', 25000], ['Summer Breeze', 25000], ['Mango Blast', 25000], ['Banana Treats', 25000]
  ]},
  { cat: 'Drinks · Hot', emoji: '♨️', bom: 'hotdrink', items: [
    ['Kopi Susu JS (Hot)', 20000], ['Latte (Hot)', 20000], ['Cappucino (Hot)', 20000], ['Americano (Hot)', 20000],
    ['Mocha (Hot)', 22000], ['Hot Chocolate', 20000], ['Hazel Cocoa (Hot)', 20000], ['Matcha Latte (Hot)', 20000]
  ]}
];
const boms = {
  chocolate: { inv_tepung: 0.04, inv_coklat: 0.05, inv_gula: 0.01 },
  cheese: { inv_tepung: 0.04, inv_keju: 0.04, inv_gula: 0.01 },
  nutella: { inv_tepung: 0.03, inv_coklat: 0.06, inv_keju: 0.02, inv_gula: 0.01 },
  ovomaltine: { inv_tepung: 0.04, inv_ovomaltine: 0.05, inv_susu: 0.05 },
  berry: { inv_berry: 0.08, inv_pisang: 0.05, inv_susu: 0.05, inv_cup: 1 },
  crunch: { inv_tepung: 0.04, inv_coklat: 0.04, inv_crunch: 0.03 },
  greentea: { inv_greentea: 0.03, inv_susu: 0.08, inv_cup: 1 },
  mixed: { inv_tepung: 0.04, inv_coklat: 0.04, inv_keju: 0.02 },
  food: { inv_ayam: 0.15, inv_bumbu: 0.02, inv_minyak: 0.02 },
  coffee: { inv_kopi: 0.02, inv_susu: 0.12, inv_cup: 1 },
  noncoffee: { inv_sirup: 0.06, inv_susu: 0.1, inv_cup: 1 },
  smoothie: { inv_berry: 0.1, inv_susu: 0.15, inv_cup: 1 },
  hotdrink: { inv_kopi: 0.02, inv_susu: 0.1, inv_cup: 1 }
};
let n = 1;
const menus = [];
for (const s of sections) {
  for (const [name, price] of s.items) {
    menus.push({ id: 'm' + (n++), name, price, category: s.cat, emoji: s.emoji, ing: { ...boms[s.bom] } });
  }
}
const inv = {
  inv_tepung: { id: 'inv_tepung', name: 'Wheat flour mix', stock: 0, par: 5, unit: 'kg', cost: 12000 },
  inv_coklat: { id: 'inv_coklat', name: 'Chocolate compound', stock: 0, par: 4, unit: 'kg', cost: 45000 },
  inv_keju: { id: 'inv_keju', name: 'Cheddar cheese', stock: 0, par: 3, unit: 'kg', cost: 60000 },
  inv_pisang: { id: 'inv_pisang', name: 'Banana', stock: 0, par: 6, unit: 'pcs', cost: 3000 },
  inv_gula: { id: 'inv_gula', name: 'Sugar syrup', stock: 0, par: 4, unit: 'L', cost: 14000 },
  inv_susu: { id: 'inv_susu', name: 'Milk / condensed milk', stock: 0, par: 12, unit: 'can', cost: 11000 },
  inv_cup: { id: 'inv_cup', name: 'Cup & straw', stock: 0, par: 80, unit: 'pcs', cost: 800 },
  inv_kopi: { id: 'inv_kopi', name: 'Coffee beans / powder', stock: 0, par: 3, unit: 'kg', cost: 95000 },
  inv_sirup: { id: 'inv_sirup', name: 'Drink syrup & flavor', stock: 0, par: 6, unit: 'bottle', cost: 35000 },
  inv_berry: { id: 'inv_berry', name: 'Berry & fruit prep', stock: 0, par: 5, unit: 'kg', cost: 28000 },
  inv_ovomaltine: { id: 'inv_ovomaltine', name: 'Ovomaltine powder', stock: 0, par: 2, unit: 'kg', cost: 75000 },
  inv_crunch: { id: 'inv_crunch', name: 'Choco crunch topping', stock: 0, par: 3, unit: 'kg', cost: 42000 },
  inv_greentea: { id: 'inv_greentea', name: 'Green tea powder', stock: 0, par: 2, unit: 'kg', cost: 65000 },
  inv_ayam: { id: 'inv_ayam', name: 'Chicken portion', stock: 0, par: 10, unit: 'pcs', cost: 18000 },
  inv_bumbu: { id: 'inv_bumbu', name: 'Spice & sauce mix', stock: 0, par: 5, unit: 'pack', cost: 8000 },
  inv_minyak: { id: 'inv_minyak', name: 'Cooking oil', stock: 0, par: 4, unit: 'L', cost: 22000 }
};
const out = [
  '/** Lekker Story full menu catalog */',
  'export const LEKKER_DEFAULT_INVENTORY = ' + JSON.stringify(inv, null, 4) + ';',
  'export const LEKKER_DEFAULT_MENUS = ' + JSON.stringify(menus, null, 4) + ';',
  'export const LEKKER_BOM_PRESETS = ' + JSON.stringify(boms, null, 4) + ';',
  ''
].join('\n');
fs.writeFileSync(require('path').join(__dirname, '../assets/js/menu-catalog.js'), out);
console.log('Generated', menus.length, 'menus');
