// public/app.js - Multi-Phase Housing Swap Platform with 1-to-1 Direct Marketplace
let state = {
  apartments: [],
  selectedAptId: null,
  swapStatus: 'WANTS_SWAP',
  systemPhase: 'PHASE_1_DIRECT',
  preferences: [],
  adminLoggedIn: false,
  latestMatchData: null,
  catalogPage: 1,
  catalogPageSize: 24,
  catalogDistrict: 'all',
  catalogNeighborhood: '',
  catalogFloor: '',
  catalogStatus: 'all',
  catalogArea: '',
  catalogQuery: ''
};

// Global area bracket matching helper
function checkAreaBracketMatch(apt, bracketKey) {
  if (!bracketKey) return true;
  const area = Number(apt.area);
  switch (bracketKey) {
    case 'r3_114_122':
      return apt.district === 'R3' && area >= 114 && area <= 122;
    case 'r3_136_155':
      return apt.district === 'R3' && area >= 136 && area <= 155;
    case 'r3_170_173':
      return apt.district === 'R3' && area >= 170 && area <= 173;
    case 'r5_86_100':
      return apt.district === 'R5' && area >= 85 && area < 100.5;
    case 'r5_100_120':
      return apt.district === 'R5' && area >= 100.5 && area < 120.5;
    case 'r5_120_140':
      return apt.district === 'R5' && area >= 120.5 && area < 140.5;
    case 'r5_140_160':
      return apt.district === 'R5' && area >= 140.5 && area < 160.5;
    case 'r5_160_180':
      return apt.district === 'R5' && area >= 160.5 && area < 180.5;
    case 'r5_180_200':
      return apt.district === 'R5' && area >= 180.5 && area < 200;
    case 'r5_200_220':
      return apt.district === 'R5' && area >= 200 && area <= 225;
    default:
      return true;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  fetchSystemPhase();
  loadApartments();
  loadStats();
  initFormListeners();
});

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  const bg = type === "success" ? "#16a34a" : (type === "error" ? "#dc2626" : "#2563eb");
  toast.style.cssText = `background: ${bg}; color: white; padding: 0.85rem 1.25rem; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem; min-width: 280px; animation: fadeIn 0.3s ease;`;
  toast.innerHTML = `<span>${type === "success" ? "✅" : (type === "error" ? "⚠️" : "ℹ️")}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.4s";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function initTabs() {
  const buttons = document.querySelectorAll(".nav-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const targetTab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));
      document.getElementById(targetTab).classList.add("active");
      if (targetTab === "tab-catalog") renderCatalog();
      if (targetTab === "tab-admin" && state.adminLoggedIn) loadAdminData();
    });
  });
}

async function fetchSystemPhase() {
  try {
    const res = await fetch("/api/system-phase");
    const data = await res.json();
    if (data.success && data.phase) {
      state.systemPhase = data.phase;
      applySystemPhaseUI(data.phase);
    }
  } catch(e) {
    console.error("Error fetching phase:", e);
  }
}

function applySystemPhaseUI(phase) {
  const headerIndicator = document.getElementById("header-phase-indicator");
  const phase1Banner = document.getElementById("phase1-official-banner");
  const phase1Msg = document.getElementById("phase1-disabled-msg");
  const prefBuilder = document.getElementById("preference-builder-section");

  // Admin Phase Switcher buttons
  [1, 2, 3].forEach(num => {
    const btn = document.getElementById(`phase-btn-${num}`);
    const badge = document.getElementById(`phase-badge-${num}`);
    if (btn && badge) {
      btn.classList.remove('active-phase');
      badge.className = 'phase-btn-badge badge-phase-inactive';
      badge.textContent = 'غير نشط';
    }
  });

  if (phase === 'PHASE_1_DIRECT') {
    if (headerIndicator) headerIndicator.textContent = "المرحلة الحالية: حصر الشقق الأصلية والتواصل المباشر الثنائي (One-to-One)";
    if (phase1Banner) {
      phase1Banner.style.display = "block";
      phase1Banner.className = "official-notice-banner";
      phase1Banner.innerHTML = `
        <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
          <span style="font-size: 2rem; line-height: 1;">📢</span>
          <div>
            <div style="font-weight: 800; font-size: 1.05rem; color: #b45309; margin-bottom: 0.35rem;">
              تنبيه رسمي: مرحلة تسجيل الرغبات مغلقة حالياً، والنظام مخصص الآن لحصر وحدات الفائزة وإتاحة التواصل المباشر بين الزملاء الراغبين في التبديل الثنائي (One-to-One). سيتم فتح تسجيل الرغبات لاحقاً
            </div>
            <div style="font-size: 0.88rem; color: #92400e; line-height: 1.6;">
              يرجى من جميع الزملاء الفائزين بالوحدات تسجيل بياناتهم وجهة عملهم والشقة الأصلية التي رست عليهم بالقرعة. سيتم إتاحة وسيلة التواصل المباشر (الهاتف والواتساب) عبر كتالوج كراسة الشروط للتنسيق الودي الثنائي.
            </div>
          </div>
        </div>
      `;
    }
    if (phase1Msg) phase1Msg.style.display = "block";
    if (prefBuilder) prefBuilder.style.display = "none";

    const btn1 = document.getElementById("phase-btn-1");
    const badge1 = document.getElementById("phase-badge-1");
    if (btn1 && badge1) {
      btn1.classList.add('active-phase');
      badge1.className = 'phase-btn-badge badge-phase-active';
      badge1.textContent = 'المرحلة الحالية النشطة ✔️';
    }

  } else if (phase === 'PHASE_2_PREFERENCES') {
    if (headerIndicator) headerIndicator.textContent = "المرحلة الحالية: تسجيل الرغبات التبادلية (10-20 رغبة) والتوفيق الآلي بالقرعة العشوائية";
    if (phase1Banner) {
      phase1Banner.style.display = "block";
      phase1Banner.className = "official-notice-banner";
      phase1Banner.style.borderColor = "#3b82f6";
      phase1Banner.style.background = "#eff6ff";
      phase1Banner.innerHTML = `
        <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
          <span style="font-size: 2rem; line-height: 1;">🎯</span>
          <div>
            <div style="font-weight: 800; font-size: 1.05rem; color: #1e40af; margin-bottom: 0.35rem;">
              المرحلة الثانية مفتوحة الآن: ترتيب رغبات التبديل (من 10 إلى 20 رغبة بديلة)
            </div>
            <div style="font-size: 0.88rem; color: #1d4ed8; line-height: 1.6;">
              تم فتح باب اختيار الرغبات البديلة من بين الـ 1,100 وحدة بكراسة الشروط الرسمية. سيتم تطبيق خوارزمية السلاسل التبادلية بحل التزاحم بالرقم العشوائي المعتمد.
            </div>
          </div>
        </div>
      `;
    }
    if (phase1Msg) phase1Msg.style.display = "none";
    if (prefBuilder) {
      prefBuilder.style.display = state.swapStatus === 'WANTS_SWAP' ? "block" : "none";
    }

    const btn2 = document.getElementById("phase-btn-2");
    const badge2 = document.getElementById("phase-badge-2");
    if (btn2 && badge2) {
      btn2.classList.add('active-phase');
      badge2.className = 'phase-btn-badge badge-phase-active';
      badge2.textContent = 'المرحلة الحالية النشطة ✔️';
    }

  } else if (phase === 'PHASE_3_RESULTS') {
    if (headerIndicator) headerIndicator.textContent = "المرحلة الحالية: إعلان النتائج الرسمية المعتمدة (باب التسجيل والتعديل مغلق)";
    if (phase1Banner) {
      phase1Banner.style.display = "none"; // Hide standard banner in favor of the dedicated lock card
    }
    if (phase1Msg) phase1Msg.style.display = "none";
    if (prefBuilder) prefBuilder.style.display = "none";

    // Lock and hide the registration form completely
    const regForm = document.getElementById("registration-form");
    const phase3Card = document.getElementById("phase3-closed-card");
    if (regForm) {
      regForm.style.display = "none";
      regForm.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
    }
    if (phase3Card) {
      phase3Card.style.display = "block";
    }

    const btn3 = document.getElementById("phase-btn-3");
    const badge3 = document.getElementById("phase-badge-3");
    if (btn3 && badge3) {
      btn3.classList.add('active-phase');
      badge3.className = 'phase-btn-badge badge-phase-active';
      badge3.textContent = 'المرحلة الحالية النشطة ✔️';
    }
  }
}

async function switchSystemPhase(newPhase) {
  try {
    const res = await fetch("/api/admin/system-phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: newPhase })
    });
    const data = await res.json();
    if (data.success) {
      state.systemPhase = newPhase;
      applySystemPhaseUI(newPhase);
      showToast(data.message, "success");
      loadStats();
      loadApartments();
    } else {
      showToast(data.message || "فشل تغيير المرحلة", "error");
    }
  } catch(e) {
    showToast("حدث خطأ أثناء تغيير مرحلة النظام", "error");
  }
}

async function loadApartments() {
  try {
    const res = await fetch("/api/apartments");
    const data = await res.json();
    if (data.success) {
      state.apartments = data.apartments;
      initCatalogFilters();
      filterPickerApts();
      renderCatalog();
    }
  } catch (err) {
    console.error("Error loading apartments:", err);
  }
}

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    if (data.success) {
      const s = data.stats;
      document.getElementById("kpi-total-apts").textContent = s.totalApts.toLocaleString('ar-EG');
      document.getElementById("kpi-total-users").textContent = s.totalUsers.toLocaleString('ar-EG');
      document.getElementById("kpi-wants-swap").textContent = s.wantingSwap.toLocaleString('ar-EG');
      document.getElementById("kpi-agreed-direct").textContent = (s.agreedDirect || 0).toLocaleString('ar-EG');
      document.getElementById("kpi-keeping-apt").textContent = s.keepingApt.toLocaleString('ar-EG');
      if (s.systemPhase) {
        state.systemPhase = s.systemPhase;
        applySystemPhaseUI(s.systemPhase);
      }
    }
  } catch (err) {
    console.error("Error loading stats:", err);
  }
}

function initFormListeners() {
  const nidInput = document.getElementById("reg-nid");
  nidInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    const feedback = document.getElementById("nid-feedback");
    if (val.length === 14) {
      const century = val[0] === '2' ? '19' : (val[0] === '3' ? '20' : null);
      if (century) {
        const year = century + val.substring(1, 3);
        const month = val.substring(3, 5);
        const day = val.substring(5, 7);
        const age = new Date().getFullYear() - parseInt(year);
        feedback.innerHTML = `<span style="color: #16a34a; font-weight: bold;">تاريخ الميلاد: ${day}/${month}/${year} (السن التقديري: ${age} سنة)</span>`;
      }
    } else {
      feedback.textContent = "يتم استخراج تاريخ الميلاد والسن تلقائياً";
    }
  });

  const form = document.getElementById("registration-form");
  form.addEventListener("submit", handleRegistrationSubmit);
}

// =========================================================
// SWAP STATUS CONTROLLER (3 CHOICES)
// =========================================================
function setSwapStatus(status) {
  state.swapStatus = status;

  const choiceSwap = document.getElementById("choice-status-swap");
  const choiceAgreed = document.getElementById("choice-status-agreed");
  const choiceKept = document.getElementById("choice-status-kept");
  const prefBuilder = document.getElementById("preference-builder-section");

  [choiceSwap, choiceAgreed, choiceKept].forEach(el => {
    if (el) {
      el.className = "decision-choice-3";
      const rad = el.querySelector('input');
      if (rad) rad.checked = false;
    }
  });

  if (status === 'WANTS_SWAP') {
    choiceSwap.className = "decision-choice-3 selected";
    choiceSwap.querySelector('input').checked = true;
    if (state.systemPhase === 'PHASE_2_PREFERENCES' && prefBuilder) {
      prefBuilder.style.display = "block";
    }
  } else if (status === 'AGREED_DIRECT') {
    choiceAgreed.className = "decision-choice-3 selected-agreed";
    choiceAgreed.querySelector('input').checked = true;
    if (prefBuilder) prefBuilder.style.display = "none";
  } else if (status === 'KEPT_ORIGINAL') {
    choiceKept.className = "decision-choice-3 selected-kept";
    choiceKept.querySelector('input').checked = true;
    if (prefBuilder) prefBuilder.style.display = "none";
  }
}

// =========================================================
// CASCADING SELECTORS FOR WON APARTMENT (TAB 1)
// =========================================================
function onDistrictSelected() {
  const district = document.getElementById("reg-district-select").value;
  const nhSelect = document.getElementById("reg-nh-select");
  const bldgSelect = document.getElementById("reg-bldg-select");
  const unitSelect = document.getElementById("reg-unit-select");

  nhSelect.innerHTML = '<option value="">-- اختر المجاورة --</option>';
  bldgSelect.innerHTML = '<option value="">-- اختر المجاورة أولاً --</option>';
  bldgSelect.disabled = true;
  unitSelect.innerHTML = '<option value="">-- اختر المبنى أولاً --</option>';
  unitSelect.disabled = true;
  state.selectedAptId = null;
  showOwnedApartmentPreview();

  if (!district) {
    nhSelect.disabled = true;
    return;
  }

  nhSelect.disabled = false;
  const nhs = [...new Set(state.apartments.filter(a => a.district === district).map(a => a.neighborhood))].sort();
  nhs.forEach(nh => {
    const count = state.apartments.filter(a => a.district === district && a.neighborhood === nh).length;
    const opt = document.createElement("option");
    opt.value = nh;
    opt.textContent = `المجاورة ${nh} (${count} وحدة)`;
    nhSelect.appendChild(opt);
  });
}

function onNeighborhoodSelected() {
  const district = document.getElementById("reg-district-select").value;
  const nh = document.getElementById("reg-nh-select").value;
  const bldgSelect = document.getElementById("reg-bldg-select");
  const unitSelect = document.getElementById("reg-unit-select");

  bldgSelect.innerHTML = '<option value="">-- اختر رقم المبنى / العمارة --</option>';
  unitSelect.innerHTML = '<option value="">-- اختر المبنى أولاً --</option>';
  unitSelect.disabled = true;
  state.selectedAptId = null;
  showOwnedApartmentPreview();

  if (!nh) {
    bldgSelect.disabled = true;
    return;
  }

  bldgSelect.disabled = false;
  const bldgs = [...new Set(state.apartments.filter(a => a.district === district && a.neighborhood === nh).map(a => a.building))].sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
  bldgs.forEach(bldg => {
    const count = state.apartments.filter(a => a.district === district && a.neighborhood === nh && a.building === bldg).length;
    const opt = document.createElement("option");
    opt.value = bldg;
    opt.textContent = `مبنى ${bldg} (${count} وحدة)`;
    bldgSelect.appendChild(opt);
  });
}

function onBuildingSelected() {
  const district = document.getElementById("reg-district-select").value;
  const nh = document.getElementById("reg-nh-select").value;
  const bldg = document.getElementById("reg-bldg-select").value;
  const unitSelect = document.getElementById("reg-unit-select");

  unitSelect.innerHTML = '<option value="">-- اختر رقم الوحدة --</option>';
  state.selectedAptId = null;
  showOwnedApartmentPreview();

  if (!bldg) {
    unitSelect.disabled = true;
    return;
  }

  unitSelect.disabled = false;
  const units = state.apartments.filter(a => a.district === district && a.neighborhood === nh && a.building === bldg);
  units.sort((a, b) => a.id - b.id);

  units.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `وحدة ${u.unit_number} - ${u.floor_label} (نموذج ${u.model} - ${u.area}م²)`;
    unitSelect.appendChild(opt);
  });
}

function onUnitSelected() {
  const unitId = document.getElementById("reg-unit-select").value;
  state.selectedAptId = unitId ? Number(unitId) : null;
  showOwnedApartmentPreview();

  if (state.selectedAptId) {
    state.preferences = state.preferences.filter(p => p.id !== state.selectedAptId);
    renderPreferencesList();
    filterPickerApts();
  }
}

function onQuickPropertyIdInput() {
  const raw = document.getElementById("reg-quick-nid").value.trim().toUpperCase();
  if (!raw || raw.length < 4) return;

  const apt = state.apartments.find(a => 
    a.national_property_id === raw || 
    a.code.toUpperCase() === raw ||
    a.national_property_id.endsWith(raw)
  );

  if (apt) {
    document.getElementById("reg-district-select").value = apt.district;
    onDistrictSelected();
    document.getElementById("reg-nh-select").value = apt.neighborhood;
    onNeighborhoodSelected();
    document.getElementById("reg-bldg-select").value = apt.building;
    onBuildingSelected();
    document.getElementById("reg-unit-select").value = apt.id;
    state.selectedAptId = apt.id;
    showOwnedApartmentPreview();
  }
}

function showOwnedApartmentPreview() {
  const preview = document.getElementById("owned-apt-preview");
  const details = document.getElementById("owned-apt-details");
  if (!state.selectedAptId) {
    preview.style.display = "none";
    return;
  }

  const apt = state.apartments.find(a => a.id === state.selectedAptId);
  if (!apt) return;

  preview.style.display = "block";
  const districtName = apt.district === 'R3' ? 'الحي الثالث (R3)' : 'جاردن سيتي (R5)';
  details.innerHTML = `
    <div><strong>الحي:</strong> <span class="tag-dist">${districtName}</span></div>
    <div><strong>المجاورة:</strong> ${apt.neighborhood}</div>
    <div><strong>رقم المبنى / العمارة:</strong> ${apt.building}</div>
    <div><strong>رقم الوحدة:</strong> <span style="font-weight: 800; color: #1e3a8a;">${apt.unit_number}</span></div>
    <div><strong>الدور:</strong> ${apt.floor_label}</div>
    <div><strong>النموذج:</strong> ${apt.model}</div>
    <div><strong>المساحة:</strong> ${apt.area} م²</div>
    <div><strong>نسبة التميز:</strong> ${apt.distinction}</div>
    <div><strong>سعر المتر:</strong> ${apt.meter_price.toLocaleString('ar-EG')} ج.م</div>
    <div><strong>إجمالي السعر التقديري:</strong> ${apt.total_price.toLocaleString('ar-EG')} ج.م</div>
    <div style="grid-column: 1/-1;">
      <strong>الرقم القومي العقاري للوحدة:</strong> 
      <span style="font-family: monospace; font-size: 0.95rem; color: #0284c7; background: #e0f2fe; padding: 2px 8px; border-radius: 4px;">${apt.national_property_id}</span>
    </div>
  `;
}

// =========================================================
// PREFERENCES PICKER & RANKING (PHASE 2)
// =========================================================
function onPickerDistrictChanged() {
  const dist = document.getElementById("picker-filter-district").value;
  const nhSelect = document.getElementById("picker-filter-nh");
  nhSelect.innerHTML = '<option value="">جميع المجاورات</option>';

  let eligibleApts = state.apartments;
  if (dist) eligibleApts = eligibleApts.filter(a => a.district === dist);

  const nhs = [...new Set(eligibleApts.map(a => a.neighborhood))].sort();
  nhs.forEach(nh => {
    const opt = document.createElement("option");
    opt.value = nh;
    opt.textContent = `مجاورة ${nh}`;
    nhSelect.appendChild(opt);
  });

  // Reset area filter if it belongs to another district
  const areaSel = document.getElementById("picker-filter-area");
  if (areaSel && areaSel.value) {
    if (dist === 'R3' && areaSel.value.startsWith('r5_')) areaSel.value = '';
    if (dist === 'R5' && areaSel.value.startsWith('r3_')) areaSel.value = '';
  }

  filterPickerApts();
}

function filterPickerApts() {
  const dist = document.getElementById("picker-filter-district") ? document.getElementById("picker-filter-district").value : "";
  const nh = document.getElementById("picker-filter-nh") ? document.getElementById("picker-filter-nh").value : "";
  const flr = document.getElementById("picker-filter-floor") ? document.getElementById("picker-filter-floor").value : "";
  const areaKey = document.getElementById("picker-filter-area") ? document.getElementById("picker-filter-area").value : "";
  const query = (document.getElementById("picker-search-input") ? document.getElementById("picker-search-input").value : "").toLowerCase().trim();
  const list = document.getElementById("picker-apts-list");
  if (!list) return;
  list.innerHTML = "";

  const selectedIds = new Set(state.preferences.map(p => p.id));
  if (state.selectedAptId) selectedIds.add(state.selectedAptId);

  let filtered = state.apartments.filter(apt => {
    if (selectedIds.has(apt.id)) return false;
    if (dist && apt.district !== dist) return false;
    if (nh && apt.neighborhood !== nh) return false;
    if (areaKey && !checkAreaBracketMatch(apt, areaKey)) return false;

    if (flr) {
      if (flr === 'upper') {
        if (apt.floor < 6) return false;
      } else {
        if (String(apt.floor) !== flr) return false;
      }
    }

    if (query) {
      const match = apt.building.toLowerCase().includes(query) ||
                    apt.unit_number.toLowerCase().includes(query) ||
                    apt.model.toLowerCase().includes(query) ||
                    apt.national_property_id.includes(query) ||
                    apt.code.toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  const displayed = filtered.slice(0, 50);

  if (displayed.length === 0) {
    list.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1.5rem;">لا توجد شقق مطابقة للبحث أو تم اختيارها كلها</div>`;
    return;
  }

  displayed.forEach(apt => {
    const item = document.createElement("div");
    item.className = "picker-item";
    const distBadge = apt.district === 'R3' ? '<span class="badge-r3">R3</span>' : '<span class="badge-r5">R5</span>';
    item.innerHTML = `
      <div>
        <div style="font-weight: 800; color: #1e3a8a; display: flex; align-items: center; gap: 0.4rem;">
          ${distBadge}
          <span>مجاورة ${apt.neighborhood} - مبنى ${apt.building} - وحدة ${apt.unit_number}</span>
        </div>
        <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">
          ${apt.floor_label} | نموذج ${apt.model} (${apt.area}م²) | ${apt.meter_price.toLocaleString('ar-EG')} ج/م²
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; font-family: monospace;">
          رقم عقاري: ${apt.national_property_id}
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="addPreference(${apt.id})">➕ اختيار</button>
    `;
    list.appendChild(item);
  });
}

