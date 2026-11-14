// server.js - Production-ready Fullstack Server strictly adhering to Official Terms Brochure
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");
const db = require("./lib/database");
const HousingMatchingEngine = require("./lib/matching");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    return res.end();
  }

  try {
    // 1. Get all apartments with demand count and owner info
    if (pathname === "/api/apartments" && method === "GET") {
      const apts = db.getAllApartments();
      return sendJson(res, 200, { success: true, apartments: apts });
    }

    // 2. Global stats
    if (pathname === "/api/stats" && method === "GET") {
      const stats = db.getStats();
      const settings = db.getAllSettings();
      delete settings.admin_pin; // Protect admin PIN from public API
      return sendJson(res, 200, { success: true, stats, settings });
    }

    // 3. User registration
    if (pathname === "/api/register" && method === "POST") {
      const currentPhase = db.getSetting("system_phase", "PHASE_1_DIRECT");
      if (currentPhase === "PHASE_3_RESULTS") {
        return sendJson(res, 403, { 
          success: false, 
          message: "عذراً، تم إغلاق باب التسجيل وتعديل الرغبات رسمياً لاعتماد وإعلان النتائج النهائية. يرجى التوجه لصفحة استعلام النتيجة." 
        });
      }
      const body = await parseBody(req);

      if (!body.fullName || !body.nationalId || !body.phone) {
        return sendJson(res, 400, { success: false, message: "يرجى استكمال البيانات الإلزامية (الاسم، الرقم القومي، رقم المحمول)" });
      }

      if (body.nationalId.length !== 14 || !/^\d+$/.test(body.nationalId)) {
        return sendJson(res, 400, { success: false, message: "الرقم القومي يجب أن يتكون من 14 رقماً صحيحاً" });
      }

      // Preferences in Phase 2 are optional: employees can opt into WANTS_SWAP purely for 1-to-1 catalog visibility without entering multi-swap lottery preferences

      try {
        const updatedUser = db.saveUserRegistration(body);
        return sendJson(res, 200, {
          success: true,
          message: "تم حفظ بياناتك ورغباتك بنجاح في المنصة بالرقم العشوائي المعتمد",
          user: updatedUser
        });
      } catch (err) {
        return sendJson(res, 400, {
          success: false,
          message: err.message || "فشل تسجيل البيانات"
        });
      }
    }

    // 4. Lookup user by National ID
    if (pathname.startsWith("/api/user/") && method === "GET") {
      const nid = pathname.replace("/api/user/", "").trim();
      const user = db.getUserByNationalId(nid);
      if (!user) {
        return sendJson(res, 404, { success: false, message: "لم يتم العثور على موظف مسجل بهذا الرقم القومي" });
      }
      return sendJson(res, 200, { success: true, user });
    }

    // 4b. Smart Recommendations for User
    if (pathname.startsWith("/api/recommendations/") && method === "GET") {
      const q = pathname.replace("/api/recommendations/", "").trim();
      if (!q) {
        return sendJson(res, 400, { success: false, message: "يرجى تحديد الرقم القومي للموظف" });
      }
      const overrides = {};
      if (parsedUrl.query && parsedUrl.query.desired !== undefined) {
        overrides.swap_desired_notes = parsedUrl.query.desired;
      }
      if (parsedUrl.query && parsedUrl.query.undesired !== undefined) {
        overrides.swap_undesired_notes = parsedUrl.query.undesired;
      }
      const recs = db.getSmartRecommendations(q, overrides);
      return sendJson(res, 200, recs);
    }

    // 5. Check Swap Result for public user
    if (pathname.startsWith("/api/result/") && method === "GET") {
      const nid = pathname.replace("/api/result/", "").trim();
      const user = db.getUserByNationalId(nid);
      if (!user) {
        return sendJson(res, 404, { success: false, message: "لم يتم العثور على موظف مسجل بهذا الرقم القومي" });
      }

      // Priority 1: Check if user has an active confirmed DIRECT SWAP!
      // Direct bilateral agreements are officially binding and must appear immediately.
      const activeDirectSwap = db.db.prepare(`
        SELECT ds.*, 
               u1.id as u1_id, u1.full_name as u1_name, u1.national_id as u1_nid, u1.phone as u1_phone, u1.workplace as u1_workplace, u1.random_priority_number as u1_rand,
               u2.id as u2_id, u2.full_name as u2_name, u2.national_id as u2_nid, u2.phone as u2_phone, u2.workplace as u2_workplace, u2.random_priority_number as u2_rand,
               a1.code as a1_code, a1.district as a1_district, a1.neighborhood as a1_neighborhood, a1.building as a1_bld,
               a1.floor as a1_floor, a1.floor_label as a1_fl_label, a1.unit_number as a1_unit, a1.model as a1_model, a1.area as a1_area,
               a1.meter_price as a1_price, a1.total_price as a1_total_price, a1.national_property_id as a1_nat_id,
               a2.code as a2_code, a2.district as a2_district, a2.neighborhood as a2_neighborhood, a2.building as a2_bld,
               a2.floor as a2_floor, a2.floor_label as a2_fl_label, a2.unit_number as a2_unit, a2.model as a2_model, a2.area as a2_area,
               a2.meter_price as a2_price, a2.total_price as a2_total_price, a2.national_property_id as a2_nat_id
        FROM direct_swaps ds
        JOIN users u1 ON ds.user1_id = u1.id
        JOIN users u2 ON ds.user2_id = u2.id
        JOIN apartments a1 ON ds.apt1_id = a1.id
        JOIN apartments a2 ON ds.apt2_id = a2.id
        WHERE ds.user1_id = ? OR ds.user2_id = ?
        ORDER BY ds.id DESC LIMIT 1
      `).get(user.id, user.id);

      if (activeDirectSwap && user.swap_status === 'AGREED_DIRECT') {
        const isUser1 = activeDirectSwap.user1_id === user.id;
        const myAptPrefix = isUser1 ? 'a1_' : 'a2_';
        const partnerAptPrefix = isUser1 ? 'a2_' : 'a1_';
        const partnerPrefix = isUser1 ? 'u2_' : 'u1_';

        const partnerObj = {
          id: activeDirectSwap[partnerPrefix + 'id'],
          full_name: activeDirectSwap[partnerPrefix + 'name'],
          national_id: activeDirectSwap[partnerPrefix + 'nid'],
          phone: activeDirectSwap[partnerPrefix + 'phone'],
          workplace: activeDirectSwap[partnerPrefix + 'workplace']
        };

        const directResult = {
          id: activeDirectSwap.id,
          user_id: user.id,
          full_name: user.full_name,
          national_id: user.national_id,
          phone: user.phone,
          random_priority_number: user.random_priority_number,
          lottery_rank: user.lottery_rank,
          swap_type: 'DIRECT_PAIR',
          rank_achieved: 1,
          cycle_id: `DIRECT-PAIR-${Math.min(activeDirectSwap.user1_id, activeDirectSwap.user2_id)}-${Math.max(activeDirectSwap.user1_id, activeDirectSwap.user2_id)}`,
          original_apartment_id: isUser1 ? activeDirectSwap.apt1_id : activeDirectSwap.apt2_id,
          assigned_apartment_id: isUser1 ? activeDirectSwap.apt2_id : activeDirectSwap.apt1_id,
          
          orig_code: activeDirectSwap[myAptPrefix + 'code'],
          orig_district: activeDirectSwap[myAptPrefix + 'district'],
          orig_neighborhood: activeDirectSwap[myAptPrefix + 'neighborhood'],
          orig_building: activeDirectSwap[myAptPrefix + 'bld'],
          orig_bld: activeDirectSwap[myAptPrefix + 'bld'],
          orig_floor: activeDirectSwap[myAptPrefix + 'floor'],
          orig_floor_label: activeDirectSwap[myAptPrefix + 'fl_label'],
          orig_fl_label: activeDirectSwap[myAptPrefix + 'fl_label'],
          orig_unit: activeDirectSwap[myAptPrefix + 'unit'],
          orig_model: activeDirectSwap[myAptPrefix + 'model'],
          orig_area: activeDirectSwap[myAptPrefix + 'area'],
          orig_price: activeDirectSwap[myAptPrefix + 'price'],
          orig_total_price: activeDirectSwap[myAptPrefix + 'total_price'],
          orig_nat_id: activeDirectSwap[myAptPrefix + 'nat_id'],

          assign_code: activeDirectSwap[partnerAptPrefix + 'code'],
          assign_district: activeDirectSwap[partnerAptPrefix + 'district'],
          assign_neighborhood: activeDirectSwap[partnerAptPrefix + 'neighborhood'],
          assign_building: activeDirectSwap[partnerAptPrefix + 'bld'],
          assign_bld: activeDirectSwap[partnerAptPrefix + 'bld'],
          assign_floor: activeDirectSwap[partnerAptPrefix + 'floor'],
          assign_floor_label: activeDirectSwap[partnerAptPrefix + 'fl_label'],
          assign_fl_label: activeDirectSwap[partnerAptPrefix + 'fl_label'],
          assign_unit: activeDirectSwap[partnerAptPrefix + 'unit'],
          assign_model: activeDirectSwap[partnerAptPrefix + 'model'],
          assign_area: activeDirectSwap[partnerAptPrefix + 'area'],
          assign_price: activeDirectSwap[partnerAptPrefix + 'price'],
          assign_total_price: activeDirectSwap[partnerAptPrefix + 'total_price'],
          assign_nat_id: activeDirectSwap[partnerAptPrefix + 'nat_id'],

          receivingFrom: partnerObj,
          givingTo: partnerObj,
          cycleMembers: [
            {
              id: user.id,
              full_name: user.full_name,
              national_id: user.national_id,
              phone: user.phone,
              workplace: user.workplace,
              orig_district: activeDirectSwap[myAptPrefix + 'district'],
              orig_neighborhood: activeDirectSwap[myAptPrefix + 'neighborhood'],
              orig_building: activeDirectSwap[myAptPrefix + 'bld'],
              orig_unit: activeDirectSwap[myAptPrefix + 'unit'],
              orig_floor_label: activeDirectSwap[myAptPrefix + 'fl_label'],
              orig_model: activeDirectSwap[myAptPrefix + 'model'],
              orig_area: activeDirectSwap[myAptPrefix + 'area'],
              orig_nat_id: activeDirectSwap[myAptPrefix + 'nat_id'],
              assign_district: activeDirectSwap[partnerAptPrefix + 'district'],
              assign_neighborhood: activeDirectSwap[partnerAptPrefix + 'neighborhood'],
              assign_building: activeDirectSwap[partnerAptPrefix + 'bld'],
              assign_unit: activeDirectSwap[partnerAptPrefix + 'unit'],
              assign_floor_label: activeDirectSwap[partnerAptPrefix + 'fl_label'],
              assign_model: activeDirectSwap[partnerAptPrefix + 'model'],
              assign_area: activeDirectSwap[partnerAptPrefix + 'area'],
              assign_nat_id: activeDirectSwap[partnerAptPrefix + 'nat_id']
            },
            {
              id: partnerObj.id,
              full_name: partnerObj.full_name,
              national_id: partnerObj.national_id,
              phone: partnerObj.phone,
              workplace: partnerObj.workplace,
              orig_district: activeDirectSwap[partnerAptPrefix + 'district'],
              orig_neighborhood: activeDirectSwap[partnerAptPrefix + 'neighborhood'],
              orig_building: activeDirectSwap[partnerAptPrefix + 'bld'],
              orig_unit: activeDirectSwap[partnerAptPrefix + 'unit'],
              orig_floor_label: activeDirectSwap[partnerAptPrefix + 'fl_label'],
              orig_model: activeDirectSwap[partnerAptPrefix + 'model'],
              orig_area: activeDirectSwap[partnerAptPrefix + 'area'],
              orig_nat_id: activeDirectSwap[partnerAptPrefix + 'nat_id'],
              assign_district: activeDirectSwap[myAptPrefix + 'district'],
              assign_neighborhood: activeDirectSwap[myAptPrefix + 'neighborhood'],
              assign_building: activeDirectSwap[myAptPrefix + 'bld'],
              assign_unit: activeDirectSwap[myAptPrefix + 'unit'],
              assign_floor_label: activeDirectSwap[myAptPrefix + 'fl_label'],
              assign_model: activeDirectSwap[myAptPrefix + 'model'],
              assign_area: activeDirectSwap[myAptPrefix + 'area'],
              assign_nat_id: activeDirectSwap[myAptPrefix + 'nat_id']
            }
          ]
        };

        return sendJson(res, 200, {
          success: true,
          published: true,
          result: directResult
        });
      }

      // Priority 2: In Phase 1 or Phase 2 (Preferences collection), official lottery has NOT been drawn yet
      const systemPhase = db.getSetting("system_phase", "PHASE_1_DIRECT");
      if (systemPhase !== "PHASE_3_RESULTS") {
        const userPrefs = db.db.prepare(`
          SELECT p.rank, a.district, a.building, a.unit_number, a.floor_label, a.area
          FROM preferences p
          JOIN apartments a ON p.apartment_id = a.id
          WHERE p.user_id = ?
          ORDER BY p.rank ASC
        `).all(user.id);

        return sendJson(res, 200, {
          success: true,
          published: false,
          inPreferencesPhase: true,
          systemPhase: systemPhase,
          prefsCount: userPrefs.length,
          userPrefs: userPrefs,
          user: {
            full_name: user.full_name,
            national_id: user.national_id,
            workplace: user.workplace,
            swap_status: user.swap_status
          },
          message: systemPhase === "PHASE_2_PREFERENCES"
            ? "لم تظهر النتيجة الرسمية بعد. المنظومة حالياً في (المرحلة الثانية: إدخال وتسجيل الرغبات)، وسيتم إجراء المفاضلة والتبادل الإلكتروني واعتماد النتائج فور إغلاق باب تسجيل الرغبات من قبل لجنة الإسكان."
            : "لم تظهر النتيجة الرسمية بعد. المنظومة حالياً في (المرحلة الأولى: رصد الشقق والتوافق الودي المباشر)."
        });
      }

      const latestRun = db.db.prepare("SELECT * FROM swap_runs WHERE is_published = 1 ORDER BY id DESC LIMIT 1").get();
      if (!latestRun) {
        return sendJson(res, 200, {
          success: true,
          published: false,
          message: "لم يتم اعتماد النتيجة بعد ولم يتم النشر من قبل لجنة الإسكان. يرجى المتابعة لاحقاً بعد انتهاء لجنة الإسكان من الاعتماد الرسمي للنتائج."
        });
      }

      const result = db.db.prepare(`
        SELECT sr.*, 
               orig.code as orig_code, orig.district as orig_district, orig.neighborhood as orig_neighborhood,
               orig.building as orig_building, orig.building as orig_bld,
               orig.floor as orig_floor, orig.floor_label as orig_floor_label, orig.floor_label as orig_fl_label,
               orig.unit_number as orig_unit, orig.model as orig_model, orig.area as orig_area,
               orig.meter_price as orig_price, orig.total_price as orig_total_price, orig.national_property_id as orig_nat_id,
               assign.code as assign_code, assign.district as assign_district, assign.neighborhood as assign_neighborhood,
               assign.building as assign_building, assign.building as assign_bld,
               assign.floor as assign_floor, assign.floor_label as assign_floor_label, assign.floor_label as assign_fl_label,
               assign.unit_number as assign_unit, assign.model as assign_model, assign.area as assign_area,
               assign.meter_price as assign_price, assign.total_price as assign_total_price, assign.national_property_id as assign_nat_id,
               u.full_name, u.national_id, u.phone, u.lottery_rank
        FROM swap_results sr
        JOIN users u ON sr.user_id = u.id
        JOIN apartments orig ON sr.original_apartment_id = orig.id
        JOIN apartments assign ON sr.assigned_apartment_id = assign.id
        WHERE sr.run_id = ? AND u.national_id = ?
      `).get(latestRun.id, nid);

      if (!result) {
        // The user is registered in the platform, but registered after the last published run
        // or hasn't participated in an automated matching cycle yet.
        const origApt = user.original_apartment_id ? db.getApartmentById(user.original_apartment_id) : null;
        if (!origApt) {
          return sendJson(res, 404, { success: false, message: "بيانات الشقة الأصلية غير مسجلة" });
        }

        const isWantsSwap = user.swap_status === 'WANTS_SWAP';
        const fallbackResult = {
          id: user.id,
          user_id: user.id,
          full_name: user.full_name,
          national_id: user.national_id,
          phone: user.phone,
          workplace: user.workplace,
          lottery_rank: user.lottery_rank,
          random_priority_number: user.random_priority_number,
          swap_type: 'KEPT_ORIGINAL',
          rank_achieved: 0,
          cycle_id: null,
          original_apartment_id: origApt.id,
          assigned_apartment_id: origApt.id,

          orig_code: origApt.code,
          orig_district: origApt.district,
          orig_neighborhood: origApt.neighborhood,
          orig_building: origApt.building,
          orig_bld: origApt.building,
          orig_floor: origApt.floor,
          orig_floor_label: origApt.floor_label,
          orig_fl_label: origApt.floor_label,
          orig_unit: origApt.unit_number,
          orig_model: origApt.model,
          orig_area: origApt.area,
          orig_price: origApt.meter_price,
          orig_total_price: origApt.total_price,
          orig_nat_id: origApt.national_property_id,

          assign_code: origApt.code,
          assign_district: origApt.district,
          assign_neighborhood: origApt.neighborhood,
          assign_building: origApt.building,
          assign_bld: origApt.building,
          assign_floor: origApt.floor,
          assign_floor_label: origApt.floor_label,
          assign_fl_label: origApt.floor_label,
          assign_unit: origApt.unit_number,
          assign_model: origApt.model,
          assign_area: origApt.area,
          assign_price: origApt.meter_price,
          assign_total_price: origApt.total_price,
          assign_nat_id: origApt.national_property_id,

          isLiveRegistrationOnly: true,
          statusNotice: isWantsSwap
            ? "بياناتك وشقتك مسجلة بنجاح بالمنظومة ومعروضة بكتالوج التبادل (1-to-1). النتائج المنشورة حالياً تخص تشغيلة سابقة تمت قبل تسجيلك، وشقتك محفوظة لك بنسبة 100% وسيتم إدراجك تلقائياً في دورة التوفيق القادمة عند اعتمادها من لجنة التبديل."
            : "بياناتك وشقتك مسجلة بنجاح بالمنظومة، وموقفك الحالي: محتفظ بشقتك الأصلية بنسبة 100% دون أي مساس بها.",
          cycleMembers: [],
          receivingFrom: null,
          givingTo: null
        };

        return sendJson(res, 200, {
          success: true,
          published: true,
          result: fallbackResult
        });
      }

      // If swapped, fetch all members of the cycle with contact numbers for Ministry coordination
      let cycleMembers = [];
      let receivingFrom = null;
      let givingTo = null;

      if (result.swap_type !== "KEPT_ORIGINAL" && result.cycle_id) {
        cycleMembers = db.db.prepare(`
          SELECT u.id, u.full_name, u.national_id, u.phone, u.workplace, 
                 sr.rank_achieved, sr.swap_type, sr.cycle_id,
                 orig.district as orig_district, orig.neighborhood as orig_neighborhood, orig.building as orig_building,
                 orig.unit_number as orig_unit, orig.floor_label as orig_floor_label, orig.model as orig_model, orig.area as orig_area,
                 orig.national_property_id as orig_nat_id,
                 assign.district as assign_district, assign.neighborhood as assign_neighborhood, assign.building as assign_building,
                 assign.unit_number as assign_unit, assign.floor_label as assign_floor_label, assign.model as assign_model, assign.area as assign_area,
                 assign.national_property_id as assign_nat_id
          FROM swap_results sr
          JOIN users u ON sr.user_id = u.id
          JOIN apartments orig ON sr.original_apartment_id = orig.id
          JOIN apartments assign ON sr.assigned_apartment_id = assign.id
          WHERE sr.run_id = ? AND sr.cycle_id = ?
          ORDER BY sr.id ASC
        `).all(latestRun.id, result.cycle_id);

        // Person whose apartment this user is receiving
        receivingFrom = cycleMembers.find(m => m.orig_nat_id === result.assign_nat_id) || null;
        // Person who is receiving this user's original apartment
        givingTo = cycleMembers.find(m => m.assign_nat_id === result.orig_nat_id) || null;
      }

      return sendJson(res, 200, {
        success: true,
        published: true,
        result: {
          ...result,
          cycleMembers,
          receivingFrom,
          givingTo
        }
      });
    }

        // 5b. Admin Login Verification
    if (pathname === "/api/admin/login" && method === "POST") {
      const body = await parseBody(req);
      const storedPin = db.getSetting("admin_pin", "Capital@Housing#2026!Adm");
      if (body.pin && String(body.pin).trim() === String(storedPin).trim()) {
        return sendJson(res, 200, { success: true, message: "تم تسجيل الدخول بنجاح" });
      }
      return sendJson(res, 401, { success: false, message: "رمز المرور غير صحيح!" });
    }

    // 5c. Admin Change Password
        // 5d. Admin Download Database Backup
    if (pathname === "/api/admin/backup-db" && method === "GET") {
      try {
        const dbPath = path.join(__dirname, "data", "housing.db");
        try { db.db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch(e) {}
        const filename = "housing_backup_" + new Date().toISOString().slice(0, 10) + ".db";
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="' + filename + '"'
        });
        const readStream = fs.createReadStream(dbPath);
        readStream.pipe(res);
        return;
      } catch (err) {
        return sendJson(res, 500, { success: false, message: "فشل تحميل نسخة قاعدة البيانات" });
      }
    }

    if (pathname === "/api/admin/change-password" && method === "POST") {
      const body = await parseBody(req);
      const storedPin = db.getSetting("admin_pin", "Capital@Housing#2026!Adm");
      if (!body.oldPin || String(body.oldPin).trim() !== String(storedPin).trim()) {
        return sendJson(res, 400, { success: false, message: "كلمة المرور الحالية غير صحيحة" });
      }
      if (!body.newPin || String(body.newPin).trim().length < 4) {
        return sendJson(res, 400, { success: false, message: "كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف أو أرقام" });
      }
      db.setSetting("admin_pin", String(body.newPin).trim());
      return sendJson(res, 200, { success: true, message: "تم تحديث كلمة مرور لوحة الإدارة بنجاح!" });
    }

            // 5c. Get Cycle Members by Cycle ID
    if (pathname.startsWith("/api/cycle/") && method === "GET") {
      const cycleId = pathname.replace("/api/cycle/", "").trim();
      const latestRun = db.db.prepare("SELECT id FROM swap_runs ORDER BY id DESC LIMIT 1").get();
      if (!latestRun) {
        return sendJson(res, 404, { success: false, message: "لا توجد نتائج محفوظة" });
      }

      const members = db.db.prepare(`
        SELECT u.id, u.full_name, u.national_id, u.phone, u.workplace, 
               sr.rank_achieved, sr.swap_type, sr.cycle_id,
               orig.district as orig_district, orig.neighborhood as orig_neighborhood, orig.building as orig_building,
               orig.unit_number as orig_unit, orig.floor_label as orig_floor_label, orig.model as orig_model, orig.area as orig_area,
               orig.national_property_id as orig_nat_id,
               assign.district as assign_district, assign.neighborhood as assign_neighborhood, assign.building as assign_building,
               assign.unit_number as assign_unit, assign.floor_label as assign_floor_label, assign.model as assign_model, assign.area as assign_area,
               assign.national_property_id as assign_nat_id
        , giver.full_name as receiving_from_name
        FROM swap_results sr
        JOIN users u ON sr.user_id = u.id
        JOIN apartments orig ON sr.original_apartment_id = orig.id
        JOIN apartments assign ON sr.assigned_apartment_id = assign.id
        LEFT JOIN users giver ON sr.assigned_apartment_id = giver.original_apartment_id
        WHERE sr.run_id = ? AND sr.cycle_id = ?
        ORDER BY sr.id ASC
      `).all(latestRun.id, cycleId);

      return sendJson(res, 200, { success: true, cycleId, members });
    }

