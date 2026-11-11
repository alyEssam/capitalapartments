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

      // Only require preferences during PHASE_2_PREFERENCES
      if (currentPhase === "PHASE_2_PREFERENCES" && body.wantsSwap && (!body.preferences || body.preferences.length === 0)) {
        return sendJson(res, 400, { success: false, message: "طالما اخترت الرغبة في التبديل في المرحلة الثانية، يجب اختيار رغبة واحدة على الأقل من قائمة الشقق" });
      }

      const updatedUser = db.saveUserRegistration(body);
      return sendJson(res, 200, {
        success: true,
        message: "تم حفظ بياناتك ورغباتك بنجاح في المنصة بالرقم العشوائي المعتمد",
        user: updatedUser
      });
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

    // 5. Check Swap Result for public user
    if (pathname.startsWith("/api/result/") && method === "GET") {
      const nid = pathname.replace("/api/result/", "").trim();
      const user = db.getUserByNationalId(nid);
      if (!user) {
        return sendJson(res, 404, { success: false, message: "لم يتم العثور على موظف مسجل بهذا الرقم القومي" });
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
        return sendJson(res, 404, { success: false, message: "لم تسجل بيانات مشاركة في هذه القرعة" });
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
        FROM swap_results sr
        JOIN users u ON sr.user_id = u.id
        JOIN apartments orig ON sr.original_apartment_id = orig.id
        JOIN apartments assign ON sr.assigned_apartment_id = assign.id
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
      const body = await parseBody(req);
      const rule = body.priorityRule || db.getSetting("priority_rule", "random_draw");
      const allowCycles = body.allowCycles !== false;

      const engine = new HousingMatchingEngine({
        priorityRule: rule,
        allowCycles: allowCycles
      });

      const matchOutput = engine.run();
      return sendJson(res, 200, matchOutput);
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

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  🏢 منصة تبادل شقق الموظفين وفق كراسة الشروط الرسمية   `);
  console.log(`  📊 1,100 وحدة بكراسة الشروط (R3 & R5) | 900 متقدم     `);
  console.log(`  🌐 الخادم يعمل بنجاح على: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