function addPreference(aptId) {
  if (state.preferences.length >= 20) {
    showToast("وصلت للحد الأقصى (20 رغبة)", "error");
    return;
  }
  if (aptId === state.selectedAptId) {
    showToast("لا يمكنك اختيار شقتك الأصلية ضمن رغبات التبديل!", "error");
    return;
  }
  const apt = state.apartments.find(a => a.id === aptId);
  if (!apt) return;
  state.preferences.push(apt);
  renderPreferencesList();
  filterPickerApts();
}

function removePreference(index) {
  state.preferences.splice(index, 1);
  renderPreferencesList();
  filterPickerApts();
}

function movePreference(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= state.preferences.length) return;
  const temp = state.preferences[index];
  state.preferences[index] = state.preferences[targetIndex];
  state.preferences[targetIndex] = temp;
  renderPreferencesList();
}

function clearAllPreferences() {
  state.preferences = [];
  renderPreferencesList();
  filterPickerApts();
}

function renderPreferencesList() {
  const container = document.getElementById("selected-preferences-container");
  const countBadge = document.getElementById("pref-count-badge");
  if (!container || !countBadge) return;
  countBadge.textContent = `${state.preferences.length} / 20 رغبة`;

  if (state.preferences.length === 0) {
    container.innerHTML = `<div id="empty-pref-msg" style="text-align: center; color: var(--text-muted); padding: 2rem;">لم تختر أي رغبات بعد.<br>اختر شققاً من القائمة على اليمين لإضافتها حسب أولوياتك (من 10 إلى 20 رغبة).</div>`;
    return;
  }

  container.innerHTML = "";
  state.preferences.forEach((apt, idx) => {
    const item = document.createElement("div");
    item.className = "preference-item";
    const distBadge = apt.district === 'R3' ? '<span class="badge-r3">R3</span>' : '<span class="badge-r5">R5</span>';
    item.innerHTML = `
      <div class="pref-rank-badge">#${idx + 1}</div>
      <div class="pref-details">
        <div style="font-weight: 800; color: #1e3a8a; display: flex; align-items: center; gap: 0.4rem;">
          ${distBadge}
          <span>مجاورة ${apt.neighborhood} - مبنى ${apt.building} - وحدة ${apt.unit_number}</span>
        </div>
        <div style="font-size: 0.8rem; color: #64748b;">
          ${apt.floor_label} | نموذج ${apt.model} (${apt.area}م²) | ${apt.meter_price.toLocaleString('ar-EG')} ج/م²
        </div>
      </div>
      <div class="pref-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="movePreference(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>⬆️</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="movePreference(${idx}, 1)" ${idx === state.preferences.length - 1 ? 'disabled' : ''}>⬇️</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="removePreference(${idx})">❌</button>
      </div>
    `;
    container.appendChild(item);
  });
}