// 5d. Get and Set System Operating Phase
    if (pathname === "/api/system-phase" && method === "GET") {
      const phase = db.getSetting("system_phase", "PHASE_1_DIRECT");
      return sendJson(res, 200, { success: true, phase });
    }

    if (pathname === "/api/admin/system-phase" && method === "POST") {
      const body = await parseBody(req);
      if (!body.phase) {
        return sendJson(res, 400, { success: false, message: "يرجى تحديد المرحلة المطلوبة" });
      }
      db.setSetting("system_phase", body.phase);
      const labels = {
        'PHASE_1_DIRECT': 'المرحلة 1: حصر الشقق الأصلية والتواصل المباشر (One-to-One)',
        'PHASE_2_PREFERENCES': 'المرحلة 2: فتح تسجيل الرغبات التبادلية (10 إلى 20 رغبة) وإجراء السلاسل التبادلية',
        'PHASE_3_RESULTS': 'المرحلة 3: إعلان النتائج الرسمية المعتمدة'
      };
      return sendJson(res, 200, { 
        success: true, 
        message: `تم بنجاح تفعيل: ${labels[body.phase] || body.phase}`,
        phase: body.phase 
      });
    }

    // 5e. Admin: Lookup Party (by National ID, Apartment National Property ID, or Phone)
    if (pathname === "/api/admin/lookup-party" && method === "GET") {
      const q = parsedUrl.query ? parsedUrl.query.q : '';
      if (!q) {
        return sendJson(res, 400, { success: false, message: "يرجى إدخال الرقم القومي أو الرقم العقاري للبحث" });
      }
      const result = db.findUserOrApartment(q);
      if (!result) {
        return sendJson(res, 404, { success: false, message: "لم يتم العثور على موظف أو شقة مطابقة للبحث" });
      }
      return sendJson(res, 200, { success: true, result });
    }

    // 5f. Admin: Confirm Direct 1-to-1 Swap between two parties
    if (pathname === "/api/admin/direct-swap" && method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.query1 || !body.query2) {
          return sendJson(res, 400, { success: false, message: "يرجى تحديد بيانات الطرفين (الرقم القومي أو الرقم العقاري لكل منهما)" });
        }
        const outcome = db.confirmDirectSwap(body.query1, body.query2, body.notes);
        return sendJson(res, 200, outcome);
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // 5g. Admin: List All Approved Direct Swaps
    if (pathname === "/api/admin/direct-swaps" && method === "GET") {
      const swaps = db.getDirectSwaps();
      return sendJson(res, 200, { success: true, swaps });
    }

    if (pathname === "/api/admin/pending-direct-swaps" && method === "GET") {
      const pending = db.getPendingDirectSwaps();
      return sendJson(res, 200, { success: true, pending });
    }

    if (pathname.startsWith("/api/partner-lookup") && method === "GET") {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const q = (parsedUrl.searchParams.get("q") || "").trim();
      if (!q || q.length < 3) {
        return sendJson(res, 200, { success: false, message: "يرجى إدخال 3 أحرف أو أرقام على الأقل" });
      }
      const match = db.findUserOrApartment(q);
      if (match && match.user && match.apartment) {
        return sendJson(res, 200, {
          success: true,
          partner: {
            id: match.user.id,
            name: match.user.full_name,
            nid: match.user.national_id,
            phone: match.user.phone,
            workplace: match.user.workplace,
            swapStatus: match.user.swap_status,
            apartment: match.apartment
          }
        });
      }
      return sendJson(res, 200, { success: false, message: "لم يتم العثور على زميل مسجل بهذا الرقم حالياً" });
    }

    // 5h. Admin: Cancel Direct Swap
    if (pathname === "/api/admin/cancel-direct-swap" && method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.swapId) {
          return sendJson(res, 400, { success: false, message: "يرجى تحديد كود التوافق الودي" });
        }
        const outcome = db.cancelDirectSwap(body.swapId);
        return sendJson(res, 200, outcome);
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // 5i. Admin: Update Single User Swap Status
    if (pathname === "/api/admin/update-user-status" && method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.query || !body.status) {
          return sendJson(res, 400, { success: false, message: "يرجى تحديد الموظف والحالة المطلوبة" });
        }
        const outcome = db.updateSingleUserStatus(body.query, body.status);
        return sendJson(res, 200, outcome);
      } catch (err) {
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

// 6. Admin: Run matching simulation / preview
    if (pathname === "/api/admin/match" && method === "POST") {
      try {
        const body = await parseBody(req);
        const rule = body.priorityRule || db.getSetting("priority_rule", "random_draw");
        const allowCycles = body.allowCycles !== false;

        const engine = new HousingMatchingEngine({
          priorityRule: rule,
          allowCycles: allowCycles
        });

        const matchOutput = engine.run();
        const runId = engine.saveToDatabase(matchOutput);
        matchOutput.runId = runId;
        return sendJson(res, 200, matchOutput);
      } catch (err) {
        console.error("Match error:", err);
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // 6b. Admin: Get Latest Saved Match & Cycles
    if (pathname === "/api/admin/latest-match" && method === "GET") {
      const latestRun = db.db.prepare("SELECT * FROM swap_runs ORDER BY id DESC LIMIT 1").get();
      if (!latestRun) {
        return sendJson(res, 200, { success: true, hasRun: false });
      }

      const rows = db.db.prepare(`
        SELECT sr.id, sr.user_id as id, sr.original_apartment_id as originalAptId, sr.assigned_apartment_id as assignedAptId,
               sr.rank_achieved as rankAchieved, sr.random_priority_number as randomPriorityNumber,
               sr.swap_type as swapType, sr.cycle_id as cycleId,
               u.full_name as name, u.national_id as nationalId, u.phone, u.workplace,
               orig.district as origDistrict, orig.neighborhood as origNeighborhood, orig.building as origBuilding,
               orig.unit_number as origUnit, orig.floor_label as origFloorLabel, orig.area as origArea,
               orig.national_property_id as origNatId,
               assign.district as assignDistrict, assign.neighborhood as assignNeighborhood, assign.building as assignBuilding,
               assign.unit_number as assignUnit, assign.floor_label as assignFloorLabel, assign.area as assignArea,
               assign.national_property_id as assignNatId
        FROM swap_results sr
        JOIN users u ON sr.user_id = u.id
        JOIN apartments orig ON sr.original_apartment_id = orig.id
        JOIN apartments assign ON sr.assigned_apartment_id = assign.id
        WHERE sr.run_id = ?
        ORDER BY sr.id ASC
      `).all(latestRun.id);

      const cycleMap = new Map();
      rows.forEach(r => {
        r.origAptCode = `${r.origDistrict}-${r.origNeighborhood}-ع ${r.origBuilding}-و ${r.origUnit}`;
        r.assignedAptCode = `${r.assignDistrict}-${r.assignNeighborhood}-ع ${r.assignBuilding}-و ${r.assignUnit}`;

        if (r.swapType !== 'KEPT_ORIGINAL' && r.cycleId) {
          if (!cycleMap.has(r.cycleId)) {
            cycleMap.set(r.cycleId, []);
          }
          cycleMap.get(r.cycleId).push(r);
        }
      });

      const cycles = [];
      cycleMap.forEach((members, cycleId) => {
        cycles.push({
          cycleId,
          length: members.length,
          type: members.length === 2 ? "تبادل ثنائي مباشر" : `دورة تبادل (${members.length} أطراف)`,
          members
        });
      });

      const totalSwapped = rows.filter(s => s.swapType !== "KEPT_ORIGINAL").length;
      const rank1Count = rows.filter(s => s.rankAchieved === 1).length;
      const rank2Count = rows.filter(s => s.rankAchieved === 2).length;
      const rank3Count = rows.filter(s => s.rankAchieved === 3).length;
      const rank4PlusCount = rows.filter(s => s.rankAchieved >= 4).length;
      const keptCount = rows.filter(s => s.swapType === "KEPT_ORIGINAL").length;

      return sendJson(res, 200, {
        success: true,
        hasRun: true,
        runId: latestRun.id,
        isPublished: latestRun.is_published === 1,
        totalSwapped,
        keptOriginal: keptCount,
        satisfaction: {
          rank1Count,
          rank1Percent: totalSwapped ? Math.round((rank1Count / totalSwapped) * 100) : 0,
          rank2Count,
          rank2Percent: totalSwapped ? Math.round((rank2Count / totalSwapped) * 100) : 0,
          rank3Count,
          rank3Percent: totalSwapped ? Math.round((rank3Count / totalSwapped) * 100) : 0,
          rank4PlusCount,
          rank4PlusPercent: totalSwapped ? Math.round((rank4PlusCount / totalSwapped) * 100) : 0
        },
        cycles,
        results: rows
      });
    }

    // 7. Admin: Commit / Save matching run
    if (pathname === "/api/admin/save-match" && method === "POST") {
      try {
        const body = await parseBody(req);
        const rule = body.priorityRule || db.getSetting("priority_rule", "random_draw");

        const engine = new HousingMatchingEngine({ priorityRule: rule });
        const matchOutput = engine.run();
        const runId = engine.saveToDatabase(matchOutput);

        return sendJson(res, 200, {
          success: true,
          message: "تم حفظ واعتماد نتائج التوفيق بنجاح",
          runId,
          stats: matchOutput.satisfaction
        });
      } catch (err) {
        console.error("Save match error:", err);
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // 8. Admin: Toggle publish results
    if (pathname === "/api/admin/publish" && method === "POST") {
      const body = await parseBody(req);
      const publish = body.publish ? 1 : 0;

      const latestRun = db.db.prepare("SELECT id FROM swap_runs ORDER BY id DESC LIMIT 1").get();
      if (!latestRun) {
        return sendJson(res, 400, { success: false, message: "لا توجد نتائج محفوظة بعد لتشغيل النشر" });
      }

      db.db.prepare("UPDATE swap_runs SET is_published = ? WHERE id = ?").run(publish, latestRun.id);
      db.setSetting("results_published", publish ? "true" : "false");

      return sendJson(res, 200, {
        success: true,
        message: publish ? "تم نشر النتائج الآن بنجاح وأصبح بإمكان جميع الموظفين الاستعلام" : "تم إلغاء نشر النتائج وإعادتها للمراجعة",
        published: publish === 1
      });
    }

    // 9. Admin: Get all participants & their preferences
    
    // 9b. Admin: Delete User
    if (pathname === "/api/admin/user-delete" && method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.userId) {
          return sendJson(res, 400, { success: false, message: "يرجى تحديد الموظف المطلوب حذفه" });
        }
        const outcome = db.deleteUser(Number(body.userId));
        return sendJson(res, 200, outcome);
      } catch (err) {
        console.error("Delete user error:", err);
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    // 9c. Admin: Update User
    if (pathname === "/api/admin/user-update" && method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.userId) {
          return sendJson(res, 400, { success: false, message: "يرجى تحديد الموظف المطلوب تحديثه" });
        }
        const outcome = db.updateAdminUser(Number(body.userId), body);
        return sendJson(res, 200, outcome);
      } catch (err) {
        console.error("Update user error:", err);
        return sendJson(res, 400, { success: false, message: err.message });
      }
    }

    if (pathname === "/api/admin/users" && method === "GET") {
      const users = db.getAllUsers();
      return sendJson(res, 200, { success: true, users });
    }

    // 10. Admin: Seed Mock Data for testing (supports 100 to 900 applicants)
    if (pathname === "/api/admin/seed-test" && method === "POST") {
      const body = await parseBody(req);
      const count = body.count ? Number(body.count) : 900;
      const result = db.generateSampleParticipants(count);
      return sendJson(res, 200, { success: true, result });
    }

    // 11. Admin: Reset user & swap data
    if (pathname === "/api/admin/reset" && method === "POST") {
      const outcome = db.resetAllData();
      return sendJson(res, 200, outcome);
    }

        // 12c. Admin: Export All Registered Users & 20 Preferences to Native Excel (.xls)
    if (pathname === "/api/admin/export-users-excel" && method === "GET") {
      const users = db.db.prepare(`
        SELECT u.*, 
               a.code as apt_code, a.district as apt_district, a.neighborhood as apt_neighborhood,
               a.building as apt_building, a.unit_number as apt_unit, a.floor_label as apt_floor_label,
               a.model as apt_model, a.area as apt_area, a.meter_price as apt_meter_price,
               a.total_price as apt_total_price, a.national_property_id as apt_national_id
        FROM users u
        LEFT JOIN apartments a ON u.original_apartment_id = a.id
        ORDER BY u.id ASC
      `).all();

      let prefHeaders = "";
      for (let i = 1; i <= 20; i++) { prefHeaders += "  <th>الرغبة " + i + " (الرقم القومي العقاري والتفاصيل)</th>\n"; }

      let html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<style>
  table { border-collapse: collapse; width: 100%; font-family: Calibri, 'Segoe UI', Tahoma, Arial, sans-serif; }
  th { background-color: #1e3a8a; color: white; border: 1px solid #cbd5e1; padding: 8px 12px; font-size: 13px; text-align: center; }
  td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 12px; text-align: center; }
  .text-cell { mso-number-format:"\\@"; }
  tr:nth-child(even) { background-color: #f8fafc; }
</style>
</head>
<body>
<h2>كشف بيانات الموظفين المسجلين والرغبات التبادلية - كراسة شروط العاصمة الإدارية</h2>
<p>تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}</p>
<table border="1">
<thead>
<tr>
  <th>م</th>
  <th>الاسم بالكامل</th>
  <th>الرقم القومي</th>
  <th>رقم المحمول</th>
  <th>جهة العمل / الوزارة</th>
  <th>الموقف من التبديل</th>
  <th>كود الشقة الأصلية</th>
  <th>الحي</th>
  <th>المجاورة</th>
  <th>العمارة</th>
  <th>رقم الشقة</th>
  <th>الدور</th>
  <th>النموذج</th>
  <th>المساحة م²</th>
  <th>سعر المتر</th>
  <th>إجمالي السعر</th>
  <th>الرقم القومي العقاري للشقة</th>
  <th>عدد الرغبات</th>
${prefHeaders}  <th>كود التسجيل</th>
  <th>تاريخ التسجيل</th>
</tr>
</thead>
<tbody>
`;

      users.forEach((u, idx) => {
        const prefs = db.db.prepare(`
          SELECT p.rank, a.code, a.district, a.neighborhood, a.building, a.unit_number, a.floor_label, a.model, a.area, a.national_property_id
          FROM preferences p
          JOIN apartments a ON p.apartment_id = a.id
          WHERE p.user_id = ?
          ORDER BY p.rank ASC
        `).all(u.id);

        let statusLabel = 'راغب في التبديل';
        if (u.swap_status === 'AGREED_DIRECT') statusLabel = 'تم التوافق الودي';
        if (u.swap_status === 'KEPT_ORIGINAL') statusLabel = 'محتفظ بالشقة الأصلية';

        html += `<tr>
  <td>${idx + 1}</td>
  <td>${u.full_name}</td>
  <td class="text-cell">${u.national_id}</td>
  <td class="text-cell">${u.phone}</td>
  <td>${u.workplace || ''}</td>
  <td>${statusLabel}</td>
  <td>${u.apt_code || ''}</td>
  <td>${u.apt_district || ''}</td>
  <td>${u.apt_neighborhood || ''}</td>
  <td>${u.apt_building || ''}</td>
  <td>${u.apt_unit || ''}</td>
  <td>${u.apt_floor_label || ''}</td>
  <td>${u.apt_model || ''}</td>
  <td>${u.apt_area || ''}</td>
  <td>${u.apt_meter_price ? u.apt_meter_price.toLocaleString('ar-EG') : ''}</td>
  <td>${u.apt_total_price ? u.apt_total_price.toLocaleString('ar-EG') : ''}</td>
  <td class="text-cell">${u.apt_national_id || ''}</td>
  <td>${prefs.length}</td>
`;

        for (let i = 1; i <= 20; i++) {
          const p = prefs.find(x => x.rank === i);
          if (p) {
            html += `  <td class="text-cell">${p.national_property_id} | ${p.district} عمارة ${p.building} شقة ${p.unit_number} (${p.floor_label} - نموذج ${p.model} - ${p.area}م²)</td>\n`;
          } else {
            html += `  <td></td>\n`;
          }
        }

        html += `  <td>${u.confirmation_code || ''}</td>
  <td>${u.registered_at || ''}</td>
</tr>
`;
      });

      html += `</tbody></table></body></html>`;

      res.writeHead(200, {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Housing_Users_Preferences_' + new Date().toISOString().slice(0, 10) + '.xls"'
      });
      return res.end(html);
    }

    // 12b. Admin: Export All Registered Users & Current Preferences to CSV (Excel UTF-8 BOM)
    if (pathname === "/api/admin/export-users-csv" && method === "GET") {
      const users = db.db.prepare(`
        SELECT u.*, 
               a.code as apt_code, a.district as apt_district, a.neighborhood as apt_neighborhood,
               a.building as apt_building, a.unit_number as apt_unit, a.floor_label as apt_floor_label,
               a.model as apt_model, a.area as apt_area, a.meter_price as apt_meter_price,
               a.total_price as apt_total_price, a.national_property_id as apt_national_id
        FROM users u
        LEFT JOIN apartments a ON u.original_apartment_id = a.id
        ORDER BY u.id ASC
      `).all();

      let prefCols = "";
      for (let i = 1; i <= 20; i++) { prefCols += "الرغبة " + i + " (الرقم العقاري والتفاصيل),"; }
      let csv = "\uFEFFsep=,\nم,الاسم بالكامل,الرقم القومي,رقم المحمول,جهة العمل / الوزارة,الموقف من التبديل,كود الشقة الأصلية,الحي,المجاورة,العمارة,رقم الشقة,الدور,النموذج,المساحة م²,سعر المتر,إجمالي السعر,الرقم القومي العقاري للشقة,عدد الرغبات المسجلة," + prefCols + "كود التسجيل,تاريخ التسجيل\n";

      users.forEach((u, idx) => {
        const prefs = db.db.prepare(`
          SELECT p.rank, a.code, a.district, a.neighborhood, a.building, a.unit_number, a.floor_label, a.model, a.area, a.national_property_id
          FROM preferences p
          JOIN apartments a ON p.apartment_id = a.id
          WHERE p.user_id = ?
          ORDER BY p.rank ASC
        `).all(u.id);

        let statusLabel = 'راغب في التبديل';
        if (u.swap_status === 'AGREED_DIRECT') statusLabel = 'تم التوافق الودي';
        if (u.swap_status === 'KEPT_ORIGINAL') statusLabel = 'محتفظ بالشقة الأصلية';

        let row = `"${idx + 1}","${u.full_name}","'${u.national_id}'","'${u.phone}'","${u.workplace || ''}","${statusLabel}",` +
                  `"${u.apt_code || ''}","${u.apt_district || ''}","${u.apt_neighborhood || ''}","${u.apt_building || ''}","${u.apt_unit || ''}","${u.apt_floor_label || ''}","${u.apt_model || ''}","${u.apt_area || ''}","${u.apt_meter_price || ''}","${u.apt_total_price || ''}","'${u.apt_national_id || ''}'",` +
                  `"${prefs.length}",`;

        for (let i = 1; i <= 20; i++) {
          const p = prefs.find(x => x.rank === i);
          if (p) {
            row += `"${p.national_property_id} | ${p.district} عمارة ${p.building} شقة ${p.unit_number} (${p.floor_label} - نموذج ${p.model} - ${p.area}م²)",`;
          } else {
            row += `"",`;
          }
        }

        row += `"${u.confirmation_code || ''}","${u.registered_at || ''}"\n`;
        csv += row;
      });

      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Housing_Users_Preferences_' + new Date().toISOString().slice(0, 10) + '.csv"'
      });
      return res.end(csv);
    }

    // 12. Admin: Export official swap results or Phase 1 participants to CSV (UTF-8 BOM for Excel Arabic)
    if (pathname === "/api/admin/export-csv" && method === "GET") {
      const latestRun = db.db.prepare("SELECT * FROM swap_runs ORDER BY id DESC LIMIT 1").get();
      
      // If no matching run exists yet (e.g. in Phase 1 Inventory & Direct 1-to-1 Swap), export all registered participants
      if (!latestRun) {
        const users = db.getAllUsers();
        let csv = "\uFEFFم,الاسم بالكامل,الرقم القومي,رقم المحمول,الوزارة / جهة العمل,حالة الرغبة,الحي,المجاورة,رقم العمارة,رقم الوحدة,الدور,النموذج,المساحة م²,سعر المتر,إجمالي السعر,الرقم القومي العقاري للوحدة,رقم القرعة المعتمد,كود التسجيل,تاريخ التسجيل\n";
        users.forEach((u, idx) => {
          const statusLabel = u.swap_status === 'AGREED_DIRECT' ? 'تم التوفيق الودي' : (u.swap_status === 'KEPT_ORIGINAL' ? 'محتفظ بالشقة' : 'راغب في التبديل (1-to-1)');
          csv += `"${idx + 1}","${u.full_name}","'${u.national_id}'","'${u.phone}'","${u.workplace || ''}","${statusLabel}",` +
                 `"${u.apt_district || ''}","${u.apt_neighborhood || ''}","${u.apt_building || ''}","${u.apt_unit || ''}","${u.apt_floor_label || ''}","${u.apt_model || ''}","${u.apt_area || ''}","${u.apt_meter_price || ''}","${u.apt_total_price || ''}","'${u.apt_national_id || ''}'",` +
                 `"'#${u.random_priority_number || ''}'","${u.confirmation_code || ''}","${u.registered_at || ''}"\n`;
        });

        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="Housing_Phase1_Inventory_${new Date().toISOString().slice(0, 10)}.csv"`
        });
        return res.end(csv);
      }

      const rows = db.db.prepare(`
        SELECT sr.id, u.full_name, u.national_id, u.phone, u.workplace, u.swap_status, u.employee_code, u.lottery_rank, sr.random_priority_number,
               orig.district as orig_dist, orig.neighborhood as orig_nh, orig.building as orig_bld, orig.unit_number as orig_unit,
               orig.floor_label as orig_fl_label, orig.model as orig_model, orig.area as orig_area, orig.meter_price as orig_price,
               orig.national_property_id as orig_nat_id,
               assign.district as assign_dist, assign.neighborhood as assign_nh, assign.building as assign_bld, assign.unit_number as assign_unit,
               assign.floor_label as assign_fl_label, assign.model as assign_model, assign.area as assign_area, assign.meter_price as assign_price,
               assign.national_property_id as assign_nat_id,
               sr.rank_achieved, sr.swap_type, sr.cycle_id
        FROM swap_results sr
        JOIN users u ON sr.user_id = u.id
        JOIN apartments orig ON sr.original_apartment_id = orig.id
        JOIN apartments assign ON sr.assigned_apartment_id = assign.id
        WHERE sr.run_id = ?
        ORDER BY sr.swap_type DESC, sr.rank_achieved ASC
      `).all(latestRun.id);

      let csv = "\uFEFFم,الاسم بالكامل,الرقم القومي,رقم المحمول,الوزارة / جهة العمل,حالة الرغبة,الرقم الوظيفي,رقم القرعة العشوائي المعتمد,أسبقية القرعة,الحي الأصلي,المجاورة الأصلية,العمارة الأصلية,رقم الوحدة الأصلية,الدور الأصلي,النموذج الأصلي,المساحة م² الأصلية,سعر المتر الأصلي,الرقم العقاري الأصلي,الحي الجديد,المجاورة الجديدة,العمارة الجديدة,رقم الوحدة الجديدة,الدور الجديد,النموذج الجديد,المساحة م² الجديدة,سعر المتر الجديد,الرقم العقاري الجديد,الرغبة المحققة,نوع التبادل,كود الدورة,توقيع الموظف بالاستلام\n";

      rows.forEach((r, idx) => {
        const typeLabel = r.swap_type === "KEPT_ORIGINAL" ? "احتفاظ بالشقة" : (r.swap_type === "DIRECT_PAIR" ? "تبادل ثنائي" : "دورة تبادلية");
        const rankLabel = r.rank_achieved === 0 ? "الأصلية" : `الرغبة ${r.rank_achieved}`;
        const statusLabel = r.swap_status === 'AGREED_DIRECT' ? 'تم التوفيق الودي' : (r.swap_status === 'KEPT_ORIGINAL' ? 'محتفظ بالشقة' : 'راغب في التبديل');
        csv += `"${idx + 1}","${r.full_name}","'${r.national_id}'","'${r.phone}'","${r.workplace || ''}","${statusLabel}","${r.employee_code || ''}","'#${r.random_priority_number || ''}'","${r.lottery_rank || ''}",` +
               `"${r.orig_dist}","${r.orig_nh}","${r.orig_bld}","${r.orig_unit}","${r.orig_fl_label}","${r.orig_model}","${r.orig_area}","${r.orig_price}","'${r.orig_nat_id}'",` +
               `"${r.assign_dist}","${r.assign_nh}","${r.assign_bld}","${r.assign_unit}","${r.assign_fl_label}","${r.assign_model}","${r.assign_area}","${r.assign_price}","'${r.assign_nat_id}'",` +
               `"${rankLabel}","${typeLabel}","${r.cycle_id || ''}",""\n`;
      });

      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Housing_Swap_Official_Results_${new Date().toISOString().slice(0, 10)}.csv"`
      });
      return res.end(csv);
    }

    // Static file serving
    let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        filePath = path.join(PUBLIC_DIR, "index.html");
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500);
          return res.end("Internal Server Error");
        }
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      });
    });

  } catch (error) {
    console.error("Server Error:", error);
    sendJson(res, 500, { success: false, message: error.message || "حدث خطأ غير متوقع في السيرفر" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`=======================================================`);
  console.log(`  🏢 منصة تبادل شقق الموظفين وفق كراسة الشروط الرسمية   `);
  console.log(`  📊 1,100 وحدة بكراسة الشروط (R3 & R5) | 900 متقدم     `);
  console.log(`  🌐 الخادم يعمل بنجاح على: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
