// lib/database.js - Multi-Phase Housing Swap Platform with Direct 1-to-1 Marketplace
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { seedApartments } = require('./seed');

const dbPath = path.join(__dirname, '..', 'data', 'housing.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Remove old database to ensure pristine table schema if requested
if (process.env.RESET_DB === '1' && fs.existsSync(dbPath)) {
  try { fs.unlinkSync(dbPath); } catch(e) {}
}

const db = new DatabaseSync(dbPath);

// Enable WAL mode & foreign keys
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS apartments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    district TEXT NOT NULL,
    neighborhood TEXT NOT NULL,
    building TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    area REAL NOT NULL,
    model TEXT NOT NULL,
    floor INTEGER NOT NULL,
    floor_label TEXT NOT NULL,
    distinction REAL DEFAULT 0,
    meter_price REAL NOT NULL,
    total_price REAL NOT NULL,
    national_property_id TEXT UNIQUE NOT NULL,
    original_owner_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    national_id TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    workplace TEXT,
    employee_code TEXT,
    lottery_rank INTEGER,
    random_priority_number INTEGER,
    birth_date TEXT,
    original_apartment_id INTEGER UNIQUE,
    wants_swap INTEGER DEFAULT 1,
    swap_status TEXT DEFAULT 'WANTS_SWAP',
    swap_desired_notes TEXT,
    swap_undesired_notes TEXT,
    confirmation_code TEXT,
    registered_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (original_apartment_id) REFERENCES apartments(id)
  );

  CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    apartment_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (apartment_id) REFERENCES apartments(id),
    UNIQUE(user_id, rank),
    UNIQUE(user_id, apartment_id)
  );

  CREATE TABLE IF NOT EXISTS swap_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_timestamp TEXT NOT NULL,
    priority_rule TEXT NOT NULL,
    total_swapped INTEGER NOT NULL,
    total_participants INTEGER NOT NULL,
    is_published INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS swap_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    original_apartment_id INTEGER NOT NULL,
    assigned_apartment_id INTEGER NOT NULL,
    rank_achieved INTEGER NOT NULL,
    random_priority_number INTEGER,
    swap_type TEXT NOT NULL,
    cycle_id TEXT,
    FOREIGN KEY (run_id) REFERENCES swap_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

    CREATE TABLE IF NOT EXISTS direct_swaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user1_id INTEGER NOT NULL,
    user2_id INTEGER NOT NULL,
    apt1_id INTEGER NOT NULL,
    apt2_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY (user1_id) REFERENCES users(id),
    FOREIGN KEY (user2_id) REFERENCES users(id),
    FOREIGN KEY (apt1_id) REFERENCES apartments(id),
    FOREIGN KEY (apt2_id) REFERENCES apartments(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_nid ON users(national_id);
  CREATE INDEX IF NOT EXISTS idx_prefs_user ON preferences(user_id);
  CREATE INDEX IF NOT EXISTS idx_apts_dist_nh ON apartments(district, neighborhood);
  CREATE INDEX IF NOT EXISTS idx_apts_bldg ON apartments(building);
  CREATE INDEX IF NOT EXISTS idx_apts_nat_id ON apartments(national_property_id);
`);

// Add columns if table existed prior
try { db.exec("ALTER TABLE users ADD COLUMN workplace TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN swap_status TEXT DEFAULT 'WANTS_SWAP';"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN direct_partner_user_id INTEGER;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN direct_swap_notes TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN direct_partner_nid TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN swap_desired_notes TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN swap_undesired_notes TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE preferences ADD COLUMN national_property_id TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE swap_results ADD COLUMN orig_national_property_id TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE swap_results ADD COLUMN assign_national_property_id TEXT;"); } catch(e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_prefs_nat_id ON preferences(national_property_id);"); } catch(e) {}
try {
  db.exec(`
    UPDATE preferences 
    SET national_property_id = (SELECT national_property_id FROM apartments WHERE apartments.id = preferences.apartment_id)
    WHERE national_property_id IS NULL;
    UPDATE swap_results
    SET orig_national_property_id = (SELECT national_property_id FROM apartments WHERE apartments.id = swap_results.original_apartment_id)
    WHERE orig_national_property_id IS NULL;
    UPDATE swap_results
    SET assign_national_property_id = (SELECT national_property_id FROM apartments WHERE apartments.id = swap_results.assigned_apartment_id)
    WHERE assign_national_property_id IS NULL;
  `);
} catch(e) {}


// Initialize settings with PHASE_1_DIRECT as default
db.exec(`
  INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('status', 'REGISTRATION_OPEN'),
  ('system_phase', 'PHASE_1_DIRECT'),
  ('priority_rule', 'random_draw'),
  ('allow_cycles', 'true'),
  ('max_preferences', '20'),
  ('min_preferences', '3'),
  ('total_units', '1100'),
  ('total_candidates', '900'),
  ('admin_pin', 'Capital@Housing#2026!Adm')
`);

// Seed 1,100 official apartments
seedApartments(db);

const dbOps = {
  db,

  removeApartmentFromPreferences(aptId) {
    if (!aptId) return;
    const targetAptId = Number(aptId);

    const affectedUsers = db.prepare(`
      SELECT DISTINCT user_id FROM preferences WHERE apartment_id = ?
    `).all(targetAptId);

    if (affectedUsers.length === 0) return;

    db.prepare('DELETE FROM preferences WHERE apartment_id = ?').run(targetAptId);

    const getRemaining = db.prepare('SELECT id FROM preferences WHERE user_id = ? ORDER BY rank ASC');
    const updateRank = db.prepare('UPDATE preferences SET rank = ? WHERE id = ?');

    const reindexTx = db.transaction((users) => {
      for (const u of users) {
        const remaining = getRemaining.all(u.user_id);
        remaining.forEach((p, idx) => {
          updateRank.run(idx + 1, p.id);
        });
      }
    });

    reindexTx(affectedUsers);
  },

  cleanAllUnavailablePreferences() {
    const invalidPrefs = db.prepare(`
      SELECT p.id, p.user_id
      FROM preferences p
      LEFT JOIN apartments a ON p.apartment_id = a.id
      LEFT JOIN users u ON a.original_owner_id = u.id
      WHERE u.id IS NULL OR u.swap_status != 'WANTS_SWAP' OR u.original_apartment_id != a.id
    `).all();

    if (invalidPrefs.length === 0) return 0;

    const affectedUserIds = [...new Set(invalidPrefs.map(p => p.user_id))];

    db.prepare(`
      DELETE FROM preferences WHERE id IN (${invalidPrefs.map(p => p.id).join(',')})
    `).run();

    const getRemaining = db.prepare('SELECT id FROM preferences WHERE user_id = ? ORDER BY rank ASC');
    const updateRank = db.prepare('UPDATE preferences SET rank = ? WHERE id = ?');

    const tx = db.transaction((userIds) => {
      for (const uid of userIds) {
        const remaining = getRemaining.all(uid);
        remaining.forEach((p, idx) => {
          updateRank.run(idx + 1, p.id);
        });
      }
    });

    tx(affectedUserIds);
    return invalidPrefs.length;
  },

  getAllApartments() {
    return db.prepare(`
      SELECT a.*, 
             u.full_name as owner_name, 
             u.national_id as owner_nid,
             u.phone as owner_phone,
             u.workplace as owner_workplace,
             u.wants_swap as owner_wants_swap,
             u.swap_desired_notes as owner_desired_notes,
             u.swap_undesired_notes as owner_undesired_notes,
             COALESCE(u.swap_status, CASE WHEN u.wants_swap = 1 THEN 'WANTS_SWAP' ELSE 'KEPT_ORIGINAL' END) as owner_swap_status,
             (SELECT COUNT(*) FROM preferences WHERE apartment_id = a.id) as demand_count
      FROM apartments a
      LEFT JOIN users u ON a.original_owner_id = u.id
      ORDER BY a.id ASC
    `).all();
  },

  getApartmentById(id) {
    return db.prepare('SELECT * FROM apartments WHERE id = ?').get(id);
  },

  getApartmentByNationalPropertyId(natId) {
    return db.prepare('SELECT * FROM apartments WHERE national_property_id = ?').get(natId);
  },

  getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  },

  getUserByNationalId(nid) {
    const user = db.prepare(`
      SELECT u.*, 
             a.code as apt_code, a.district as apt_district, a.neighborhood as apt_neighborhood,
             a.building as apt_building, a.floor as apt_floor, a.floor_label as apt_floor_label,
             a.unit_number as apt_unit, a.area as apt_area, a.model as apt_model,
             a.distinction as apt_distinction, a.meter_price as apt_meter_price,
             a.total_price as apt_total_price, a.national_property_id as apt_national_id
      FROM users u
      LEFT JOIN apartments a ON u.original_apartment_id = a.id
      WHERE u.national_id = ?
    `).get(nid);

    if (!user) return null;

    const prefs = db.prepare(`
      SELECT p.rank, a.*
      FROM preferences p
      JOIN apartments a ON p.apartment_id = a.id
      WHERE p.user_id = ?
      ORDER BY p.rank ASC
    `).all(user.id);

    let partnerInfo = null;
    let isDirectSwapLocked = false;

    if (user.direct_partner_user_id) {
      partnerInfo = db.prepare(`
        SELECT u.id, u.full_name, u.national_id, u.phone, u.workplace,
               a.district as apt_district, a.neighborhood as apt_neighborhood, a.building as apt_building, a.unit_number as apt_unit, a.floor_label as apt_floor_label, a.national_property_id as apt_national_id
        FROM users u
        LEFT JOIN apartments a ON u.original_apartment_id = a.id
        WHERE u.id = ?
      `).get(user.direct_partner_user_id) || null;
    }

    const activeSwapRecord = db.prepare("SELECT * FROM direct_swaps WHERE user1_id = ? OR user2_id = ?").get(user.id, user.id);
    if (activeSwapRecord && user.swap_status === 'AGREED_DIRECT') {
      isDirectSwapLocked = true;
    }

    return { 
      ...user, 
      partner: partnerInfo,
      isDirectSwapLocked,
      activeDirectSwapId: activeSwapRecord ? activeSwapRecord.id : null,
      preferences: prefs 
    };
  },

  getAllUsers() {
    return db.prepare(`
      SELECT u.*, 
             a.code as apt_code, a.district as apt_district, a.neighborhood as apt_neighborhood,
             a.building as apt_building, a.floor as apt_floor, a.floor_label as apt_floor_label,
             a.unit_number as apt_unit, a.area as apt_area, a.model as apt_model,
             a.distinction as apt_distinction, a.meter_price as apt_meter_price,
             a.national_property_id as apt_national_id,
             (SELECT COUNT(*) FROM preferences WHERE user_id = u.id) as preferences_count
      FROM users u
      LEFT JOIN apartments a ON u.original_apartment_id = a.id
      ORDER BY u.id DESC
    `).all();
  },

  extractBirthDateFromNID(nid) {
    if (!nid || nid.length !== 14) return null;
    const century = nid[0] === '2' ? '19' : (nid[0] === '3' ? '20' : null);
    if (!century) return null;
    const year = century + nid.substring(1, 3);
    const month = nid.substring(3, 5);
    const day = nid.substring(5, 7);
    return `${year}-${month}-${day}`;
  },

  saveUserRegistration(data) {
    const {
      fullName,
      nationalId,
      phone,
      workplace,
      employeeCode,
      lotteryRank,
      originalApartmentId,
      wantsSwap,
      swapStatus,
      preferences
    } = data;

    const swapDesiredNotes = data.swapDesiredNotes ? String(data.swapDesiredNotes).trim() : null;
    const swapUndesiredNotes = data.swapUndesiredNotes ? String(data.swapUndesiredNotes).trim() : null;
    const birthDate = this.extractBirthDateFromNID(nationalId);
    const now = new Date().toISOString();
    const confCode = 'SWAP-' + Math.floor(100000 + Math.random() * 900000);
    const randomDrawNumber = data.randomPriorityNumber || Math.floor(100000 + Math.random() * 900000);

    // Standardize swap status:
    // 'WANTS_SWAP' = أرغب في التبديل والتواصل المباشر
    // 'KEPT_ORIGINAL' = محتفظ بالشقة الأصلية
    // 'AGREED_DIRECT' = تم التوفيق الودي ولا أرغب في دخول القرعة التبادلية
    let finalStatus = swapStatus || (wantsSwap ? 'WANTS_SWAP' : 'KEPT_ORIGINAL');
    const isWantsSwapNumeric = finalStatus === 'WANTS_SWAP' ? 1 : 0;

    const existing = db.prepare('SELECT id, random_priority_number, original_apartment_id FROM users WHERE national_id = ?').get(nationalId);
    const currentUserId = existing ? existing.id : -1;
    // Strict validation: Once a direct swap is confirmed and active in direct_swaps,
    // the users CANNOT unilaterally revoke it or change their status or apartment.
    // Revocation can ONLY be done by Admin from the control panel.
    if (existing) {
      const activeSwap = db.prepare(`
        SELECT ds.*, 
               u1.id as u1_id, u1.full_name as u1_name, u1.national_id as u1_nid,
               u2.id as u2_id, u2.full_name as u2_name, u2.national_id as u2_nid
        FROM direct_swaps ds
        JOIN users u1 ON ds.user1_id = u1.id
        JOIN users u2 ON ds.user2_id = u2.id
        WHERE ds.user1_id = ? OR ds.user2_id = ?
      `).get(existing.id, existing.id);

      if (activeSwap) {
        const partnerName = activeSwap.user1_id === existing.id ? activeSwap.u2_name : activeSwap.u1_name;

        // Block changing swap status
        if (finalStatus !== "AGREED_DIRECT") {
          throw new Error(`عذراً، تم اعتماد وتفعيل التبادل الثنائي المباشر رسمياً بينك وبين الزميل: (${partnerName}). وفقاً لضوابط المنظومة، لا يمكن الرجوع عن التوافق أو تعديل الحالة إلا عبر تقديم طلب للجنة التبديل وإلغاء الاعتماد من لوحة إدارة المنصة أولاً.`);
        }

        // Block changing registered apartment
        if (originalApartmentId && Number(originalApartmentId) !== Number(existing.original_apartment_id)) {
          throw new Error(`عذراً، شقتك الأصلية مرتبطة باتفاق تبادل معتمد رسمياً مع الزميل: (${partnerName}). لا يمكن تغيير الشقة المسجلة إلا بعد إلغاء التوافق من قبل إدارة المنصة ولجنة التبديل.`);
        }

        finalStatus = "AGREED_DIRECT";
      }
    }

    // Strict validation: Prevent registering an apartment already claimed by another user
    if (originalApartmentId) {
      const alreadyClaimed = db.prepare(`
        SELECT u.id, u.full_name, u.workplace, a.unit_number, a.building, a.district, a.neighborhood
        FROM apartments a
        JOIN users u ON a.original_owner_id = u.id
        WHERE a.id = ? AND u.id != ?
      `).get(Number(originalApartmentId), currentUserId);

      if (alreadyClaimed) {
        throw new Error(`عذراً، هذه الشقة (مجاورة ${alreadyClaimed.neighborhood} - مبنى ${alreadyClaimed.building} - وحدة ${alreadyClaimed.unit_number}) مسجلة بالفعل بالمنصة باسم الزميل: ${alreadyClaimed.full_name} (${alreadyClaimed.workplace || 'جهة العمل غير محددة'}). لا يمكن تسجيل نفس الشقة لأكثر من موظف.`);
      }
    }

    let userId;
    let userRandomNum = randomDrawNumber;

    if (existing) {
      userId = existing.id;
      userRandomNum = existing.random_priority_number || randomDrawNumber;
      
      // Clear previous apartment owner if user changed their apartment
      if (existing.original_apartment_id && Number(existing.original_apartment_id) !== Number(originalApartmentId)) {
        db.prepare('UPDATE apartments SET original_owner_id = NULL WHERE id = ?').run(existing.original_apartment_id);
        this.removeApartmentFromPreferences(existing.original_apartment_id);
      }

      db.prepare(`
        UPDATE users SET 
          full_name = ?, phone = ?, workplace = ?, employee_code = ?, lottery_rank = ?, 
          random_priority_number = ?, birth_date = ?, original_apartment_id = ?, 
          wants_swap = ?, swap_status = ?, swap_desired_notes = ?, swap_undesired_notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        fullName, phone, workplace || '', employeeCode || '', lotteryRank ? Number(lotteryRank) : null,
        userRandomNum, birthDate, originalApartmentId ? Number(originalApartmentId) : null,
        isWantsSwapNumeric, finalStatus, swapDesiredNotes, swapUndesiredNotes, now, userId
      );
    } else {
      const res = db.prepare(`
        INSERT INTO users (
          full_name, national_id, phone, workplace, employee_code, lottery_rank,
          random_priority_number, birth_date, original_apartment_id, wants_swap, swap_status,
          swap_desired_notes, swap_undesired_notes,
          confirmation_code, registered_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fullName, nationalId, phone, workplace || '', employeeCode || '', lotteryRank ? Number(lotteryRank) : null,
        userRandomNum, birthDate, originalApartmentId ? Number(originalApartmentId) : null,
        isWantsSwapNumeric, finalStatus, swapDesiredNotes, swapUndesiredNotes, confCode, now, now
      );
      userId = Number(res.lastInsertRowid);
    }

    if (originalApartmentId) {
      db.prepare('UPDATE apartments SET original_owner_id = ? WHERE id = ?')
        .run(userId, Number(originalApartmentId));
    }

    // Save direct partner details
    const directPartnerNid = data.directPartnerNid ? String(data.directPartnerNid).trim() : null;
    const directSwapNotes = data.directSwapNotes ? String(data.directSwapNotes).trim() : null;
    db.prepare('UPDATE users SET direct_partner_nid = ?, direct_swap_notes = ? WHERE id = ?')
      .run(directPartnerNid, directSwapNotes, userId);

    // Mutual Handshake Check for AGREED_DIRECT
    if (finalStatus === 'AGREED_DIRECT' && directPartnerNid) {
      let partner = db.prepare("SELECT * FROM users WHERE (national_id = ? OR phone = ?) AND id != ?")
        .get(directPartnerNid, directPartnerNid, userId);

      if (!partner) {
        const partnerApt = db.prepare("SELECT original_owner_id FROM apartments WHERE (national_property_id = ? OR code = ?) AND original_owner_id IS NOT NULL AND original_owner_id != ?")
          .get(directPartnerNid, directPartnerNid, userId);
        if (partnerApt && partnerApt.original_owner_id) {
          partner = db.prepare("SELECT * FROM users WHERE id = ?").get(partnerApt.original_owner_id);
        }
      }

      if (partner && partner.original_apartment_id && Number(partner.original_apartment_id) !== Number(originalApartmentId)) {
        const userApt = originalApartmentId ? db.prepare("SELECT national_property_id, code FROM apartments WHERE id = ?").get(originalApartmentId) : null;
        const partnerClaim = String(partner.direct_partner_nid || '').trim();
        const isMutual = partner.swap_status === 'AGREED_DIRECT' && (
          partnerClaim === nationalId ||
          partnerClaim === phone ||
          (userApt && (partnerClaim === userApt.national_property_id || partnerClaim === userApt.code)) ||
          partner.direct_partner_user_id === userId
        );

        if (isMutual) {
          this.confirmDirectSwap(userId, partner.id, "اعتماد آلي: توافق ثنائي متبادل عبر المنصة");
        }
      }
    }

    // Save preferences only if active and present
    if (isWantsSwapNumeric === 0) {
      db.prepare('DELETE FROM preferences WHERE user_id = ?').run(userId);
      if (originalApartmentId) {
        this.removeApartmentFromPreferences(originalApartmentId);
      }
    } else if (Array.isArray(preferences) && preferences.length > 0) {
      db.prepare('DELETE FROM preferences WHERE user_id = ?').run(userId);
      const insertPref = db.prepare(`
        INSERT INTO preferences (user_id, apartment_id, national_property_id, rank)
        VALUES (?, ?, ?, ?)
      `);

      const checkAptStmt = db.prepare(`
        SELECT a.id, a.national_property_id
        FROM apartments a
        JOIN users u ON a.original_owner_id = u.id
        WHERE a.id = ? AND u.swap_status = 'WANTS_SWAP' AND u.id != ?
      `);

      let currentRank = 1;
      preferences.slice(0, 20).forEach((aptId) => {
        if (Number(aptId) !== Number(originalApartmentId)) {
          const validApt = checkAptStmt.get(Number(aptId), userId);
          if (validApt) {
            insertPref.run(userId, validApt.id, validApt.national_property_id, currentRank++);
          }
        }
      });
    }

    return this.getUserByNationalId(nationalId);
  },

  getStats() {
    const totalApts = db.prepare('SELECT COUNT(*) as c FROM apartments').get().c;
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const wantingSwap = db.prepare("SELECT COUNT(*) as c FROM users WHERE swap_status = 'WANTS_SWAP'").get().c;
    const keepingApt = db.prepare("SELECT COUNT(*) as c FROM users WHERE swap_status = 'KEPT_ORIGINAL'").get().c;
    const agreedDirect = db.prepare("SELECT COUNT(*) as c FROM users WHERE swap_status = 'AGREED_DIRECT'").get().c;
    const withPrefs = db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM preferences').get().c;
    const totalSwappableApts = db.prepare("SELECT COUNT(*) as c FROM apartments a JOIN users u ON a.original_owner_id = u.id WHERE u.swap_status = 'WANTS_SWAP'").get().c;
    const systemPhase = this.getSetting('system_phase', 'PHASE_1_DIRECT');

    const mostWanted = db.prepare(`
      SELECT a.id, a.code, a.district, a.neighborhood, a.building, a.floor, a.floor_label,
             a.unit_number, a.model, a.area, a.meter_price, a.national_property_id,
             COUNT(p.id) as request_count,
             SUM(CASE WHEN p.rank = 1 THEN 1 ELSE 0 END) as rank1_count
      FROM apartments a
      JOIN preferences p ON a.id = p.apartment_id
      GROUP BY a.id
      ORDER BY request_count DESC, rank1_count DESC
      LIMIT 10
    `).all();

    const latestRun = db.prepare(`
      SELECT * FROM swap_runs ORDER BY id DESC LIMIT 1
    `).get();

    return {
      totalApts,
      totalUsers,
      wantingSwap,
      keepingApt,
      agreedDirect,
      withPrefs,
      totalSwappableApts,
      systemPhase,
      mostWanted,
      latestRun: latestRun || null
    };
  },

  getSetting(key, def = '') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : def;
  },

  setSetting(key, value) {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  },

  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  },

  resetAllData() {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM preferences;
      DELETE FROM swap_results;
      DELETE FROM swap_runs;
      DELETE FROM direct_swaps;
      UPDATE apartments SET original_owner_id = NULL;
      DELETE FROM users;
      PRAGMA foreign_keys = ON;
    `);
    return { success: true, message: "تم إعادة ضبط وحذف جميع بيانات المشاركين والتوافقات والرغبات بنجاح" };
  },

  generateSampleParticipants(count = 900) {
    this.resetAllData();

    const apts = db.prepare('SELECT id FROM apartments ORDER BY id ASC').all();
    const firstNames = ['محمد', 'أحمد', 'محمود', 'علي', 'إبراهيم', 'طارق', 'خالد', 'ياسر', 'سامح', 'شريف', 'عمرو', 'هاني', 'وائل', 'حسام', 'كريم', 'عصام', 'أشرف', 'مدحت', 'وليد', 'ماجد'];
    const secondNames = ['عبد الرحمن', 'عبد العزيز', 'سعيد', 'صلاح', 'نبيل', 'كمال', 'فهمي', 'فاروق', 'عادل', 'عاطف', 'حسن', 'مصطفى', 'إسماعيل', 'فؤاد', 'جمال', 'صبري', 'عزت', 'توفيق'];
    const familyNames = ['السيد', 'خليل', 'عثمان', 'الشناوي', 'زكي', 'القاضي', 'عبد الفتاح', 'مراد', 'سالم', 'راغب', 'بدوي', 'نور', 'الجيار', 'عبد الله', 'منصور', 'المهدي', 'الشريف', 'حجازي'];

    const ministries = [
      "وزارة الإسكان والمرافق والمجتمعات العمرانية",
      "وزارة المالية",
      "وزارة التربية والتعليم والتعليم الفني",
      "وزارة الصحة والسكان",
      "وزارة النقل",
      "رئاسة مجلس الوزراء",
      "وزارة الخارجية",
      "وزارة الكهرباء والطاقة المتجددة",
      "وزارة الاتصالات وتكنولوجيا المعلومات",
      "وزارة البترول والثروة المعدنية",
      "وزارة التضامن الاجتماعي",
      "وزارة العدل",
      "وزارة التنمية المحلية",
      "وزارة التخطيط والتنمية الاقتصادية",
      "وزارة الشباب والرياضة",
      "وزارة الموارد المائية والري"
    ];

    const targetCount = Math.min(count, 900);
    const availableApts = [...apts].sort(() => 0.5 - Math.random());

    db.exec("BEGIN TRANSACTION;");
    try {
      for (let i = 0; i < targetCount; i++) {
        const myAptId = availableApts[i].id;
        const fn = firstNames[i % firstNames.length];
        const sn = secondNames[(i * 3) % secondNames.length];
        const ln = familyNames[(i * 7) % familyNames.length];
        const fullName = `${fn} ${sn} ${ln}`;
        const workplace = ministries[(i * 2 + 3) % ministries.length];

        const birthYear = 1970 + Math.floor(Math.random() * 28);
        const birthMonth = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
        const birthDay = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
        const randDigits = String(1000 + Math.floor(Math.random() * 9000));
        const nid = `2${String(birthYear).substring(2)}${birthMonth}${birthDay}010${randDigits}`;
        const phone = `010${Math.floor(10000000 + Math.random() * 90000000)}`;
        const lotteryRank = i + 1;
        const randomPriority = Math.floor(100000 + Math.random() * 900000);

        // Status distribution: ~72% want swap, ~14% agreed direct 1-to-1, ~14% kept original
        const randVal = Math.random();
        let status = 'WANTS_SWAP';
        if (randVal > 0.86) {
          status = 'AGREED_DIRECT';
        } else if (randVal > 0.72) {
          status = 'KEPT_ORIGINAL';
        }

        let chosenPrefs = [];
        if (status === 'WANTS_SWAP') {
          const prefCount = 10 + Math.floor(Math.random() * 11);
          const candidates = apts
            .filter(a => a.id !== myAptId)
            .sort(() => 0.5 - Math.random())
            .slice(0, prefCount)
            .map(a => a.id);
          chosenPrefs = candidates;
        }

        this.saveUserRegistration({
          fullName: fullName,
          nationalId: nid,
          phone: phone,
          workplace: workplace,
          employeeCode: `EMP-${1000 + i}`,
          lotteryRank: lotteryRank,
          randomPriorityNumber: randomPriority,
          originalApartmentId: myAptId,
          wantsSwap: status === 'WANTS_SWAP' ? 1 : 0,
          swapStatus: status,
          preferences: chosenPrefs
        });
      }

      // Automatically pair up all AGREED_DIRECT users into verified 1-to-1 direct swaps
      const agreedList = db.prepare(`
        SELECT id, original_apartment_id, full_name, national_id, phone, workplace 
        FROM users 
        WHERE swap_status = 'AGREED_DIRECT' 
        ORDER BY id ASC
      `).all();

      const pairCount = Math.floor(agreedList.length / 2);
      const now = new Date().toISOString();

      const insertDirectSwap = db.prepare(`
        INSERT INTO direct_swaps (user1_id, user2_id, apt1_id, apt2_id, created_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const linkUserPartner = db.prepare(`
        UPDATE users 
        SET direct_partner_user_id = ?, direct_swap_notes = ?, wants_swap = 0 
        WHERE id = ?
      `);

      for (let p = 0; p < pairCount; p++) {
        const u1 = agreedList[p * 2];
        const u2 = agreedList[p * 2 + 1];

        linkUserPartner.run(u2.id, `توافق ثنائي مباشر معتمد (كود: DSWAP-${1000 + p + 1})`, u1.id);
        linkUserPartner.run(u1.id, `توافق ثنائي مباشر معتمد (كود: DSWAP-${1000 + p + 1})`, u2.id);

        insertDirectSwap.run(
          u1.id,
          u2.id,
          u1.original_apartment_id,
          u2.original_apartment_id,
          now,
          `توافق ثنائي مباشر معتمد بين الزميلين (${u1.full_name}) و (${u2.full_name})`
        );
      }

      // If odd number, set leftover to KEPT_ORIGINAL
      if (agreedList.length % 2 !== 0) {
        const leftover = agreedList[agreedList.length - 1];
        db.prepare(`UPDATE users SET swap_status = 'KEPT_ORIGINAL', wants_swap = 0 WHERE id = ?`).run(leftover.id);
      }

      db.exec("COMMIT;");
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }

    return { 
      count: targetCount, 
      message: `تم حصر وتوليد ${targetCount} موظفاً بنجاح مع جهات عملهم وشققهم الفائزة ورغباتهم من كراسة الشروط الرسمية (1,100 وحدة)` 
    };
  },

  findUserOrApartment(query) {
    if (!query) return null;
    const q = String(query).trim();
    const qUpper = q.toUpperCase();

    // 1. Search by apartment national_property_id or code
    const apt = db.prepare(`
      SELECT a.*, 
             u.id as user_id, u.full_name, u.national_id, u.phone, u.workplace, 
             u.swap_status, u.wants_swap, u.random_priority_number
      FROM apartments a
      LEFT JOIN users u ON a.original_owner_id = u.id
      WHERE UPPER(a.national_property_id) = ? OR UPPER(a.code) = ?
    `).get(qUpper, qUpper);

    if (apt) {
      return {
        type: 'apartment',
        apartment: {
          id: apt.id,
          code: apt.code,
          district: apt.district,
          neighborhood: apt.neighborhood,
          building: apt.building,
          unit_number: apt.unit_number,
          floor_label: apt.floor_label,
          model: apt.model,
          area: apt.area,
          meter_price: apt.meter_price,
          total_price: apt.total_price,
          national_property_id: apt.national_property_id
        },
        user: apt.user_id ? {
          id: apt.user_id,
          full_name: apt.full_name,
          national_id: apt.national_id,
          phone: apt.phone,
          workplace: apt.workplace,
          swap_status: apt.swap_status,
          wants_swap: apt.wants_swap,
          random_priority_number: apt.random_priority_number
        } : null
      };
    }

    // 2. Search by user national_id, phone, or name
    const user = db.prepare(`
      SELECT u.*, 
             a.id as apt_id, a.code as apt_code, a.district as apt_district, a.neighborhood as apt_neighborhood,
             a.building as apt_building, a.floor as apt_floor, a.floor_label as apt_floor_label,
             a.unit_number as apt_unit, a.area as apt_area, a.model as apt_model,
             a.meter_price as apt_meter_price, a.total_price as apt_total_price,
             a.national_property_id as apt_national_id
      FROM users u
      LEFT JOIN apartments a ON u.original_apartment_id = a.id
      WHERE u.id = ? OR u.national_id = ? OR u.phone = ? OR u.full_name = ?
    `).get(q, q, q, q);

    if (user) {
      return {
        type: 'user',
        user: {
          id: user.id,
          full_name: user.full_name,
          national_id: user.national_id,
          phone: user.phone,
          workplace: user.workplace,
          swap_status: user.swap_status,
          wants_swap: user.wants_swap,
          random_priority_number: user.random_priority_number
        },
        apartment: user.original_apartment_id ? {
          id: user.original_apartment_id,
          code: user.apt_code,
          district: user.apt_district,
          neighborhood: user.apt_neighborhood,
          building: user.apt_building,
          unit_number: user.apt_unit,
          floor_label: user.apt_floor_label,
          model: user.apt_model,
          area: user.apt_area,
          meter_price: user.apt_meter_price,
          total_price: user.apt_total_price,
          national_property_id: user.apt_national_id
        } : null
      };
    }

    return null;
  },

  confirmDirectSwap(q1, q2, notes = '') {
    const res1 = this.findUserOrApartment(q1);
    const res2 = this.findUserOrApartment(q2);

    if (!res1 || !res1.user || !res1.apartment) {
      throw new Error("تعذر العثور على بيانات الطرف الأول أو شقته المسجلة");
    }
    if (!res2 || !res2.user || !res2.apartment) {
      throw new Error("تعذر العثور على بيانات الطرف الثاني أو شقته المسجلة");
    }
    if (res1.user.id === res2.user.id) {
      throw new Error("لا يمكن إجراء تبادل لنفس الموظف مع نفسه!");
    }
    if (res1.apartment.id === res2.apartment.id) {
      throw new Error("الشقتان متطابقتان، لا يمكن التبادل!");
    }

    const now = new Date().toISOString();

    // Mark both users as AGREED_DIRECT, wants_swap = 0, and clear preferences
    db.prepare(`
      UPDATE users SET 
        swap_status = 'AGREED_DIRECT',
        wants_swap = 0,
        direct_partner_user_id = ?,
        direct_swap_notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(res2.user.id, notes || 'تم التوافق الودي المباشر معتمد من الإدارة', now, res1.user.id);

    db.prepare(`
      UPDATE users SET 
        swap_status = 'AGREED_DIRECT',
        wants_swap = 0,
        direct_partner_user_id = ?,
        direct_swap_notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(res1.user.id, notes || 'تم التوافق الودي المباشر معتمد من الإدارة', now, res2.user.id);

    // Delete any preferences so they are 100% excluded from one-to-many / TTC
    db.prepare("DELETE FROM preferences WHERE user_id IN (?, ?)").run(res1.user.id, res2.user.id);
    this.removeApartmentFromPreferences(res1.apartment.id);
    this.removeApartmentFromPreferences(res2.apartment.id);

    // Insert into direct_swaps history table
    db.prepare(`
      INSERT INTO direct_swaps (user1_id, user2_id, apt1_id, apt2_id, created_at, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(res1.user.id, res2.user.id, res1.apartment.id, res2.apartment.id, now, notes || '');

    return {
      success: true,
      party1: this.getUserByNationalId(res1.user.national_id),
      party2: this.getUserByNationalId(res2.user.national_id),
      message: `تم بنجاح اعتماد التوافق الودي بين (${res1.user.full_name}) و (${res2.user.full_name}) وإغلاق الشقتين تماماً من أي قرعة تبادلية!`
    };
  },

  getPendingDirectSwaps() {
    return db.prepare(`
      SELECT u.id, u.full_name, u.national_id, u.phone, u.workplace, 
             u.swap_status, u.direct_partner_nid, u.direct_swap_notes, u.direct_partner_user_id,
             u.registered_at, u.updated_at,
             a.id as apt_id, a.code as apt_code, a.district as apt_district, 
             a.neighborhood as apt_neighborhood, a.building as apt_building, 
             a.unit_number as apt_unit, a.floor_label as apt_floor_label,
             a.national_property_id as apt_nat_id, a.area as apt_area, a.model as apt_model
      FROM users u
      LEFT JOIN apartments a ON u.original_apartment_id = a.id
      WHERE u.swap_status = 'AGREED_DIRECT' AND (u.direct_partner_user_id IS NULL OR u.direct_partner_user_id = '')
      ORDER BY u.id DESC
    `).all();
  },

  getDirectSwaps() {
    return db.prepare(`
      SELECT ds.*,
             u1.full_name as user1_name, u1.national_id as user1_nid, u1.phone as user1_phone, u1.workplace as user1_workplace,
             a1.district as a1_district, a1.neighborhood as a1_nh, a1.building as a1_bld, a1.unit_number as a1_unit, a1.floor_label as a1_floor, a1.area as a1_area, a1.national_property_id as a1_nat_id,
             u2.full_name as user2_name, u2.national_id as user2_nid, u2.phone as user2_phone, u2.workplace as user2_workplace,
             a2.district as a2_district, a2.neighborhood as a2_nh, a2.building as a2_bld, a2.unit_number as a2_unit, a2.floor_label as a2_floor, a2.area as a2_area, a2.national_property_id as a2_nat_id
      FROM direct_swaps ds
      JOIN users u1 ON ds.user1_id = u1.id
      JOIN users u2 ON ds.user2_id = u2.id
      JOIN apartments a1 ON ds.apt1_id = a1.id
      JOIN apartments a2 ON ds.apt2_id = a2.id
      ORDER BY ds.id DESC
    `).all();
  },

  cancelDirectSwap(swapId) {
    const swap = db.prepare("SELECT * FROM direct_swaps WHERE id = ?").get(swapId);
    if (!swap) throw new Error("لم يتم العثور على سجل التوافق الودي المطلوب");

    db.prepare(`
      UPDATE users SET 
        swap_status = 'WANTS_SWAP',
        wants_swap = 1,
        direct_partner_user_id = NULL,
        direct_swap_notes = NULL
      WHERE id IN (?, ?)
    `).run(swap.user1_id, swap.user2_id);

    db.prepare("DELETE FROM direct_swaps WHERE id = ?").run(swapId);
    return { success: true, message: "تم إلغاء التوافق الودي وإعادة فتح الشقتين للتبادل بنجاح" };
  },

  updateSingleUserStatus(query, newStatus) {
    const res = this.findUserOrApartment(query);
    if (!res || !res.user) {
      throw new Error("لم يتم العثور على الموظف أو الشقة المحددة");
    }

    const activeSwap = db.prepare("SELECT * FROM direct_swaps WHERE user1_id = ? OR user2_id = ?").get(res.user.id, res.user.id);
    if (activeSwap && newStatus !== 'AGREED_DIRECT') {
      throw new Error(`عذراً، هذا الموظف مرتبط باتفاق تبادل ثنائي معتمد برقم #${activeSwap.id}. يرجى التوجه لجدول "التبادلات الثنائية المباشرة المعتمدة" بالأعلى والضغط على زر (إلغاء التوافق) أولاً لفك الارتباط بين الزميلين رسمياً.`);
    }

    const wantsSwapNum = newStatus === 'WANTS_SWAP' ? 1 : 0;
    db.prepare(`
      UPDATE users SET 
        swap_status = ?,
        wants_swap = ?,
        updated_at = ?
      WHERE id = ?
    `).run(newStatus, wantsSwapNum, new Date().toISOString(), res.user.id);

    if (newStatus !== 'WANTS_SWAP') {
      db.prepare("DELETE FROM preferences WHERE user_id = ?").run(res.user.id);
      if (res.user.original_apartment_id) {
        this.removeApartmentFromPreferences(res.user.original_apartment_id);
      }
    }

    const labels = {
      'AGREED_DIRECT': 'تم التوافق الودي ولا أرغب في التبديل',
      'WANTS_SWAP': 'أرغب في التبديل وإتاحة شقتي للتواصل المباشر',
      'KEPT_ORIGINAL': 'محتفظ بالشقة الأصلية (لا أرغب في التبديل)'
    };

    return {
      success: true,
      user: this.getUserByNationalId(res.user.national_id),
      message: `تم تحديث حالة الموظف (${res.user.full_name}) إلى: "${labels[newStatus] || newStatus}" بنجاح!`
    };
  },

};

module.exports = dbOps;