async function handleRegistrationSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("reg-name").value.trim();
  const nid = document.getElementById("reg-nid").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const workplace = document.getElementById("reg-workplace").value.trim();
  const origApt = state.selectedAptId;

  if (!origApt) {
    showToast("يرجى تحديد الشقة التي رست عليك في القرعة من كراسة الشروط", "error");
    return;
  }

  if (!workplace) {
    showToast("يرجى كتابة اسم الوزارة أو جهة العمل", "error");
    return;
  }

  if (state.systemPhase === 'PHASE_2_PREFERENCES' && state.swapStatus === 'WANTS_SWAP' && state.preferences.length === 0) {
    showToast("طالما اخترت التبديل، يرجى اختيار رغبة واحدة على الأقل من كراسة الشروط", "error");
    return;
  }

  const payload = {
    fullName: name,
    nationalId: nid,
    phone: phone,
    workplace: workplace,
    originalApartmentId: origApt,
    wantsSwap: state.swapStatus === 'WANTS_SWAP' ? 1 : 0,
    swapStatus: state.swapStatus,
    preferences: (state.systemPhase === 'PHASE_2_PREFERENCES' && state.swapStatus === 'WANTS_SWAP') ? state.preferences.map(p => p.id) : []
  };

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast("تم حفظ بياناتك بنجاح وحساب رقمك العشوائي المعتمد للمفاضلة!", "success");
      renderReceipt(data.user);
      loadStats();
      loadApartments();
    } else {
      showToast(data.message || "فشل حفظ البيانات", "error");
    }
  } catch (err) {
    showToast("حدث خطأ أثناء الاتصال بالخادم", "error");
  }
}

function renderReceipt(user) {
  const container = document.getElementById("receipt-container");
  container.style.display = "block";
  const originalApt = state.apartments.find(a => a.id === user.original_apartment_id);

  let statusLabel = 'أرغب في التبديل والتواصل المباشر (One-to-One)';
  let statusColor = '#16a34a';
  if (user.swap_status === 'AGREED_DIRECT') {
    statusLabel = 'تم التوافق الودي ولا أرغب في التبديل';
    statusColor = '#b45309';
  } else if (user.swap_status === 'KEPT_ORIGINAL') {
    statusLabel = 'محتفظ بالشقة الأصلية (لا أرغب في التبديل)';
    statusColor = '#64748b';
  }

  container.innerHTML = `
    <div class="receipt-box" id="official-receipt">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 1rem; margin-bottom: 1.25rem;">
        <div>
          <h2 style="font-size: 1.3rem; color: #1e3a8a; font-weight: 800;">إيصال تسجيل استمارة وحدات العاملين الرسمية (كراسة الشروط)</h2>
          <div style="font-size: 0.85rem; color: var(--text-muted);">المنظومة المركزية لتوفيق رغبات شقق العاصمة الإدارية (1,100 وحدة)</div>
        </div>
        <div style="text-align: left;">
          <div style="font-weight: 800; font-size: 1.15rem; color: #d97706; background: #fef3c7; padding: 0.3rem 0.8rem; border-radius: 8px;">
            🎲 رقم القرعة المعتمد: #${user.random_priority_number || '000000'}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">كود التسجيل: ${user.confirmation_code || 'SWAP-OK'}</div>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom: 1.25rem;">
        <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; font-size: 0.9rem;">
          <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 0.5rem;">بيانات الموظف وجهة العمل:</div>
          <div><strong>الاسم بالكامل:</strong> ${user.full_name}</div>
          <div><strong>الرقم القومي:</strong> ${user.national_id}</div>
          <div><strong>رقم المحمول:</strong> ${user.phone}</div>
          <div><strong>الوزارة / جهة العمل:</strong> <span style="font-weight: 700; color: #1e3a8a;">${user.workplace || '-'}</span></div>
          <div><strong>رقم المفاضلة بالقرعة:</strong> <span style="font-weight: bold; color: #d97706;">#${user.random_priority_number}</span></div>
        </div>

        <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; font-size: 0.9rem;">
          <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 0.5rem;">الشقة الفائز بها من واقع كراسة الشروط:</div>
          <div><strong>الموقع:</strong> ${originalApt ? `${originalApt.district} - مجاورة ${originalApt.neighborhood} - مبنى ${originalApt.building} - وحدة ${originalApt.unit_number}` : ''}</div>
          <div><strong>الدور والنموذج:</strong> ${originalApt ? `${originalApt.floor_label} - نموذج ${originalApt.model} (${originalApt.area} م²)` : ''}</div>
          <div><strong>الرقم القومي العقاري:</strong> ${originalApt ? originalApt.national_property_id : ''}</div>
          <div style="margin-top: 4px;"><strong>الموقف من التبديل:</strong> <span style="font-weight: bold; color: ${statusColor};">${statusLabel}</span></div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed #cbd5e1;">
        <div style="font-size: 0.8rem; color: #64748b;">
          * في حال التبديل الثنائي المباشر، يمكنك التواصل مع الزميل مباشرة عبر الكتالوج وإتمام التبديل.<br>
          * لا يتم إخراج أي موظف من شقته الأصلية إلا بموافقته وحصوله على إحدى رغباته المعتمدة.
        </div>
        <div class="no-print">
          <button class="btn btn-primary" onclick="window.print()">🖨️ طباعة الإيصال الرسمي</button>
        </div>
      </div>
    </div>
  `;
  container.scrollIntoView({ behavior: "smooth" });
}

// =========================================================
// CATALOG VIEW (TAB 2) WITH DIRECT 1-TO-1 ACTIONS
// =========================================================
function initCatalogFilters() {
  const nhSelect = document.getElementById("catalog-nh-filter");
  if (!nhSelect) return;
  nhSelect.innerHTML = '<option value="">جميع المجاورات</option>';
  const nhs = [];
  const seenNh = new Set();
  state.apartments.forEach(a => {
    if (!seenNh.has(a.neighborhood)) {
      seenNh.add(a.neighborhood);
      nhs.push(a.neighborhood);
    }
  });
  nhs.forEach(nh => {
    const opt = document.createElement("option");
    opt.value = nh;
    opt.textContent = `مجاورة ${nh}`;
    nhSelect.appendChild(opt);
  });
}

function filterCatalogByDistrict(dist, btn) {
  state.catalogDistrict = dist;
  state.catalogPage = 1;
  document.querySelectorAll('#tab-catalog .active-filter').forEach(b => b.classList.remove('active-filter'));
  btn.classList.add('active-filter');

  // If area filter conflicts with new district, reset area filter
  if (state.catalogArea) {
    if (dist === 'R3' && state.catalogArea.startsWith('r5_')) {
      state.catalogArea = '';
      const sel = document.getElementById("catalog-area-filter");
      if (sel) sel.value = '';
    } else if (dist === 'R5' && state.catalogArea.startsWith('r3_')) {
      state.catalogArea = '';
      const sel = document.getElementById("catalog-area-filter");
      if (sel) sel.value = '';
    }
  }

  renderCatalog();
}

function onCatalogAreaChanged() {
  const sel = document.getElementById("catalog-area-filter");
  state.catalogArea = sel ? sel.value : "";
  state.catalogPage = 1;

  if (state.catalogArea.startsWith("r3_") && state.catalogDistrict === "R5") {
    state.catalogDistrict = "R3";
    updateCatalogDistrictButtons("R3");
  } else if (state.catalogArea.startsWith("r5_") && state.catalogDistrict === "R3") {
    state.catalogDistrict = "R5";
    updateCatalogDistrictButtons("R5");
  }

  renderCatalog();
}

function updateCatalogDistrictButtons(dist) {
  document.querySelectorAll('#tab-catalog .btn-outline').forEach(b => {
    const txt = b.textContent || '';
    if (dist === 'R3' && txt.includes('R3')) {
      document.querySelectorAll('#tab-catalog .active-filter').forEach(x => x.classList.remove('active-filter'));
      b.classList.add('active-filter');
    } else if (dist === 'R5' && txt.includes('R5')) {
      document.querySelectorAll('#tab-catalog .active-filter').forEach(x => x.classList.remove('active-filter'));
      b.classList.add('active-filter');
    } else if (dist === 'all' && txt.includes('الكل')) {
      document.querySelectorAll('#tab-catalog .active-filter').forEach(x => x.classList.remove('active-filter'));
      b.classList.add('active-filter');
    }
  });
}

function onCatalogNeighborhoodChanged() {
  state.catalogNeighborhood = document.getElementById("catalog-nh-filter").value;
  state.catalogPage = 1;
  renderCatalog();
}

function onCatalogFloorChanged() {
  state.catalogFloor = document.getElementById("catalog-floor-filter").value;
  state.catalogPage = 1;
  renderCatalog();
}

function onCatalogStatusFilterChanged() {
  state.catalogStatus = document.getElementById("catalog-status-filter").value;
  state.catalogPage = 1;
  renderCatalog();
}

function onCatalogSearch() {
  state.catalogQuery = document.getElementById("catalog-search").value.toLowerCase().trim();
  state.catalogPage = 1;
  renderCatalog();
}

function changeCatalogPage(delta) {
  state.catalogPage += delta;
  renderCatalog();
  document.getElementById("tab-catalog").scrollIntoView({ behavior: "smooth" });
}

