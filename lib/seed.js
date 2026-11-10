// lib/seed.js - Pre-populates exactly 1,100 official apartments from official terms brochure
const fs = require('node:fs');
const path = require('node:path');

function seedApartments(db) {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM apartments').get();
  if (countRow && countRow.count >= 1100) {
    return;
  }

  const jsonPath = path.join(__dirname, '..', 'data', 'official_units.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('official_units.json not found at:', jsonPath);
    return;
  }

  const raw = fs.readFileSync(jsonPath, 'utf8');
  const units = JSON.parse(raw);

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DELETE FROM preferences; DELETE FROM swap_results; DELETE FROM swap_runs; DELETE FROM users; DELETE FROM apartments;');
  db.exec('PRAGMA foreign_keys = ON;');

  const insert = db.prepare(
    'INSERT INTO apartments (' +
    'code, district, neighborhood, building, unit_number, ' +
    'area, model, floor, floor_label, distinction, ' +
    'meter_price, total_price, national_property_id' +
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let count = 0;
  for (const u of units) {
    insert.run(
      u.code,
      u.district,
      u.neighborhood,
      String(u.building),
      String(u.unit_number),
      Number(u.area),
      String(u.model),
      Number(u.floor),
      String(u.floor_label),
      Number(u.distinction),
      Number(u.meter_price),
      Number(u.total_price),
      String(u.national_property_id)
    );
    count++;
  }

  console.log('Successfully seeded ' + count + ' official brochure units (R3 & R5) into database.');
}

module.exports = { seedApartments };