function renderCatalog() {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;
  const query = state.catalogQuery;

  let filtered = state.apartments.filter(a => {
    if (state.catalogDistrict !== 'all' && a.district !== state.catalogDistrict) return false;
    if (state.catalogNeighborhood && a.neighborhood !== state.catalogNeighborhood) return false;
    if (state.catalogArea && !checkAreaBracketMatch(a, state.catalogArea)) return false;

    if (state.catalogFloor) {
      if (state.catalogFloor === 'upper') {
        if (a.floor < 6) return false;
      } else {
        if (String(a.floor) !== state.catalogFloor) return false;
      }
    }

    if (state.catalogStatus !== 'all') {
      const st = a.owner_swap_status || (a.owner_name ? 'WANTS_SWAP' : 'UNREGISTERED');
      if (state.catalogStatus === 'UNREGISTERED') {
        if (a.owner_name) return false;
      } else {
        if (st !== state.catalogStatus) return false;
      }
    }

    if (query) {
      const match = a.building.toLowerCase().includes(query) ||
                    a.unit_number.toLowerCase().includes(query) ||
                    a.model.toLowerCase().includes(query) ||
                    a.national_property_id.includes(query) ||
                    (a.owner_name && a.owner_name.toLowerCase().includes(query)) ||
                    (a.owner_workplace && a.owner_workplace.toLowerCase().includes(query)) ||
                    a.code.toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.catalogPageSize));
  state.catalogPage = Math.max(1, Math.min(state.catalogPage, totalPages));

  const pageInfo = document.getElementById("catalog-page-info");
  if (pageInfo) pageInfo.textContent = `صفحة ${state.catalogPage} من ${totalPages} (${filtered.length} وحدة)`;
  const prevBtn = document.getElementById("btn-prev-page");
  if (prevBtn) prevBtn.disabled = state.catalogPage === 1;
  const nextBtn = document.getElementById("btn-next-page");
  if (nextBtn) nextBtn.disabled = state.catalogPage === totalPages;

  const startIndex = (state.catalogPage - 1) * state.catalogPageSize;
  const pageUnits = filtered.slice(startIndex, startIndex + state.catalogPageSize);

  grid.innerHTML = "";
  if (pageUnits.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">لا توجد وحدات مطابقة للبحث في كراسة الشروط</div>`;
    return;
  }

  pageUnits.forEach(apt => {
    const isOwned = state.selectedAptId === apt.id;
    const isPref = state.preferences.some(p => p.id === apt.id);
    const distBadge = apt.district === 'R3' ? '<span class="badge-r3">الحي R3</span>' : '<span class="badge-r5">جاردن سيتي R5</span>';

    // Status & Owner rendering
    let ownerHtml = "";
    if (apt.owner_name) {
      const st = apt.owner_swap_status || 'WANTS_SWAP';
      const cleanPhone = (apt.owner_phone || '').replace(/\D/g, '').replace(/^0/, '');
      const waMsg = encodeURIComponent(`السلام عليكم أستاذ ${apt.owner_name}، بخصوص شقتكم في كراسة الشروط (عمارة ${apt.building}، شقة ${apt.unit_number}، حي ${apt.district})، أنا زميلكم وأرغب في التنسيق معكم للتبادل الثنائي الودي.`);

      if (st === 'WANTS_SWAP') {
        ownerHtml = `
          <div class="catalog-owner-box" style="border-right: 3px solid #16a34a; background: #f0fdf4;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: 800; color: #166534;">👤 ${apt.owner_name}</span>
              <span style="font-size: 0.72rem; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-weight: 700;">🟢 معروضة للتبادل</span>
            </div>
            <div style="font-size: 0.76rem; color: #15803d; margin-bottom: 6px;">
              🏛️ <strong>الوزارة:</strong> ${apt.owner_workplace || 'غير محددة'}
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              <a href="https://wa.me/20${cleanPhone}?text=${waMsg}" target="_blank" class="btn-whatsapp">
                💬 واتساب مباشر
              </a>
              <a href="tel:${apt.owner_phone}" class="btn-call">
                📞 ${apt.owner_phone}
              </a>
            </div>
          </div>
        `;
      } else if (st === 'AGREED_DIRECT') {
        ownerHtml = `
          <div class="catalog-owner-box" style="border-right: 3px solid #d97706; background: #fffbeb;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; color: #b45309;">👤 ${apt.owner_name}</span>
              <span style="font-size: 0.72rem; background: #fef3c7; color: #b45309; padding: 2px 6px; border-radius: 4px; font-weight: 700;">🤝 تم التوافق الودي</span>
            </div>
            <div style="font-size: 0.76rem; color: #92400e; margin-top: 2px;">
              🏛️ ${apt.owner_workplace || ''} (الوحدة محجوزة مسبقاً)
            </div>
          </div>
        `;
      } else {
        ownerHtml = `
          <div class="catalog-owner-box" style="border-right: 3px solid #64748b; background: #f8fafc;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; color: #475569;">👤 ${apt.owner_name}</span>
              <span style="font-size: 0.72rem; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 700;">🛡️ محتفظ بها</span>
            </div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 2px;">
              🏛️ ${apt.owner_workplace || ''} (غير متاحة للتبادل)
            </div>
          </div>
        `;
      }
    } else {
      ownerHtml = `
        <div class="catalog-owner-box" style="background: #f8fafc; color: #94a3b8; text-align: center; font-size: 0.76rem;">
          ⚪ لم يسجل صاحب الوحدة بياناته بعد
        </div>
      `;
    }

    const card = document.createElement("div");
    card.className = `apt-card ${isOwned ? 'selected-owned' : ''}`;
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
        <div>
          ${distBadge}
          <span class="apt-tag tag-mid">مجاورة ${apt.neighborhood}</span>
        </div>
        <div style="font-weight: 800; color: var(--primary); font-size: 1.1rem;">مبنى ${apt.building}</div>
      </div>

      <div style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin-bottom: 0.4rem;">
        وحدة ${apt.unit_number} <span style="font-size: 0.8rem; color: #64748b; font-weight: 600;">(${apt.floor_label})</span>
      </div>

      <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.4rem;">
        <div><strong>النموذج والمساحة:</strong> نموذج ${apt.model} (${apt.area} م²)</div>
        <div><strong>نسبة التميز:</strong> ${apt.distinction} | <strong>سعر المتر:</strong> ${apt.meter_price.toLocaleString('ar-EG')} ج.م</div>
        <div><strong>إجمالي السعر:</strong> ${apt.total_price.toLocaleString('ar-EG')} ج.م</div>
        <div style="margin-top: 4px; font-family: monospace; font-size: 0.72rem; color: #0284c7; background: #f0f9ff; padding: 2px 4px; border-radius: 4px; word-break: break-all;">
          عقاري: ${apt.national_property_id}
        </div>
      </div>

      <!-- Owner & Direct Contact Box -->
      ${ownerHtml}

      ${state.systemPhase === 'PHASE_2_PREFERENCES' ? `
        <div style="border-top: 1px solid var(--border); margin-top: 0.6rem; padding-top: 0.6rem; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.8rem; color: #d97706; font-weight: 700;">
            ${apt.demand_count > 0 ? `🔥 مطلوب ${apt.demand_count} مرة` : '✨ متاح'}
          </span>
          ${isOwned ? `
            <span style="font-size: 0.8rem; color: #16a34a; font-weight: bold;">شقتك الأصلية ✔️</span>
          ` : (isPref ? `
            <span style="font-size: 0.8rem; color: #2563eb; font-weight: bold;">مضافة للرغبات ⭐</span>
          ` : `
            <button class="btn btn-outline btn-sm" onclick="addPreferenceFromCatalog(${apt.id})">➕ إضافة للرغبات</button>
          `)}
        </div>
      ` : ''}
    `;
    grid.appendChild(card);
  });
}

function addPreferenceFromCatalog(aptId) {
  addPreference(aptId);
  renderCatalog();
  showToast("تمت إضافة الشقة لقائمة رغباتك", "success");
}

// =========================================================
// RESULTS LOOKUP (TAB 3)
// =========================================================
async function queryResult() {
  const nid = document.getElementById("query-nid").value.trim();
  const display = document.getElementById("result-display-area");
  if (!nid || nid.length !== 14) {
    showToast("يرجى إدخال الرقم القومي المكون من 14 رقماً", "error");
    return;
  }

  display.style.display = "block";
  display.innerHTML = `<div style="text-align: center; padding: 2rem;">جاري البحث عن النتيجة المعتمدة... ⏳</div>`;

  try {
    const res = await fetch(`/api/result/${nid}`);
    const data = await res.json();

    if (!data.success) {
      display.innerHTML = `
        <div style="background: #fff1f2; border: 1.5px solid #fecdd3; padding: 1.5rem; border-radius: 12px; text-align: center;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <div style="font-weight: 800; color: #9f1239; font-size: 1.1rem;">${data.message || 'لم يتم العثور على موظف مسجل بهذا الرقم القومي'}</div>
          <div style="color: #be123c; font-size: 0.85rem; margin-top: 0.5rem;">يرجى التأكد من كتابة الرقم القومي صحيحاً (14 رقماً)، أو تسجيل بياناتك أولاً في المنصة.</div>
        </div>
      `;
      return;
    }

    if (data.published === false) {
      display.innerHTML = `
        <div style="background: #eff6ff; border: 2px dashed #3b82f6; padding: 2rem; border-radius: 12px; text-align: center;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⏳</div>
          <div style="font-weight: 800; color: #1e3a8a; font-size: 1.25rem; margin-bottom: 0.5rem;">
            لم يتم اعتماد النتيجة بعد ولم يتم النشر
          </div>
          <div style="color: #2563eb; font-size: 0.95rem; line-height: 1.6; max-width: 620px; margin: 0 auto;">
            ${data.message || 'عذراً، النتائج الرسمية لم تُعتمد وتُنشر بعد من قبل لجنة الإسكان. يرجى المتابعة لاحقاً بعد انتهاء لجنة الإسكان من الاعتماد الرسمي للنتائج.'}
          </div>
          <div style="margin-top: 1.25rem; font-size: 0.85rem; color: #64748b; background: white; display: inline-block; padding: 6px 16px; border-radius: 20px; border: 1px solid #cbd5e1;">
            💡 سيتم إتاحة استعلام النتائج لجميع الزملاء فور ضغط زر الاعتماد والنشر من لوحة الإدارة.
          </div>
        </div>
      `;
      return;
    }

    const r = data.result;
    if (!r) {
      display.innerHTML = `
        <div style="background: #fff1f2; border: 1.5px solid #fecdd3; padding: 1.5rem; border-radius: 12px; text-align: center;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
          <div style="font-weight: 800; color: #9f1239; font-size: 1.1rem;">لم تسجل بيانات مشاركة في هذه القرعة بهذا الرقم القومي</div>
        </div>
      `;
      return;
    }
    const isSwapped = r.swap_type !== 'KEPT_ORIGINAL';

    display.innerHTML = `
      <div style="background: white; border: 2px solid ${isSwapped ? '#16a34a' : '#d97706'}; border-radius: 12px; padding: 1.5rem; box-shadow: var(--shadow-lg);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 1rem; margin-bottom: 1.25rem;">
          <div>
            <h3 style="font-size: 1.25rem; color: #1e3a8a; font-weight: 800;">إخطار تخصيص شقة الموظف المعتمد رسمياً</h3>
            <div style="font-size: 0.85rem; color: var(--text-muted);">كراسة الشروط الرسمية (1,100 وحدة) بالعاصمة الإدارية الجديدة</div>
          </div>
          <div style="text-align: left;">
            <div style="font-size: 0.95rem; font-weight: 800; color: #d97706; background: #fef3c7; padding: 0.3rem 0.8rem; border-radius: 8px;">
              🎲 قرعة #${r.random_priority_number || '-'}
            </div>
          </div>
        </div>

        <div style="background: ${isSwapped ? '#f0fdf4' : '#fffbeb'}; border: 1px solid ${isSwapped ? '#bbf7d0' : '#fef08a'}; padding: 1rem; border-radius: 8px; margin-bottom: 1.25rem;">
          <div style="font-size: 1.15rem; font-weight: 800; color: ${isSwapped ? '#166534' : '#854d0e'};">
            ${isSwapped ? `🎉 تم التوفيق بنجاح وحصلت على (الرغبة #${r.rank_achieved})!` : '🛡️ تم الحفاظ على شقتك الأصلية 100%'}
          </div>
          <div style="font-size: 0.85rem; color: ${isSwapped ? '#15803d' : '#a16207'}; margin-top: 0.25rem;">
            ${isSwapped ? `نوع التبادل: ${r.swap_type === 'DIRECT_PAIR' ? 'تبادل ثنائي مباشر' : 'دورة تبادلية متعددة الأطراف'}` : 'لم تتوفر دورة تبادل تحقق رغباتك المسجلة، وبموجب النظام تحتفظ بشقتك كاملة دون أي مساس بها.'}
          </div>
        </div>

        <div class="grid-2" style="margin-bottom: 1.25rem;">
          <div style="border: 1px solid #cbd5e1; padding: 1rem; border-radius: 8px;">
            <div style="font-weight: 700; color: #64748b; margin-bottom: 0.4rem;">الشقة الأصلية التي فزت بها:</div>
            <div style="font-size: 1.05rem; font-weight: 800; color: #0f172a;">${r.orig_district} - مجاورة ${r.orig_neighborhood} - مبنى ${r.orig_building || r.orig_bld || ''}</div>
            <div>وحدة ${r.orig_unit} (${r.orig_floor_label || r.orig_fl_label || ''})</div>
            <div style="font-size: 0.85rem; color: #64748b;">نموذج ${r.orig_model} (${r.orig_area} م²) - ${(r.orig_price || 0).toLocaleString('ar-EG')} ج/م²</div>
            <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace; margin-top: 4px;">عقاري: ${r.orig_nat_id}</div>
          </div>

          <div style="border: 2px solid ${isSwapped ? '#16a34a' : '#cbd5e1'}; padding: 1rem; border-radius: 8px; background: ${isSwapped ? '#f0fdf4' : 'white'};">
            <div style="font-weight: 700; color: ${isSwapped ? '#166534' : '#64748b'}; margin-bottom: 0.4rem;">
              ${isSwapped ? '✨ الشقة الجديدة المخصصة لك:' : 'الشقة المعتمدة النهائية:'}
            </div>
            <div style="font-size: 1.05rem; font-weight: 800; color: ${isSwapped ? '#166534' : '#0f172a'};">${r.assign_district} - مجاورة ${r.assign_neighborhood} - مبنى ${r.assign_building || r.assign_bld || ''}</div>
            <div>وحدة ${r.assign_unit} (${r.assign_floor_label || r.assign_fl_label || ''})</div>
            <div style="font-size: 0.85rem; color: #64748b;">نموذج ${r.assign_model} (${r.assign_area} م²) - ${(r.assign_price || 0).toLocaleString('ar-EG')} ج/م²</div>
            <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace; margin-top: 4px;">عقاري: ${r.assign_nat_id}</div>
          </div>
        </div>

        ${isSwapped ? `
          <!-- Complete Cycle Coordination Card for Ministry of Housing -->
          <div style="background: #f8fafc; border: 2px solid #3b82f6; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <h4 style="font-size: 1.1rem; font-weight: 800; color: #1e3a8a; margin: 0; display: flex; align-items: center; gap: 0.4rem;">
                  <span>👥</span>
                  <span>أطراف دورة التبادل الخاصة بك (${(r.cycleMembers || []).length} أطراف - كود: ${r.cycle_id || 'مباشر'}):</span>
                </h4>
                <div style="font-size: 0.85rem; color: #475569; margin-top: 3px;">
                  مطلوب الحضور <strong>معاً</strong> بمقر وزارة الإسكان والمجتمعات العمرانية لإتمام محاضر التنازل المتبادل واعتماد التخصيص.
                </div>
              </div>
              <span style="font-size: 0.8rem; background: #dbeafe; color: #1e40af; font-weight: 800; padding: 4px 10px; border-radius: 12px;">
                ${r.swap_type === 'DIRECT_PAIR' ? 'تبادل ثنائي مباشر (طرفان)' : `دورة تبادل متعددة (${(r.cycleMembers || []).length} أطراف)`}
              </span>
            </div>

            <!-- Direct Mutual Link Highlight -->
            <div class="grid-2" style="gap: 0.75rem; margin-bottom: 1rem;">
              ${r.receivingFrom ? `
                <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 8px; padding: 0.75rem;">
                  <div style="font-size: 0.78rem; font-weight: 700; color: #1e40af; margin-bottom: 2px;">🔑 الشقة الجديدة تتسلمها مباشرة من الزميل:</div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 0.95rem;">${r.receivingFrom.full_name}</div>
                  <div style="font-size: 0.8rem; color: #475569;">🏛️ ${r.receivingFrom.workplace || 'غير محدد'}</div>
                  <div style="font-size: 0.78rem; color: #1e40af; margin-top: 2px;">🏢 شقته المستلمة لك: <strong>${r.assign_district}-${r.assign_neighborhood}-ع ${r.assign_building || r.assign_bld || ''}-و ${r.assign_unit}</strong></div>
                  <div style="font-size: 0.72rem; color: #0284c7; font-family: monospace;">الرقم القومي العقاري: ${r.assign_nat_id}</div>
                  <div style="margin-top: 4px; display: flex; gap: 0.4rem;">
                    <a href="tel:${r.receivingFrom.phone}" class="btn-call">📞 ${r.receivingFrom.phone}</a>
                    <a href="https://wa.me/20${(r.receivingFrom.phone || '').replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent('السلام عليكم أ/ ' + r.receivingFrom.full_name + '، بخصوص التنسيق للتنازل المتبادل بشقق العاصمة الإدارية في وزارة الإسكان...')}" target="_blank" class="btn-whatsapp">💬 واتساب</a>
                  </div>
                </div>
              ` : ''}

              ${r.givingTo ? `
                <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 8px; padding: 0.75rem;">
                  <div style="font-size: 0.78rem; font-weight: 700; color: #166534; margin-bottom: 2px;">🤝 شقتك الأصلية يتسلمها مباشرة الزميل:</div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 0.95rem;">${r.givingTo.full_name}</div>
                  <div style="font-size: 0.8rem; color: #475569;">🏛️ ${r.givingTo.workplace || 'غير محدد'}</div>
                  <div style="font-size: 0.78rem; color: #166534; margin-top: 2px;">🏢 شقتك المسلّمة له: <strong>${r.orig_district}-${r.orig_neighborhood}-ع ${r.orig_building || r.orig_bld || ''}-و ${r.orig_unit}</strong></div>
                  <div style="font-size: 0.72rem; color: #15803d; font-family: monospace;">الرقم القومي العقاري: ${r.orig_nat_id}</div>
                  <div style="margin-top: 4px; display: flex; gap: 0.4rem;">
                    <a href="tel:${r.givingTo.phone}" class="btn-call">📞 ${r.givingTo.phone}</a>
                    <a href="https://wa.me/20${(r.givingTo.phone || '').replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent('السلام عليكم أ/ ' + r.givingTo.full_name + '، بخصوص التنسيق للتنازل المتبادل بشقق العاصمة الإدارية في وزارة الإسكان...')}" target="_blank" class="btn-whatsapp">💬 واتساب</a>
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- Full Cycle Table for Multi-Party or Pair -->
            ${(r.cycleMembers && r.cycleMembers.length > 0) ? `
              <div style="font-weight: 800; font-size: 0.9rem; color: #1e3a8a; margin-bottom: 0.5rem;">
                📋 بيان جميع أطراف السلسلة التبادلية الكاملة وأرقام هواتفهم للتنسيق:
              </div>
              <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: right;">
                  <thead>
                    <tr style="background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1;">
                      <th style="padding: 6px 8px;">م</th>
                      <th style="padding: 6px 8px;">اسم الزميل</th>
                      <th style="padding: 6px 8px;">الوزارة / جهة العمل</th>
                      <th style="padding: 6px 8px;">رقم الهاتف المحمول</th>
                      <th style="padding: 6px 8px;">الشقة الأصلية</th>
                      <th style="padding: 6px 8px;">الشقة المحققة</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${r.cycleMembers.map((m, idx) => {
                      const isMe = m.national_id === r.national_id;
                      const cleanPhone = (m.phone || '').replace(/\D/g, '').replace(/^0/, '');
                      return `
                        <tr style="border-bottom: 1px solid #e2e8f0; background: ${isMe ? '#eff6ff; font-weight: bold;' : 'white'};">
                          <td style="padding: 6px 8px;">${idx + 1}</td>
                          <td style="padding: 6px 8px;">
                            ${m.full_name} ${isMe ? '<span style="color: #2563eb;">(أنت)</span>' : ''}
                          </td>
                          <td style="padding: 6px 8px; color: #475569;">${m.workplace || '-'}</td>
                          <td style="padding: 6px 8px;">
                            <div style="display: inline-flex; align-items: center; gap: 4px;">
                              <a href="tel:${m.phone}" class="btn-call" style="padding: 2px 6px; font-size: 0.75rem;">📞 ${m.phone}</a>
                              ${!isMe ? `<a href="https://wa.me/20${cleanPhone}?text=${encodeURIComponent('السلام عليكم أ/ ' + m.full_name + '، بخصوص التنسيق للتنازل المتبادل بشقق العاصمة الإدارية في وزارة الإسكان...')}" target="_blank" class="btn-whatsapp" style="padding: 2px 6px; font-size: 0.75rem;">💬 واتساب</a>` : ''}
                            </div>
                          </td>
                          <td style="padding: 6px 8px; font-size: 0.8rem;">
                            <div style="font-weight: 700;">${m.orig_district}-${m.orig_neighborhood}-ع${m.orig_building}-و${m.orig_unit}</div>
                            <div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">عقاري: ${m.orig_nat_id || '-'}</div>
                          </td>
                          <td style="padding: 6px 8px; font-size: 0.8rem; color: #166534;">
                            <div style="font-weight: 800;">${m.assign_district}-${m.assign_neighborhood}-ع${m.assign_building}-و${m.assign_unit}</div>
                            <div style="font-size: 0.72rem; color: #15803d; font-family: monospace;">عقاري: ${m.assign_nat_id || '-'}</div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            <!-- Official Ministry Instruction Notice -->
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.75rem 1rem; margin-top: 0.85rem; font-size: 0.82rem; color: #92400e; line-height: 1.6;">
              📢 <strong>إقرار وتنسيق رسمي:</strong> يقر أطراف هذه الدورة التبادلية بالتزامهم بالحضور معاً في موعد موحد يتم تحديده بالتنسيق مع وزارة الإسكان، وتقديم التنازلات المتبادلة دون تخلف أي طرف لضمان صحة الدورة قانونياً.
            </div>
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 1rem; display: flex; justify-content: center; gap: 0.75rem;">
          <button class="btn btn-primary" onclick="window.print()">🖨️ طباعة إخطار ومحضر التنسيق الرسمي</button>
        </div>
      </div>
    `;
  } catch (err) {
    display.innerHTML = `<div style="text-align: center; color: red; padding: 2rem;">حدث خطأ أثناء الاستعلام</div>`;
  }
}

// =========================================================
// ADMIN FUNCTIONS (TAB 4)
// =========================================================
async function adminLogin() {
  const pin = document.getElementById("admin-pin-input").value.trim();
  if (!pin) {
    showToast("يرجى إدخال رمز المرور", "error");
    return;
  }
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (data.success) {
      state.adminLoggedIn = true;
      document.getElementById("admin-login-box").style.display = "none";
      document.getElementById("admin-dashboard-view").style.display = "block";
      loadAdminData();
      showToast("تم تسجيل دخول لجنة الإسكان بنجاح", "success");
    } else {
      showToast(data.message || "رمز المرور غير صحيح!", "error");
    }
  } catch(e) {
    showToast("حدث خطأ أثناء الاتصال بالخادم", "error");
  }
}

function adminLogout() {
  state.adminLoggedIn = false;
  document.getElementById("admin-login-box").style.display = "block";
  document.getElementById("admin-dashboard-view").style.display = "none";
  document.getElementById("admin-pin-input").value = "";
  showToast("تم تسجيل الخروج بنجاح", "info");
}

function showChangePasswordModal() {
  const m = document.getElementById("password-modal");
  if (m) m.style.display = "flex";
}

function closePasswordModal() {
  const m = document.getElementById("password-modal");
  if (m) m.style.display = "none";
  document.getElementById("change-password-form").reset();
}

async function handleChangePassword(e) {
  e.preventDefault();
  const oldPin = document.getElementById("pwd-old").value.trim();
  const newPin = document.getElementById("pwd-new").value.trim();
  const confirmPin = document.getElementById("pwd-confirm").value.trim();

  if (newPin !== confirmPin) {
    showToast("كلمة المرور الجديدة غير متطابقة مع التأكيد!", "error");
    return;
  }

  try {
    const res = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPin, newPin })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      closePasswordModal();
    } else {
      showToast(data.message || "فشل تغيير كلمة المرور", "error");
    }
  } catch(e) {
    showToast("حدث خطأ أثناء تغيير كلمة المرور", "error");
  }
}

async function lookupExistingUserPreferences() {
  const nid = document.getElementById("reg-nid").value.trim();
  if (!nid || nid.length !== 14) {
    showToast("يرجى إدخال الرقم القومي المكون من 14 رقماً", "error");
    return;
  }

  try {
    const res = await fetch(`/api/user/${nid}`);
    const data = await res.json();
    if (!data.success || !data.user) {
      showToast("لم يتم العثور على تسجيل سابق بهذا الرقم القومي.", "info");
      return;
    }

    const u = data.user;
    document.getElementById("reg-name").value = u.full_name || '';
    document.getElementById("reg-phone").value = u.phone || '';
    document.getElementById("reg-workplace").value = u.workplace || '';

    if (u.original_apartment_id) {
      state.selectedAptId = u.original_apartment_id;
      const apt = state.apartments.find(a => a.id === u.original_apartment_id);
      if (apt) {
        document.getElementById("reg-district-select").value = apt.district;
        onDistrictSelected();
        document.getElementById("reg-nh-select").value = apt.neighborhood;
        onNeighborhoodSelected();
        document.getElementById("reg-bldg-select").value = apt.building;
        onBuildingSelected();
        document.getElementById("reg-unit-select").value = apt.id;
      }
      showOwnedApartmentPreview();
    }

    const st = u.swap_status || (u.wants_swap === 1 ? 'WANTS_SWAP' : 'KEPT_ORIGINAL');
    setSwapStatus(st);

    if (u.preferences && u.preferences.length > 0) {
      state.preferences = u.preferences.map(p => {
        return state.apartments.find(a => a.id === p.id) || p;
      });
      renderPreferencesList();
      filterPickerApts();
      showToast(`مرحباً ${u.full_name}! تم استرجاع بياناتك وشقتك و (${u.preferences.length}) رغبات سابقة بنجاح.`, "success");
    } else {
      showToast(`مرحباً ${u.full_name}! تم استرجاع بياناتك بنجاح.`, "success");
    }

  } catch(e) {
    showToast("حدث خطأ أثناء استرجاع البيانات", "error");
  }
}

async function viewEmployeeDesires(nid) {
  try {
    const res = await fetch(`/api/user/${nid}`);
    const data = await res.json();
    if (!data.success || !data.user) {
      showToast("تعذر تحميل رغبات الموظف", "error");
      return;
    }
    const u = data.user;
    document.getElementById("modal-employee-name").textContent = u.full_name;
    document.getElementById("modal-employee-sub").textContent = `الرقم القومي: ${u.national_id} | الهاتف: ${u.phone} | جهة العمل: ${u.workplace || '-'}`;

    const orig = state.apartments.find(a => a.id === u.original_apartment_id);
    const ownedBox = document.getElementById("modal-employee-owned");
    if (orig) {
      ownedBox.innerHTML = `
        <strong>الشقة الأصلية الفائز بها:</strong> 
        ${orig.district} - مجاورة ${orig.neighborhood} - مبنى ${orig.building} - وحدة ${orig.unit_number} (${orig.floor_label}) | نموذج ${orig.model} (${orig.area}م²) | رقم عقاري: ${orig.national_property_id}
      `;
    } else {
      ownedBox.innerHTML = `لم يتم تحديد الشقة الأصلية`;
    }

    const tableContainer = document.getElementById("modal-preferences-table-container");
    if (!u.preferences || u.preferences.length === 0) {
      tableContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1.5rem;">${u.swap_status === 'KEPT_ORIGINAL' ? 'الموظف اختار الاحتفاظ بشقته الأصلية ولم يسجل أي رغبات تبادل.' : (u.swap_status === 'AGREED_DIRECT' ? 'تم التوافق الودي المباشر بين الموظف وزميل آخر.' : 'لم يقم الموظف بإضافة رغبات بعد.')}</div>`;
    } else {
      tableContainer.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; border: 1px solid #cbd5e1;">
          <thead>
            <tr style="background: #f1f5f9; text-align: right;">
              <th style="padding: 6px; border: 1px solid #cbd5e1;">الرغبة</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">الحي</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">المجاورة</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">المبنى</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">الوحدة</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">الدور</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">النموذج والمساحة</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">سعر المتر</th>
            </tr>
          </thead>
          <tbody>
            ${u.preferences.map(p => `
              <tr>
                <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">#${p.rank}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.district}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.neighborhood}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.building}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold;">${p.unit_number}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${p.floor_label}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">نموذج ${p.model} (${p.area}م²)</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${(p.meter_price || 0).toLocaleString('ar-EG')} ج.م</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    document.getElementById("desires-modal").style.display = "flex";
  } catch(e) {
    showToast("حدث خطأ أثناء جلب رغبات الموظف", "error");
  }
}

function closeDesiresModal() {
  document.getElementById("desires-modal").style.display = "none";
}

async function loadAdminData() {
  await loadStats();
  loadDirectSwapsTable();

  // Automatically load previously saved/committed matching run if available
  try {
    const res = await fetch("/api/admin/latest-match");
    const data = await res.json();
    if (data.success && data.hasRun) {
      state.latestMatchData = data;
      renderMatchingResults(data);
    }
  } catch(e) {
    console.error("Could not load latest match:", e);
  }
}

async function seedTestData(count) {
  if (!confirm(`هل أنت متأكد من توليد ${count} موظفاً تجريبياً من واقع كراسة الشروط الرسمية مع جهات عملهم وتوزيع الحالات؟ سيتم مسح البيانات السابقة أولاً.`)) return;
  try {
    showToast(`جاري توليد ${count} موظفاً وتوزيع رغباتهم... ⏳`, "info");
    const res = await fetch("/api/admin/seed-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.result.message, "success");
      loadStats();
      loadApartments();
      loadDirectSwapsTable();
      const matchArea = document.getElementById("matching-results-area");
      if (matchArea) matchArea.style.display = "none";
    } else {
      showToast(data.message || "فشل توليد البيانات", "error");
    }
  } catch (err) {
    showToast("حدث خطأ أثناء توليد البيانات", "error");
  }
}

async function resetSystemData() {
  if (!confirm("هل أنت متأكد من إعادة ضبط وحذف جميع المشاركين والتوافقات والرغبات بالكامل؟")) return;
  try {
    const res = await fetch("/api/admin/reset", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      loadStats();
      loadApartments();
      loadDirectSwapsTable();
      const matchArea = document.getElementById("matching-results-area");
      if (matchArea) matchArea.style.display = "none";
    } else {
      showToast(data.message || "فشل إعادة الضبط", "error");
    }
  } catch (err) {
    showToast("حدث خطأ أثناء إعادة الضبط", "error");
  }
}

async function runMatchingSimulation() {
  const rule = document.getElementById("admin-priority-rule").value;
  const allowCycles = document.getElementById("admin-allow-cycles").value === "true";

  showToast("جاري تشغيل خوارزمية التوفيق الآلي بحل التزاحم بالقرعة العشوائية...", "info");

  try {
    const res = await fetch("/api/admin/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priorityRule: rule, allowCycles })
    });
    const data = await res.json();
    if (data.success) {
      state.latestMatchData = data;
      renderMatchingResults(data);
      showToast("تم الانتهاء من المطابقة الآلية بنجاح!", "success");
    }
  } catch (err) {
    showToast("حدث خطأ أثناء تشغيل خوارزمية التوفيق", "error");
  }
}

let candidatesFilter = 'all';
let candidatesSearchQuery = '';

function filterCandidatesTable(category, btn) {
  candidatesFilter = category;
  document.querySelectorAll('#admin-dashboard-view .active-filter').forEach(b => b.classList.remove('active-filter'));
  if (btn) btn.classList.add('active-filter');
  renderCandidatesTableRows();
}

function onCandidatesSearch() {
  const input = document.getElementById("candidates-search-input");
  candidatesSearchQuery = input ? input.value.toLowerCase().trim() : '';
  renderCandidatesTableRows();
}

function renderCandidatesTableRows() {
  if (!state.latestMatchData || !state.latestMatchData.results) return;
  const tbody = document.getElementById("candidates-results-tbody");
  if (!tbody) return;

  const results = state.latestMatchData.results;
  const query = candidatesSearchQuery;
  const filter = candidatesFilter;

  const aptMap = new Map();
  state.apartments.forEach(a => aptMap.set(a.id, a));

  const filtered = results.filter(r => {
    const isSwapped = r.swapType !== "KEPT_ORIGINAL";
    if (filter === 'swapped' && !isSwapped) return false;
    if (filter === 'kept' && isSwapped) return false;

    if (query) {
      const origApt = aptMap.get(r.originalAptId);
      const assignApt = aptMap.get(r.assignedAptId);
      const origCode = origApt ? `${origApt.district} ${origApt.neighborhood} ${origApt.building} ${origApt.unit_number} ${origApt.national_property_id}`.toLowerCase() : '';
      const assignCode = assignApt ? `${assignApt.district} ${assignApt.neighborhood} ${assignApt.building} ${assignApt.unit_number} ${assignApt.national_property_id}`.toLowerCase() : '';
      const name = (r.name || r.userName || '').toLowerCase();
      const nid = (r.nationalId || '').toLowerCase();
      const workplace = (r.workplace || '').toLowerCase();

      const match = name.includes(query) ||
                    nid.includes(query) ||
                    workplace.includes(query) ||
                    origCode.includes(query) ||
                    assignCode.includes(query);
      if (!match) return false;
    }
    return true;
  });

  const badge = document.getElementById("results-count-badge");
  if (badge) {
    badge.textContent = `عرض ${filtered.length.toLocaleString('ar-EG')} من أصل ${results.length.toLocaleString('ar-EG')} موظف`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">لا توجد نتائج مطابقة للبحث أو الفلتر</td></tr>`;
    return;
  }

  // Render all candidates
  tbody.innerHTML = filtered.map((r, i) => {
    const isSwapped = r.swapType !== "KEPT_ORIGINAL";
    const origApt = aptMap.get(r.originalAptId);
    const assignApt = aptMap.get(r.assignedAptId);

    const origTxt = origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '-';
    const assignTxt = assignApt ? `${assignApt.district}-${assignApt.neighborhood}-ع ${assignApt.building}-و ${assignApt.unit_number}` : '-';

    return `
      <tr style="border-bottom: 1px solid #e2e8f0; background: ${isSwapped ? '#f0fdf4' : 'transparent'};">
        <td style="padding: 0.6rem; font-weight: 700;">${i + 1}</td>
        <td style="padding: 0.6rem; font-weight: 800; color: #1e3a8a;">${r.name || r.userName}</td>
        <td style="padding: 0.6rem; font-family: monospace;">${r.nationalId}</td>
        <td style="padding: 0.6rem; font-size: 0.8rem; color: #475569;">${r.workplace || 'غير محدد'}</td>
        <td style="padding: 0.6rem; font-size: 0.8rem;">
          <div style="font-weight: 700;">${origTxt}</div>
          ${origApt ? `<div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">عقاري: ${origApt.national_property_id}</div>` : (r.origNatId ? `<div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">عقاري: ${r.origNatId}</div>` : '')}
        </td>
        <td style="padding: 0.6rem; font-size: 0.8rem; font-weight: 800; color: ${isSwapped ? '#166534' : 'inherit'};">
          <div style="font-weight: 800;">${assignTxt}</div>
          ${assignApt ? `<div style="font-size: 0.72rem; color: ${isSwapped ? '#15803d' : '#64748b'}; font-family: monospace;">عقاري: ${assignApt.national_property_id}</div>` : (r.assignNatId ? `<div style="font-size: 0.72rem; color: ${isSwapped ? '#15803d' : '#64748b'}; font-family: monospace;">عقاري: ${r.assignNatId}</div>` : '')}
        </td>
        <td style="padding: 0.6rem; text-align: center; font-weight: 700;">${r.rankAchieved ? `الرغبة ${r.rankAchieved}` : 'الأصلية'}</td>
        <td style="padding: 0.6rem; font-size: 0.8rem;">
          ${r.swapType === 'KEPT_ORIGINAL' ? 'احتفاظ' : `
            <div>
              <div style="font-weight: 700; color: #166534;">${r.swapType === 'DIRECT_PAIR' ? 'ثنائي مباشر' : 'دورة تبادل'}</div>
              ${r.cycleId ? `
                <button type="button" class="btn btn-outline btn-sm" style="padding: 1px 6px; font-size: 0.7rem; margin-top: 2px;" onclick="showCycleModal('${r.cycleId}')">
                  👥 أطراف ${r.cycleId}
                </button>
              ` : ''}
            </div>
          `}
        </td>
        <td style="padding: 0.6rem; display: flex; align-items: center; gap: 0.4rem;">
          <span style="font-size: 0.75rem; padding: 3px 8px; border-radius: 4px; font-weight: 800; background: ${isSwapped ? '#dcfce7; color: #15803d;' : '#f1f5f9; color: #64748b;'}">
            ${isSwapped ? 'موفق للتبادل ✔️' : 'محتفظ بشقته 🛡️'}
          </span>
          <button type="button" class="btn btn-outline btn-sm" style="padding: 2px 6px; font-size: 0.75rem;" onclick="viewEmployeeDesires('${r.nationalId}')" title="عرض كافة رغبات هذا الموظف الـ 20">
            👁️ الرغبات
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderMatchingResults(data) {
  const area = document.getElementById("matching-results-area");
  area.style.display = "block";

  document.getElementById("stat-swapped-count").textContent = data.totalSwapped.toLocaleString('ar-EG');
  document.getElementById("stat-rank1-pct").textContent = `${data.satisfaction.rank1Percent}% (${data.satisfaction.rank1Count})`;
  document.getElementById("stat-rank2-pct").textContent = `${data.satisfaction.rank2Percent}% (${data.satisfaction.rank2Count})`;
  document.getElementById("stat-kept-count").textContent = data.keptOriginal.toLocaleString('ar-EG');

  // Cycles list
  const cyclesContainer = document.getElementById("cycles-list-container");
  if (!data.cycles || data.cycles.length === 0) {
    cyclesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.9rem;">لا توجد دورات تبادل منفذة.</div>`;
  } else {
    cyclesContainer.innerHTML = data.cycles.map(c => {
      const isPair = c.length === 2;
      return `
        <div style="background: white; border: 1.5px solid ${isPair ? '#86efac' : '#93c5fd'}; border-radius: 10px; padding: 1rem; margin-bottom: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <span style="font-weight: 800; color: #1e3a8a; font-size: 1.05rem;">🔄 ${c.cycleId}</span>
              <span style="background: ${isPair ? '#dcfce7; color: #15803d;' : '#e0f2fe; color: #0284c7;'} padding: 3px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 700; margin-right: 0.5rem;">
                ${c.type} (${c.length} أطراف موفقة)
              </span>
            </div>
            <div style="font-size: 0.8rem; color: #64748b;">
              سلسلة التسليم: ${c.members.map(m => m.name).join(' ⬅️ ')}
            </div>
          </div>

          <!-- Members Grid with Phone Numbers and Ministries -->
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: right;">
              <thead>
                <tr style="background: #f8fafc; border-bottom: 1px solid #cbd5e1;">
                  <th style="padding: 4px 8px;">م</th>
                  <th style="padding: 4px 8px;">اسم الموظف</th>
                  <th style="padding: 4px 8px;">الوزارة / جهة العمل</th>
                  <th style="padding: 4px 8px;">رقم المحمول للتنسيق</th>
                  <th style="padding: 4px 8px;">الشقة الأصلية</th>
                  <th style="padding: 4px 8px;">الشقة الجديدة المحققة</th>
                </tr>
              </thead>
              <tbody>
                ${c.members.map((m, idx) => {
                  const cleanPhone = (m.phone || '').replace(/\D/g, '').replace(/^0/, '');
                  return `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 6px 8px; font-weight: 700;">${idx + 1}</td>
                      <td style="padding: 6px 8px; font-weight: 800; color: #1e3a8a;">${m.name}</td>
                      <td style="padding: 6px 8px; color: #475569;">${m.workplace || '-'}</td>
                      <td style="padding: 6px 8px;">
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                          <a href="tel:${m.phone}" class="btn-call" style="padding: 2px 6px; font-size: 0.75rem;">📞 ${m.phone}</a>
                          <a href="https://wa.me/20${cleanPhone}?text=${encodeURIComponent('السلام عليكم أ/ ' + m.name + '، بخصوص التنسيق للتبادل في وزارة الإسكان لكود ' + c.cycleId)}" target="_blank" class="btn-whatsapp" style="padding: 2px 6px; font-size: 0.75rem;">💬 واتساب</a>
                        </div>
                      </td>
                      <td style="padding: 6px 8px; font-size: 0.8rem;">
                        <div style="font-weight: 700; color: #1e3a8a;">
                          ${(m.origDistrict && m.origBuilding) ? `${m.origDistrict}-${m.origNeighborhood}-ع ${m.origBuilding}-و ${m.origUnit}` : (m.origAptCode || '-')}
                        </div>
                        ${(m.origNatId || m.orig_nat_id) ? `<div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">عقاري: ${m.origNatId || m.orig_nat_id}</div>` : ''}
                      </td>
                      <td style="padding: 6px 8px; font-size: 0.8rem;">
                        <div style="font-weight: 800; color: #166534;">
                          ${(m.assignDistrict && m.assignBuilding) ? `${m.assignDistrict}-${m.assignNeighborhood}-ع ${m.assignBuilding}-و ${m.assignUnit}` : (m.assignedAptCode || '-')}
                        </div>
                        ${(m.assignNatId || m.assign_nat_id) ? `<div style="font-size: 0.72rem; color: #15803d; font-family: monospace;">عقاري: ${m.assignNatId || m.assign_nat_id}</div>` : ''}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
  }

  renderCandidatesTableRows();
}

async function saveMatchingResults() {
  if (!state.latestMatchData) {
    showToast("يرجى تشغيل المطابقة أولاً", "error");
    return;
  }
  try {
    const res = await fetch("/api/admin/save-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priorityRule: state.latestMatchData.priorityRule })
    });
    const data = await res.json();
    if (data.success) {
      showToast("تم اعتماد وحفظ نتائج التوفيق رسمياً في قاعدة البيانات!", "success");
    }
  } catch (err) {
    showToast("حدث خطأ أثناء الحفظ", "error");
  }
}

async function togglePublishResults(publish) {
  try {
    const res = await fetch("/api/admin/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publish })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      const btn = document.getElementById("btn-toggle-publish");
      if (publish) {
        btn.textContent = "🔒 إلغاء نشر النتيجة";
        btn.onclick = () => togglePublishResults(false);
      } else {
        btn.textContent = "📢 نشر النتيجة للموظفين";
        btn.onclick = () => togglePublishResults(true);
      }
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    showToast("حدث خطأ أثناء تغيير حالة النشر", "error");
  }
}


// =========================================================
// DIRECT SWAP MANAGER (ADMIN)
// =========================================================
let directSwapParties = { 1: null, 2: null };

async function lookupDirectSwapParty(partyNum) {
  const input = document.getElementById(`admin-swap-q${partyNum}`);
  const preview = document.getElementById(`admin-swap-preview-${partyNum}`);
  const q = input.value.trim();

  if (!q) {
    showToast("يرجى إدخال الرقم القومي للموظف أو الرقم العقاري للشقة", "error");
    return;
  }

  preview.style.display = "block";
  preview.innerHTML = `<div style="text-align: center; color: #64748b;">جاري استعلام البيانات... ⏳</div>`;

  try {
    const res = await fetch(`/api/admin/lookup-party?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.success || !data.result) {
      preview.innerHTML = `<div style="color: #dc2626; font-weight: bold;">⚠️ لم يتم العثور على أي موظف أو شقة مطابقة.</div>`;
      directSwapParties[partyNum] = null;
      return;
    }

    const { user, apartment } = data.result;
    directSwapParties[partyNum] = data.result;

    let userHtml = "";
    if (user) {
      const stLabel = user.swap_status === 'AGREED_DIRECT' ? '🤝 تم التوافق الودي' : (user.swap_status === 'KEPT_ORIGINAL' ? '🛡️ محتفظ بها' : '🟢 راغب في التبديل');
      userHtml = `
        <div style="font-weight: 800; color: #1e3a8a; font-size: 0.95rem;">${user.full_name}</div>
        <div style="font-size: 0.8rem; color: #475569;">🏛️ <strong>الوزارة:</strong> ${user.workplace || 'غير محددة'} | 📞 ${user.phone}</div>
        <div style="font-size: 0.78rem; color: #64748b;">الرقم القومي: <span style="font-family: monospace;">${user.national_id}</span> | الحالة: <strong>${stLabel}</strong></div>
      `;
    } else {
      userHtml = `<div style="color: #d97706; font-weight: bold;">⚠️ لا يوجد موظف مسجل باسمه هذه الوحدة بعد</div>`;
    }

    let aptHtml = "";
    if (apartment) {
      aptHtml = `
        <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #cbd5e1;">
          <div style="font-weight: 700; color: #0f172a;">🏢 حي ${apartment.district} - مجاورة ${apartment.neighborhood} - عمارة ${apartment.building} - وحدة ${apartment.unit_number} (${apartment.floor_label})</div>
          <div style="font-size: 0.78rem; color: #64748b;">نموذج ${apartment.model} (${apartment.area} م²) - ${(apartment.total_price || 0).toLocaleString('ar-EG')} ج.م</div>
          <div style="font-size: 0.72rem; font-family: monospace; color: #0284c7;">عقاري: ${apartment.national_property_id}</div>
        </div>
      `;
    } else {
      aptHtml = `<div style="color: #dc2626;">⚠️ لم يتم تحديد الشقة</div>`;
    }

    preview.innerHTML = userHtml + aptHtml;

  } catch(e) {
    preview.innerHTML = `<div style="color: #dc2626;">حدث خطأ أثناء الاستعلام</div>`;
  }
}

async function submitDirectSwapPair() {
  const q1 = document.getElementById("admin-swap-q1").value.trim();
  const q2 = document.getElementById("admin-swap-q2").value.trim();
  const notes = document.getElementById("admin-swap-notes").value.trim();

  if (!q1 || !q2) {
    showToast("يرجى إدخال بيانات الطرفين (الرقم القومي أو الرقم العقاري لكل منهما)", "error");
    return;
  }

  if (q1.toUpperCase() === q2.toUpperCase()) {
    showToast("لا يمكن إجراء التوافق بين نفس الطرف ونفسه!", "error");
    return;
  }

  try {
    const res = await fetch("/api/admin/direct-swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query1: q1, query2: q2, notes })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      document.getElementById("admin-swap-q1").value = "";
      document.getElementById("admin-swap-q2").value = "";
      document.getElementById("admin-swap-notes").value = "";
      document.getElementById("admin-swap-preview-1").style.display = "none";
      document.getElementById("admin-swap-preview-2").style.display = "none";
      directSwapParties = { 1: null, 2: null };
      loadDirectSwapsTable();
      loadStats();
      loadApartments();
    } else {
      showToast(data.message || "فشل اعتماد التوافق الودي", "error");
    }
  } catch(e) {
    showToast("حدث خطأ أثناء الاتصال بالخادم", "error");
  }
}

async function loadDirectSwapsTable() {
  try {
    const res = await fetch("/api/admin/direct-swaps");
    const data = await res.json();
    const tbody = document.getElementById("direct-swaps-tbody");
    const badge = document.getElementById("direct-swaps-count-badge");
    if (!tbody) return;

    if (!data.success || !data.swaps || data.swaps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">لا توجد توافقات ودية مسجلة حتى الآن</td></tr>`;
      if (badge) badge.textContent = "0 توافق معتمد";
      return;
    }

    if (badge) badge.textContent = `${data.swaps.length} توافق معتمد`;

    tbody.innerHTML = data.swaps.map((s, idx) => {
      const dateStr = s.created_at ? s.created_at.slice(0, 16).replace('T', ' ') : '-';
      return `
        <tr style="border-bottom: 1px solid #fef08a; background: #fffdf5;">
          <td style="padding: 0.5rem; font-weight: 700;">${idx + 1}</td>
          <td style="padding: 0.5rem;">
            <div style="font-weight: 800; color: #1e3a8a;">${s.user1_name}</div>
            <div style="font-size: 0.75rem; color: #64748b;">${s.user1_workplace || ''} | 📞 ${s.user1_phone}</div>
          </td>
          <td style="padding: 0.5rem; font-size: 0.8rem;">
            ${s.a1_district}-${s.a1_nh}-ع${s.a1_bld}-و${s.a1_unit} (${s.a1_floor})
          </td>
          <td style="padding: 0.5rem; text-align: center; font-size: 1.2rem;">↔️</td>
          <td style="padding: 0.5rem;">
            <div style="font-weight: 800; color: #1e3a8a;">${s.user2_name}</div>
            <div style="font-size: 0.75rem; color: #64748b;">${s.user2_workplace || ''} | 📞 ${s.user2_phone}</div>
          </td>
          <td style="padding: 0.5rem; font-size: 0.8rem;">
            ${s.a2_district}-${s.a2_nh}-ع${s.a2_bld}-و${s.a2_unit} (${s.a2_floor})
          </td>
          <td style="padding: 0.5rem; font-size: 0.75rem; color: #64748b;">${dateStr}</td>
          <td style="padding: 0.5rem; font-size: 0.75rem;">${s.notes || 'معتمد'}</td>
          <td style="padding: 0.5rem;">
            <button type="button" class="btn btn-outline btn-sm" style="font-size: 0.72rem; padding: 2px 6px;" onclick="cancelDirectSwapItem(${s.id})">
              ↩️ إلغاء
            </button>
          </td>
        </tr>
      `;
    }).join('');

  } catch(e) {
    console.error("Error loading direct swaps:", e);
  }
}

async function cancelDirectSwapItem(swapId) {
  if (!confirm("هل أنت متأكد من إلغاء هذا التوافق الودي وإعادة فتح الشقتين للتبادل؟")) return;
  try {
    const res = await fetch("/api/admin/cancel-direct-swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ swapId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      loadDirectSwapsTable();
      loadStats();
      loadApartments();
    } else {
      showToast(data.message || "فشل إلغاء التوافق", "error");
    }
  } catch(e) {
    showToast("حدث خطأ أثناء الإلغاء", "error");
  }
}

async function submitSingleUserStatusUpdate() {
  const q = document.getElementById("admin-single-user-q").value.trim();
  const st = document.getElementById("admin-single-user-status").value;

  if (!q) {
    showToast("يرجى إدخال الرقم القومي للموظف أو الرقم العقاري للشقة", "error");
    return;
  }

  try {
    const res = await fetch("/api/admin/update-user-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, status: st })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      document.getElementById("admin-single-user-q").value = "";
      loadStats();
      loadApartments();
    } else {
      showToast(data.message || "فشل تحديث الحالة", "error");
    }
  } catch(e) {
    showToast("حدث خطأ أثناء التحديث", "error");
  }
}


function switchToResultsTab() {
  const resultBtn = document.querySelector('.nav-btn[data-tab="tab-results"]');
  if (resultBtn) {
    resultBtn.click();
    setTimeout(() => {
      const qInput = document.getElementById("query-nid");
      if (qInput) qInput.focus();
    }, 200);
  }
}


// =========================================================
// CYCLE MODAL HANDLERS
// =========================================================
async function showCycleModal(cycleId) {
  const modal = document.getElementById("cycle-modal");
  const title = document.getElementById("cycle-modal-title");
  const content = document.getElementById("cycle-modal-content");
  if (!modal || !content) return;

  title.textContent = `أطراف دورة التبادل: ${cycleId}`;
  content.innerHTML = `<div style="text-align: center; padding: 2rem;">جاري جلب بيانات أطراف الدورة... ⏳</div>`;
  modal.style.display = "flex";

  try {
    const res = await fetch(`/api/cycle/${cycleId}`);
    const data = await res.json();
    if (!data.success || !data.members || data.members.length === 0) {
      content.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1.5rem;">لم يتم العثور على أطراف هذه الدورة.</div>`;
      return;
    }

    const isPair = data.members.length === 2;
    content.innerHTML = `
      <div style="margin-bottom: 1rem; background: ${isPair ? '#f0fdf4' : '#eff6ff'}; border: 1px solid ${isPair ? '#bbf7d0' : '#bfdbfe'}; border-radius: 8px; padding: 0.75rem 1rem;">
        <div style="font-weight: 800; color: #1e3a8a;">
          ${isPair ? '🤝 تبادل ثنائي مباشر بين زميلين' : `🔄 دورة تبادل متعددة (${data.members.length} أطراف)`}
        </div>
        <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">
          يجب حضور جميع الزملاء المذكورين أدناه معاً بمقر وزارة الإسكان لتوقيع التنازلات المتبادلة في نفس الجلسة.
        </div>
      </div>

      <div style="overflow-x: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem; text-align: right;">
          <thead>
            <tr style="background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1;">
              <th style="padding: 6px 8px;">م</th>
              <th style="padding: 6px 8px;">اسم الزميل</th>
              <th style="padding: 6px 8px;">الوزارة / جهة العمل</th>
              <th style="padding: 6px 8px;">رقم المحمول والتواصل</th>
              <th style="padding: 6px 8px;">الشقة الأصلية المتنازل عنها</th>
              <th style="padding: 6px 8px;">الشقة الجديدة المخصصة</th>
            </tr>
          </thead>
          <tbody>
            ${data.members.map((m, idx) => {
              const cleanPhone = (m.phone || '').replace(/\D/g, '').replace(/^0/, '');
              return `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 8px; font-weight: 700;">${idx + 1}</td>
                  <td style="padding: 8px; font-weight: 800; color: #1e3a8a;">${m.full_name}</td>
                  <td style="padding: 8px; color: #475569;">${m.workplace || '-'}</td>
                  <td style="padding: 8px;">
                    <div style="display: inline-flex; align-items: center; gap: 4px;">
                      <a href="tel:${m.phone}" class="btn-call" style="padding: 3px 8px;">📞 ${m.phone}</a>
                      <a href="https://wa.me/20${cleanPhone}?text=${encodeURIComponent('السلام عليكم أ/ ' + m.full_name + '، بخصوص التنسيق للتنازل المتبادل بشقق العاصمة الإدارية في وزارة الإسكان لكود ' + cycleId)}" target="_blank" class="btn-whatsapp" style="padding: 3px 8px;">💬 واتساب</a>
                    </div>
                  </td>
                  <td style="padding: 8px; font-size: 0.8rem;">
                    <div style="font-weight: 700;">${m.orig_district}-${m.orig_neighborhood}-ع${m.orig_building}-و${m.orig_unit} (${m.orig_floor_label})</div>
                    <div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">عقاري: ${m.orig_nat_id || '-'}</div>
                  </td>
                  <td style="padding: 8px; font-size: 0.8rem; font-weight: bold; color: #166534;">
                    <div style="font-weight: 800;">${m.assign_district}-${m.assign_neighborhood}-ع${m.assign_building}-و${m.assign_unit} (${m.assign_floor_label})</div>
                    <div style="font-size: 0.72rem; color: #15803d; font-family: monospace;">عقاري: ${m.assign_nat_id || '-'}</div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

  } catch (err) {
    content.innerHTML = `<div style="text-align: center; color: red; padding: 1.5rem;">حدث خطأ أثناء جلب أطراف الدورة</div>`;
  }
}

function closeCycleModal() {
  const modal = document.getElementById("cycle-modal");
  if (modal) modal.style.display = "none";
}
