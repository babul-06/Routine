(() => {
  "use strict";

  const STORAGE_KEY = "routine-studio-state-v1";
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday"
  };

  let idCounter = 0;
  let draggedEventId = null;
  let pendingCsvSection = null;
  let state = normalizeState(loadState());

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    updateChromeHeight();
    window.addEventListener("resize", updateChromeHeight);
    bindEvents();
    render();
  }

  function bindEvents() {
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
  }

  function updateChromeHeight() {
    const chrome = $(".sticky-chrome");
    if (!chrome) return;
    document.documentElement.style.setProperty("--chrome-height", `${Math.ceil(chrome.getBoundingClientRect().height)}px`);
  }

  function newId(prefix) {
    idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
  }

  function defaultSlots() {
    return [
      { id: newId("slot"), label: "P1", start: "09:30", duration: 50 },
      { id: newId("slot"), label: "P2", start: "10:25", duration: 50 },
      { id: newId("slot"), label: "P3", start: "11:20", duration: 50 },
      { id: newId("slot"), label: "P4", start: "12:15", duration: 50 },
      { id: newId("slot"), label: "P5", start: "14:00", duration: 50 },
      { id: newId("slot"), label: "P6", start: "14:55", duration: 50 }
    ];
  }

  function defaultState() {
    const commonSlots = defaultSlots();
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    return {
      version: 1,
      ui: {
        tab: "setup",
        routineView: "sem",
        keepLocked: true,
        blockMode: false,
        blockSemId: null,
        blockFacultyId: null
      },
      commonDays: days,
      commonSlots,
      semesters: ["Sem 3", "Sem 5", "Sem 7"].map((name) => ({
        id: newId("sem"),
        name,
        useCommonDays: true,
        useCommonSlots: true,
        days: [...days],
        slotsByDay: {},
        blocks: []
      })),
      faculties: [],
      subjects: [],
      routine: {
        events: [],
        unscheduled: [],
        stats: null,
        lastGenerated: null
      }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultState();
    } catch (error) {
      console.warn(error);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn(error);
    }
  }

  function normalizeState(input) {
    const base = defaultState();
    const next = { ...base, ...(input || {}) };
    next.ui = { ...base.ui, ...(input && input.ui ? input.ui : {}) };
    next.commonDays = sortDays(Array.isArray(next.commonDays) ? next.commonDays : base.commonDays);
    next.commonSlots = normalizeSlots(next.commonSlots && next.commonSlots.length ? next.commonSlots : base.commonSlots);
    next.semesters = Array.isArray(next.semesters) ? next.semesters : [];
    next.faculties = Array.isArray(next.faculties) ? next.faculties : [];
    next.subjects = Array.isArray(next.subjects) ? next.subjects : [];
    next.semesters = next.semesters.map((sem, index) => ({
      id: sem.id || newId("sem"),
      name: sem.name || `Sem ${index + 1}`,
      useCommonDays: sem.useCommonDays !== false,
      useCommonSlots: sem.useCommonSlots !== false,
      days: sortDays(Array.isArray(sem.days) && sem.days.length ? sem.days : next.commonDays),
      slotsByDay: normalizeSlotsByDay(sem.slotsByDay),
      blocks: Array.isArray(sem.blocks) ? sem.blocks : []
    }));
    next.faculties = next.faculties.map((fac, index) => ({
      id: fac.id || newId("fac"),
      name: fac.name || `Faculty ${index + 1}`,
      subjects: Array.isArray(fac.subjects) ? fac.subjects : parseChoiceText(fac.subjects || ""),
      holidays: sortDays(Array.isArray(fac.holidays) ? fac.holidays : []),
      blocks: Array.isArray(fac.blocks) ? fac.blocks : []
    }));
    next.subjects = next.subjects.map((sub, index) => ({
      id: sub.id || newId("sub"),
      code: sub.code || `SUB${index + 1}`,
      name: sub.name || `Subject ${index + 1}`,
      type: sub.type || "Theory",
      weeklyCount: clampInt(sub.weeklyCount, 1, 12, 3),
      durationSlots: clampInt(sub.durationSlots, 1, 6, 1),
      facultyCount: clampInt(sub.facultyCount, 1, 4, 1),
      semIds: Array.isArray(sub.semIds) ? sub.semIds : [],
      autoFacultyPool: sub.autoFacultyPool !== false,
      candidateFacultyIds: Array.isArray(sub.candidateFacultyIds) ? sub.candidateFacultyIds : [],
      notes: sub.notes || ""
    }));
    next.routine = next.routine || {};
    next.routine.events = Array.isArray(next.routine.events) ? next.routine.events : [];
    next.routine.unscheduled = Array.isArray(next.routine.unscheduled) ? next.routine.unscheduled : [];
    next.routine.stats = next.routine.stats || null;
    next.routine.lastGenerated = next.routine.lastGenerated || null;
    if (!next.ui.blockSemId && next.semesters[0]) next.ui.blockSemId = next.semesters[0].id;
    if (!next.ui.blockFacultyId && next.faculties[0]) next.ui.blockFacultyId = next.faculties[0].id;
    return next;
  }

  function normalizeSlots(slots) {
    return (Array.isArray(slots) ? slots : []).map((slot, index) => ({
      id: slot.id || newId("slot"),
      label: slot.label || `P${index + 1}`,
      start: validTime(slot.start) ? slot.start : "09:30",
      duration: clampInt(slot.duration, 5, 240, 50)
    })).sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
  }

  function normalizeSlotsByDay(slotsByDay) {
    const out = {};
    DAYS.forEach((day) => {
      out[day] = normalizeSlots(slotsByDay && Array.isArray(slotsByDay[day]) ? slotsByDay[day] : []);
    });
    return out;
  }

  function render() {
    normalizeSelections();
    renderTabs();
    renderSetup();
    renderFaculty();
    renderSubjects();
    renderConstraints();
    renderRoutine();
    renderExport();
    saveState();
    refreshIcons();
    updateChromeHeight();
  }

  function refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function renderTabs() {
    $$(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === state.ui.tab);
    });
    $$(".view").forEach((view) => {
      view.classList.toggle("active", view.id === state.ui.tab);
    });
  }

  function renderSetup() {
    $("#setup").innerHTML = `
      <div class="layout wide-right">
        <div class="stack">
          <div class="panel">
            <div class="panel-header sticky-actions">
              <div>
                <h2>Common Academic Week</h2>
                <p>Use this as the default day and period template. Every semester can override it.</p>
              </div>
              <button class="btn small" data-action="add-common-slot" title="Add one common class slot"><i data-lucide="plus"></i><span>Slot</span></button>
            </div>
            <div class="panel-body stack">
              <div class="field">
                <span class="field-label">Common class days</span>
                <div class="day-picker">
                  ${DAYS.map((day) => chip("common-day-input", day, state.commonDays.includes(day), day, "", { day })).join("")}
                </div>
              </div>
              <div class="slots">
                ${state.commonSlots.map((slot, index) => slotRowHtml(slot, { kind: "common", index })).join("")}
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header sticky-actions">
              <div>
                <h2>Semesters</h2>
                <p>Each semester can have separate class days, slot times, and blocked cells.</p>
              </div>
              <div class="mini-actions">
                <button class="btn small" data-action="download-demo-csv" data-section="semesters" title="Download a one-row semesters CSV"><i data-lucide="file-down"></i><span>Demo CSV</span></button>
                <button class="btn small" data-action="import-csv" data-section="semesters" title="Import semesters from CSV"><i data-lucide="file-up"></i><span>Import CSV</span></button>
                <button class="btn primary small" data-action="add-semester"><i data-lucide="plus"></i><span>Semester</span></button>
              </div>
            </div>
            <div class="panel-body">
              ${csvHelpHtml("semesters")}
              <div class="item-list">
                ${state.semesters.length ? state.semesters.map(semesterCardHtml).join("") : emptyHtml("calendar-plus", "Add at least one semester to begin scheduling.")}
              </div>
            </div>
          </div>
        </div>

        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Setup Notes</h3>
              <p>Flexible time grids are supported.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="metric-grid">
              <div class="metric"><b>${state.semesters.length}</b><span>Semesters</span></div>
              <div class="metric"><b>${state.commonDays.length}</b><span>Default days</span></div>
              <div class="metric"><b>${state.commonSlots.length}</b><span>Default slots</span></div>
              <div class="metric"><b>${totalSemBlocks()}</b><span>Sem blocks</span></div>
            </div>
            <p class="hint">For labs, projects, and long lectures, set a subject duration to 2 or more consecutive periods in the Subjects tab.</p>
            <p class="hint">For a combined class, assign one subject to multiple semesters. The generator will place one shared event only when all selected semesters and assigned faculties are free at the same time.</p>
          </div>
        </aside>
      </div>
    `;
  }

  function semesterCardHtml(sem) {
    const activeDays = getActiveDays(sem);
    const slotsSection = sem.useCommonSlots
      ? `<p class="hint">Using the common period template for every active day.</p>`
      : activeDays.map((day) => `
          <details class="day-slots" open>
            <summary>${DAY_NAMES[day]}</summary>
            <div class="slots" style="margin-top:10px">
              ${getSlots(sem, day).map((slot, index) => slotRowHtml(slot, { kind: "sem", semId: sem.id, day, index })).join("") || `<p class="hint">No slots yet for ${DAY_NAMES[day]}.</p>`}
              <button class="btn small" data-action="add-sem-slot" data-sem="${sem.id}" data-day="${day}"><i data-lucide="plus"></i><span>Add ${day} slot</span></button>
            </div>
          </details>
        `).join("");

    return `
      <article class="item-card">
        <div class="item-card-header">
          <div>
            <strong>${esc(sem.name)}</strong>
            <small>${activeDays.length} days, ${countSemSlots(sem)} available slots</small>
          </div>
          <div class="mini-actions">
            <button class="btn icon small" data-action="clone-semester" data-sem="${sem.id}" title="Duplicate semester"><i data-lucide="copy"></i></button>
            <button class="btn icon small danger" data-action="remove-semester" data-sem="${sem.id}" title="Delete semester"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <div class="item-card-body stack">
          <div class="grid-3">
            <div class="field">
              <label>Semester name</label>
              <input class="sem-name-field" data-sem="${sem.id}" value="${attr(sem.name)}">
            </div>
            <div class="field">
              <label>Day template</label>
              <select class="sem-use-common-days" data-sem="${sem.id}">
                <option value="true" ${sem.useCommonDays ? "selected" : ""}>Use common days</option>
                <option value="false" ${!sem.useCommonDays ? "selected" : ""}>Custom days</option>
              </select>
            </div>
            <div class="field">
              <label>Time template</label>
              <select class="sem-use-common-slots" data-sem="${sem.id}">
                <option value="true" ${sem.useCommonSlots ? "selected" : ""}>Use common times</option>
                <option value="false" ${!sem.useCommonSlots ? "selected" : ""}>Custom day times</option>
              </select>
            </div>
          </div>
          ${sem.useCommonDays ? "" : `
            <div class="field">
              <span class="field-label">Custom class days</span>
              <div class="day-picker">
                ${DAYS.map((day) => chip("sem-day-input", day, sem.days.includes(day), day, "", { sem: sem.id, day })).join("")}
              </div>
            </div>
          `}
          ${!sem.useCommonSlots ? `
            <div class="inline-actions">
              <button class="btn small" data-action="copy-common-to-sem" data-sem="${sem.id}"><i data-lucide="copy-plus"></i><span>Copy common times to every active day</span></button>
            </div>
          ` : ""}
          ${slotsSection}
        </div>
      </article>
    `;
  }

  function renderFaculty() {
    $("#faculty").innerHTML = `
      <div class="layout">
        <div class="panel">
          <div class="panel-header sticky-actions">
            <div>
              <h2>Faculty Pool</h2>
              <p>Choose subject preferences, weekly holidays, and unavailable time ranges for each faculty member.</p>
            </div>
            <div class="mini-actions">
              <button class="btn small" data-action="download-demo-csv" data-section="faculty" title="Download a one-row faculty CSV"><i data-lucide="file-down"></i><span>Demo CSV</span></button>
              <button class="btn small" data-action="import-csv" data-section="faculty" title="Import faculty from CSV"><i data-lucide="file-up"></i><span>Import CSV</span></button>
              <button class="btn primary small" data-action="add-faculty"><i data-lucide="user-plus"></i><span>Faculty</span></button>
            </div>
          </div>
          <div class="panel-body">
            ${csvHelpHtml("faculty")}
            <div class="item-list">
              ${state.faculties.length ? state.faculties.map(facultyCardHtml).join("") : emptyHtml("users", "Add faculty members, then give each one subject choices and two weekly holidays.")}
            </div>
          </div>
        </div>

        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Faculty Health</h3>
              <p>Holiday and subject-choice readiness.</p>
            </div>
          </div>
          <div class="panel-body">
            <ul class="warning-list">
              ${facultyWarnings().join("") || `<li>Faculty setup is ready for scheduling.</li>`}
            </ul>
          </div>
        </aside>
      </div>
    `;
  }

  function facultyCardHtml(fac) {
    return `
      <article class="item-card">
        <div class="item-card-header">
          <div>
            <strong>${esc(fac.name)}</strong>
            <small>${fac.subjects.length} choices, ${fac.holidays.length} holidays, ${fac.blocks.length} blocked slots</small>
          </div>
          <button class="btn icon small danger" data-action="remove-faculty" data-fac="${fac.id}" title="Delete faculty"><i data-lucide="trash-2"></i></button>
        </div>
        <div class="item-card-body stack">
          <div class="grid-2">
            <div class="field">
              <label>Faculty name</label>
              <input class="faculty-name-field" data-fac="${fac.id}" value="${attr(fac.name)}">
            </div>
            <div class="field">
              <span class="field-label">Two weekly holidays</span>
              <div class="day-picker">
                ${DAYS.map((day) => chip("faculty-holiday-input", day, fac.holidays.includes(day), day, "", { fac: fac.id, day })).join("")}
              </div>
            </div>
          </div>
          <div class="field">
            <label>Subject preferences</label>
            <div class="preference-picker">
              <select class="faculty-choice-select" data-fac="${fac.id}">
                ${facultySubjectOptionsHtml(fac)}
              </select>
              <button class="btn small" data-action="add-faculty-choice" data-fac="${fac.id}"><i data-lucide="plus"></i><span>Add preference</span></button>
            </div>
            <div class="preference-chips">
              ${fac.subjects.length ? fac.subjects.map((choice, index) => `
                <span class="preference-chip">
                  ${esc(choice)}
                  <button data-action="remove-faculty-choice" data-fac="${fac.id}" data-index="${index}" title="Remove preference"><i data-lucide="x"></i></button>
                </span>
              `).join("") : `<span class="hint">Add subjects in the Subjects tab, then choose preferences from this dropdown.</span>`}
            </div>
            <span class="hint">Multiple faculty can prefer the same subject. Subject matching uses subject code and name.</span>
          </div>
        </div>
      </article>
    `;
  }

  function facultySubjectOptionsHtml(fac) {
    if (!state.subjects.length) return `<option value="">Add subjects first</option>`;
    const selected = new Set((fac.subjects || []).map(norm));
    const options = state.subjects
      .filter((sub) => !selected.has(norm(sub.code)) && !selected.has(norm(sub.name)))
      .map((sub) => `<option value="${sub.id}">${esc(sub.code)} - ${esc(sub.name)}</option>`);
    return options.length ? `<option value="">Choose subject...</option>${options.join("")}` : `<option value="">All subjects already selected</option>`;
  }

  function addFacultyChoice(facId) {
    const fac = getFaculty(facId);
    const select = $(`.faculty-choice-select[data-fac="${cssEscape(facId)}"]`);
    const subject = select ? getSubject(select.value) : null;
    if (!fac || !subject) return;
    if (!fac.subjects.some((choice) => norm(choice) === norm(subject.code) || norm(choice) === norm(subject.name))) {
      fac.subjects.push(subject.code);
    }
  }

  function removeFacultyChoice(facId, index) {
    const fac = getFaculty(facId);
    if (!fac) return;
    fac.subjects.splice(index, 1);
  }

  function csvHelpHtml(section) {
    const text = {
      semesters: "CSV columns: name, days, use_common_slots, slots, slots_by_day, blocks. Example slots_by_day: Mon:P1@09:30+50|P2@10:25+50;Tue:P1@09:30+50.",
      faculty: "CSV columns: name, subject_preferences, holidays, blocks. Use | between preferences, holidays, and blocks. Example block: Mon@09:30-10:20.",
      subjects: "CSV columns: code, name, type, weekly_count, duration_slots, faculty_count, semesters, auto_faculty_pool, candidate_faculty. Use multiple semesters for combined classes."
    }[section];
    return `<div class="csv-toolbar"><strong>CSV import</strong><span class="hint">${esc(text)}</span></div>`;
  }

  function renderSubjects() {
    $("#subjects").innerHTML = `
      <div class="layout wide-right">
        <div class="panel">
          <div class="panel-header sticky-actions">
            <div>
              <h2>Subjects and Class Requirements</h2>
              <p>Set weekly frequency, duration, assigned semesters, and faculty count for each class type.</p>
            </div>
            <div class="mini-actions">
              <button class="btn small" data-action="download-demo-csv" data-section="subjects" title="Download a one-row subjects CSV"><i data-lucide="file-down"></i><span>Demo CSV</span></button>
              <button class="btn small" data-action="import-csv" data-section="subjects" title="Import subjects from CSV"><i data-lucide="file-up"></i><span>Import CSV</span></button>
              <button class="btn primary small" data-action="add-subject"><i data-lucide="book-plus"></i><span>Subject</span></button>
            </div>
          </div>
          <div class="panel-body">
            ${csvHelpHtml("subjects")}
            <div class="item-list">
              ${state.subjects.length ? state.subjects.map(subjectCardHtml).join("") : emptyHtml("book-open", "Add subjects after adding at least one semester and faculty member.")}
            </div>
          </div>
        </div>

        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Requirement Check</h3>
              <p>Potential scheduling issues before generation.</p>
            </div>
          </div>
          <div class="panel-body">
            <ul class="warning-list">
              ${subjectWarnings().join("") || `<li>Subjects are ready. The generator will use faculty choices as candidate pools.</li>`}
            </ul>
          </div>
        </aside>
      </div>
    `;
  }

  function subjectCardHtml(sub) {
    const selectedSems = sub.semIds.map(getSemester).filter(Boolean);
    const isCombined = selectedSems.length > 1;
    const candidates = candidateFacultyIdsForSubject(sub, true).map(getFaculty).filter(Boolean);
    return `
      <article class="item-card">
        <div class="item-card-header">
          <div>
            <strong>${esc(sub.code)} - ${esc(sub.name)}</strong>
            <small>${sub.weeklyCount} per week, ${sub.durationSlots} period${sub.durationSlots > 1 ? "s" : ""}, ${sub.facultyCount} faculty${sub.facultyCount > 1 ? " members" : ""}${isCombined ? ", combined class" : ""}</small>
          </div>
          <button class="btn icon small danger" data-action="remove-subject" data-sub="${sub.id}" title="Delete subject"><i data-lucide="trash-2"></i></button>
        </div>
        <div class="item-card-body stack">
          <div class="grid-4">
            <div class="field">
              <label>Code</label>
              <input class="subject-field" data-sub="${sub.id}" data-field="code" value="${attr(sub.code)}">
            </div>
            <div class="field">
              <label>Name</label>
              <input class="subject-field" data-sub="${sub.id}" data-field="name" value="${attr(sub.name)}">
            </div>
            <div class="field">
              <label>Class type</label>
              <select class="subject-field" data-sub="${sub.id}" data-field="type">
                ${["Theory", "Lab", "Project", "Tutorial"].map((type) => `<option ${sub.type === type ? "selected" : ""}>${type}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Weekly classes</label>
              <input class="subject-field" data-sub="${sub.id}" data-field="weeklyCount" type="number" min="1" max="12" value="${sub.weeklyCount}">
            </div>
          </div>
          <div class="grid-3">
            <div class="field">
              <label>Consecutive periods per class</label>
              <input class="subject-field" data-sub="${sub.id}" data-field="durationSlots" type="number" min="1" max="6" value="${sub.durationSlots}">
            </div>
            <div class="field">
              <label>Faculty in one class</label>
              <input class="subject-field" data-sub="${sub.id}" data-field="facultyCount" type="number" min="1" max="4" value="${sub.facultyCount}">
            </div>
            <div class="field">
              <label>Candidate mode</label>
              <select class="subject-field" data-sub="${sub.id}" data-field="autoFacultyPool">
                <option value="true" ${sub.autoFacultyPool ? "selected" : ""}>Use subject choices plus selected</option>
                <option value="false" ${!sub.autoFacultyPool ? "selected" : ""}>Selected faculty only</option>
              </select>
            </div>
          </div>
          <div class="field">
            <span class="field-label">Semesters for this subject</span>
            <div class="choice-grid">
              ${state.semesters.map((sem) => chip("subject-sem-input", sem.name, sub.semIds.includes(sem.id), sem.name, "", { sub: sub.id, sem: sem.id })).join("") || `<span class="hint">Add semesters first.</span>`}
            </div>
            <span class="hint">Choose multiple semesters to create one combined class that runs in parallel for all selected semesters.</span>
          </div>
          <div class="field">
            <span class="field-label">Manual faculty candidates</span>
            <div class="choice-grid">
              ${state.faculties.map((fac) => chip("subject-faculty-input", fac.name, sub.candidateFacultyIds.includes(fac.id), fac.name, "", { sub: sub.id, fac: fac.id })).join("") || `<span class="hint">Add faculty first.</span>`}
            </div>
            <span class="hint">${candidates.length ? `${candidates.length} total candidate faculty after subject-choice matching.` : "No matching candidate yet."}</span>
          </div>
          <div class="field">
            <label>Notes</label>
            <textarea class="subject-field" data-sub="${sub.id}" data-field="notes" placeholder="Optional constraints or reminders">${esc(sub.notes || "")}</textarea>
          </div>
        </div>
      </article>
    `;
  }

  function renderConstraints() {
    const sem = getSemester(state.ui.blockSemId) || state.semesters[0] || null;
    const fac = getFaculty(state.ui.blockFacultyId) || state.faculties[0] || null;
    const facultyDays = getRoutineDays().length ? getRoutineDays() : state.commonDays;
    const facultySlots = getGlobalSlotTemplates();
    $("#constraints").innerHTML = `
      <div class="layout">
        <div class="stack">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Semester Blocked Slots</h2>
                <p>Mark unavailable semester cells where no class can be placed.</p>
              </div>
              <div class="field" style="min-width:220px">
                <label class="sr-only">Semester</label>
                <select class="ui-field" data-field="blockSemId">
                  ${state.semesters.map((item) => `<option value="${item.id}" ${sem && sem.id === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="panel-body">
              ${sem ? blockGridHtml("sem", sem.id, getActiveDays(sem), (day) => getSlots(sem, day), sem.blocks) : emptyHtml("calendar-x", "Add a semester before blocking semester slots.")}
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Faculty Blocked Slots</h2>
                <p>Mark unavailable faculty cells once. A blocked slot applies across every semester.</p>
              </div>
              <div class="inline-actions">
                <select class="ui-field control-input" data-field="blockFacultyId">
                  ${state.faculties.map((item) => `<option value="${item.id}" ${fac && fac.id === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="panel-body">
              ${fac && facultySlots.length ? blockGridHtml("faculty", fac.id, facultyDays, () => facultySlots, fac.blocks) : emptyHtml("shield-alert", "Add faculty and at least one time slot before blocking faculty slots.")}
            </div>
          </div>
        </div>

        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Block Summary</h3>
              <p>Hard constraints during generation and drag-drop.</p>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="metric-grid">
              <div class="metric"><b>${totalSemBlocks()}</b><span>Sem blocks</span></div>
              <div class="metric"><b>${totalFacultyBlocks()}</b><span>Faculty blocks</span></div>
              <div class="metric"><b>${holidayCount()}</b><span>Holiday marks</span></div>
              <div class="metric"><b>${state.routine.events.length}</b><span>Placed classes</span></div>
            </div>
            <p class="hint">The Routine tab also has Block Mode, so you can block cells directly while inspecting generated routines.</p>
          </div>
        </aside>
      </div>
    `;
  }

  function renderRoutine() {
    const metrics = calculateMetrics();
    $("#routine").innerHTML = `
      <div class="stack">
        <div class="panel">
          <div class="panel-header sticky-actions">
            <div>
              <h2>Generate and Repair Routine</h2>
              <p>Drag class cards to another valid slot. Locked cards can be preserved on the next generation.</p>
            </div>
            <div class="inline-actions">
              <label class="switch-row" style="padding:0; border:0">
                <input type="checkbox" class="ui-checkbox" data-field="keepLocked" ${state.ui.keepLocked ? "checked" : ""}>
                <span>Keep locked</span>
              </label>
              <button class="btn ${state.ui.blockMode ? "warn" : "ghost"}" data-action="toggle-block-mode" title="Toggle click-to-block mode"><i data-lucide="ban"></i><span>Block Mode</span></button>
              <button class="btn primary" data-action="generate-routine"><i data-lucide="wand-2"></i><span>Generate</span></button>
              <button class="btn danger" data-action="clear-routine"><i data-lucide="eraser"></i><span>Clear</span></button>
            </div>
          </div>
          <div class="panel-body stack">
            <div class="split-toolbar">
              <div class="metric-grid">
                <div class="metric"><b>${metrics.totalEvents}</b><span>Classes placed</span></div>
                <div class="metric"><b>${metrics.unscheduledCount}</b><span>Unscheduled</span></div>
                <div class="metric"><b>${metrics.conflicts.length}</b><span>Conflicts</span></div>
                <div class="metric"><b>${metrics.balance}</b><span>Load spread</span></div>
              </div>
              <div class="segmented" aria-label="Routine view">
                <button data-action="set-routine-view" data-view="sem" class="${state.ui.routineView === "sem" ? "active" : ""}">Semesters</button>
                <button data-action="set-routine-view" data-view="faculty" class="${state.ui.routineView === "faculty" ? "active" : ""}">Faculty</button>
                <button data-action="set-routine-view" data-view="health" class="${state.ui.routineView === "health" ? "active" : ""}">Health</button>
              </div>
            </div>
            ${state.ui.blockMode ? `<p class="hint"><strong>Block Mode is on.</strong> Click an empty semester or faculty slot to toggle a hard block.</p>` : ""}
            <div class="repair-note">When a dragged class hits a clash, Routine Studio will search for a swap or clean relocation plan, show the exact changes, and ask before applying them. Faculty routine cells support the same drag behavior.</div>
          </div>
        </div>

        ${routineWarningsHtml(metrics)}
        <div class="schedule-space">
          ${routineViewHtml(state.ui.routineView, metrics)}
        </div>
      </div>
    `;
  }

  function renderExport() {
    $("#export").innerHTML = `
      <div class="stack">
        <div class="panel printable-actions">
          <div class="panel-header">
            <div>
              <h2>Export Routines</h2>
              <p>Export semester and individual faculty routines as XLSX, PDF, PNG, JPG, or full project JSON.</p>
            </div>
            <div class="inline-actions">
              <button class="btn" data-action="export-xlsx"><i data-lucide="file-spreadsheet"></i><span>XLSX</span></button>
              <button class="btn" data-action="export-pdf"><i data-lucide="file-text"></i><span>PDF</span></button>
              <button class="btn" data-action="export-png"><i data-lucide="image"></i><span>PNG</span></button>
              <button class="btn" data-action="export-jpg"><i data-lucide="image-down"></i><span>JPG</span></button>
              <button class="btn ghost" data-action="export-json"><i data-lucide="save"></i><span>JSON</span></button>
            </div>
          </div>
        </div>
        <div class="export-preview" id="exportArea">
          <div class="panel-header" style="padding-left:0; padding-right:0; border-bottom:0">
            <div>
              <h2>Routine Studio Export</h2>
              <p>${new Date().toLocaleString()} | ${state.routine.events.length} placed classes</p>
            </div>
          </div>
          <h3>Semester Routines</h3>
          ${renderSemesterBoards({ exportMode: true })}
          <h3>Faculty Routines</h3>
          ${renderFacultyBoards({ exportMode: true })}
        </div>
      </div>
    `;
  }

  function routineViewHtml(view, metrics) {
    if (!state.routine.events.length) {
      return emptyHtml("table-2", "No routine generated yet. Add data or load the demo, then press Generate.");
    }
    if (view === "faculty") return renderFacultyBoards({ exportMode: false });
    if (view === "health") return healthViewHtml(metrics);
    return renderSemesterBoards({ exportMode: false });
  }

  function renderSemesterBoards({ exportMode }) {
    if (!state.semesters.length) return emptyHtml("calendar-days", "No semesters available.");
    return state.semesters.map((sem) => {
      const days = getActiveDays(sem);
      return `
        <section class="routine-board">
          <div class="routine-title">
            <h3>${esc(sem.name)}</h3>
            <span class="pill">${days.length} days</span>
          </div>
          ${days.map((day) => semesterDayLineHtml(sem, day, exportMode)).join("") || `<div class="panel-body"><p class="hint">No active class days.</p></div>`}
        </section>
      `;
    }).join("");
  }

  function semesterDayLineHtml(sem, day, exportMode) {
    const slots = getSlots(sem, day);
    return `
      <div class="day-line">
        <div class="day-name">${day}</div>
        <div class="slot-strip" style="grid-template-columns: repeat(${Math.max(slots.length, 1)}, minmax(148px, 1fr));">
          ${slots.length ? slots.map((slot, index) => routineCellHtml({ sem, day, slot, index, exportMode })).join("") : `<div class="routine-cell"><span class="time-label">No slots</span></div>`}
        </div>
      </div>
    `;
  }

  function routineCellHtml({ sem, day, slot, index, exportMode }) {
    const start = timeToMin(slot.start);
    const end = slotEndMin(slot);
    const blocked = rangeBlocked(sem.blocks, day, start, end);
    const startedEvents = state.routine.events.filter((event) => event.semIds.includes(sem.id) && event.day === day && event.start === start);
    const covering = !startedEvents.length && state.routine.events.some((event) => event.semIds.includes(sem.id) && event.day === day && overlaps(start, end, event.start, event.end));
    const conflictSet = getConflictEventSet();
    const classes = ["routine-cell"];
    if (blocked) classes.push("blocked");
    if (covering) classes.push("continued");
    const data = exportMode ? "" : `data-sem="${sem.id}" data-day="${day}" data-slot-index="${index}"`;
    return `
      <div class="${classes.join(" ")}" ${data}>
        <span class="time-label">${esc(slot.label)} ${minToTime(start)}-${minToTime(end)}</span>
        ${startedEvents.map((event) => classCardHtml(event, { exportMode, conflict: conflictSet.has(event.id) })).join("")}
        ${blocked && !startedEvents.length ? `<span class="pill rose">Blocked</span>` : ""}
        ${covering && !startedEvents.length ? `<span class="hint">Continues</span>` : ""}
      </div>
    `;
  }

  function renderFacultyBoards({ exportMode }) {
    if (!state.faculties.length) return emptyHtml("users", "No faculty members available.");
    const slots = getGlobalSlots();
    const days = getRoutineDays();
    const conflictSet = getConflictEventSet();
    return state.faculties.map((fac) => `
      <section class="routine-board">
        <div class="routine-title">
          <h3>${esc(fac.name)}</h3>
          <span class="pill green">${facultyLoad(fac.id)} periods</span>
        </div>
        ${days.map((day) => `
          <div class="day-line">
            <div class="day-name">${day}${fac.holidays.includes(day) ? `<br><small class="muted">Holiday</small>` : ""}</div>
            <div class="slot-strip" style="grid-template-columns: repeat(${Math.max(slots.length, 1)}, minmax(148px, 1fr));">
              ${slots.length ? slots.map((slot, index) => facultyCellHtml({ fac, day, slot, index, exportMode, conflictSet })).join("") : `<div class="routine-cell"><span class="time-label">No slots</span></div>`}
            </div>
          </div>
        `).join("")}
      </section>
    `).join("");
  }

  function facultyCellHtml({ fac, day, slot, index, exportMode, conflictSet }) {
    const start = slot.start;
    const end = slot.end;
    const blocked = fac.holidays.includes(day) || rangeBlocked(fac.blocks, day, start, end);
    const startedEvents = state.routine.events.filter((event) => event.facultyIds.includes(fac.id) && event.day === day && event.start === start);
    const covering = !startedEvents.length && state.routine.events.some((event) => event.facultyIds.includes(fac.id) && event.day === day && overlaps(start, end, event.start, event.end));
    const classes = ["routine-cell"];
    if (blocked) classes.push("blocked");
    if (covering) classes.push("continued");
    const data = exportMode ? "" : `data-fac="${fac.id}" data-day="${day}" data-start="${start}" data-end="${end}" data-slot-index="${index}"`;
    return `
      <div class="${classes.join(" ")}" ${data}>
        <span class="time-label">${minToTime(start)}-${minToTime(end)}</span>
        ${startedEvents.map((event) => classCardHtml(event, { exportMode, conflict: conflictSet.has(event.id) })).join("")}
        ${blocked && !startedEvents.length ? `<span class="pill rose">${fac.holidays.includes(day) ? "Holiday" : "Blocked"}</span>` : ""}
        ${covering && !startedEvents.length ? `<span class="hint">Continues</span>` : ""}
      </div>
    `;
  }

  function classCardHtml(event, { exportMode, conflict }) {
    const subject = getSubject(event.subjectId);
    const typeClass = subjectTypeClass(event.type || (subject && subject.type));
    const semNames = event.semIds.map((id) => getSemester(id)).filter(Boolean).map((sem) => sem.name).join(", ");
    const facultyNames = event.facultyIds.map((id) => getFaculty(id)).filter(Boolean).map((fac) => fac.name).join(", ");
    return `
      <div class="class-pill ${typeClass} ${conflict ? "conflict" : ""}" draggable="${exportMode ? "false" : "true"}" data-event-id="${event.id}">
        <div class="class-code-row">
          <b class="class-code">${esc(event.subjectCode || (subject && subject.code) || "Class")}</b>
          <span class="class-time">${esc(event.day)} ${minToTime(event.start)}-${minToTime(event.end)}</span>
        </div>
        <span>${esc(event.subjectName || (subject && subject.name) || "")}</span>
        <div class="class-meta-row">
          <span class="mini-pill">${esc(semNames)}</span>
          <span class="mini-pill">${esc(facultyNames || "No faculty")}</span>
          ${event.locked ? `<span class="mini-pill">Locked</span>` : ""}
          ${event.manual ? `<span class="mini-pill">Edited</span>` : ""}
        </div>
        ${exportMode ? "" : `
          <div class="class-actions">
            <button data-action="toggle-event-lock" data-event="${event.id}" title="${event.locked ? "Unlock class" : "Lock class"}"><i data-lucide="${event.locked ? "lock" : "unlock"}"></i></button>
            <button data-action="delete-event" data-event="${event.id}" title="Delete class"><i data-lucide="trash-2"></i></button>
          </div>
        `}
      </div>
    `;
  }

  function healthViewHtml(metrics) {
    const maxLoad = Math.max(1, ...state.faculties.map((fac) => facultyLoad(fac.id)));
    return `
      <div class="layout">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h2>Faculty Load Distribution</h2>
              <p>Loads count consecutive periods, so a two-period lab counts as two.</p>
            </div>
          </div>
          <div class="panel-body">
            ${state.faculties.map((fac) => {
              const load = facultyLoad(fac.id);
              return `
                <div class="load-row">
                  <div>
                    <strong>${esc(fac.name)}</strong>
                    <div class="bar"><span style="width:${Math.round((load / maxLoad) * 100)}%"></span></div>
                  </div>
                  <span class="pill green">${load} periods</span>
                </div>
              `;
            }).join("") || `<p class="hint">No faculty yet.</p>`}
          </div>
        </div>
        <aside class="panel">
          <div class="panel-header">
            <div>
              <h3>Conflict Inspector</h3>
              <p>Hard conflicts should be zero after generation.</p>
            </div>
          </div>
          <div class="panel-body">
            <ul class="warning-list">
              ${metrics.conflicts.map((item) => `<li class="critical">${esc(item)}</li>`).join("") || `<li>No hard conflicts detected.</li>`}
              ${metrics.sameSubjectWarnings.map((item) => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </div>
        </aside>
      </div>
    `;
  }

  function routineWarningsHtml(metrics) {
    const items = [];
    state.routine.unscheduled.forEach((item) => {
      items.push(`<li class="critical">${esc(item.label)} could not be placed: ${esc(item.reason || "No valid slot")}</li>`);
    });
    metrics.conflicts.slice(0, 8).forEach((item) => items.push(`<li class="critical">${esc(item)}</li>`));
    metrics.sameSubjectWarnings.slice(0, 6).forEach((item) => items.push(`<li>${esc(item)}</li>`));
    if (!items.length) return "";
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Warnings</h3>
            <p>Review these before exporting.</p>
          </div>
        </div>
        <div class="panel-body">
          <ul class="warning-list">${items.join("")}</ul>
        </div>
      </div>
    `;
  }

  function slotRowHtml(slot, meta) {
    const attrs = Object.entries(meta).map(([key, value]) => `data-${dash(key)}="${attr(value)}"`).join(" ");
    const cls = meta.kind === "common" ? "common-slot-field" : "sem-slot-field";
    return `
      <div class="slot-row compact">
        <div class="field">
          <label>Label</label>
          <input class="${cls}" ${attrs} data-field="label" value="${attr(slot.label)}">
        </div>
        <div class="field">
          <label>Start</label>
          <input class="${cls}" ${attrs} data-field="start" type="time" value="${attr(slot.start)}">
        </div>
        <div class="field">
          <label>Minutes</label>
          <input class="${cls}" ${attrs} data-field="duration" type="number" min="5" max="240" value="${attr(slot.duration)}">
        </div>
        <div class="field">
          <label>Ends</label>
          <output>${slotEnd(slot)}</output>
        </div>
        <button class="btn icon danger" data-action="${meta.kind === "common" ? "remove-common-slot" : "remove-sem-slot"}" ${attrs} title="Remove slot"><i data-lucide="x"></i></button>
      </div>
    `;
  }

  function blockGridHtml(kind, ownerId, days, slotsForDay, blocks) {
    return `
      <div class="block-grid">
        ${days.map((day) => {
          const slots = slotsForDay(day);
          return `
            <div class="block-day">
              <div class="day-name">${day}</div>
              <div class="block-slots">
                ${slots.length ? slots.map((slot) => {
                  const start = timeToMin(slot.start);
                  const end = slotEndMin(slot);
                  const active = rangeBlocked(blocks, day, start, end);
                  return `<button class="block-slot ${active ? "active" : ""}" data-action="toggle-${kind}-block" data-owner="${ownerId}" data-day="${day}" data-start="${start}" data-end="${end}">${esc(slot.label)}<br>${minToTime(start)}-${minToTime(end)}</button>`;
                }).join("") : `<span class="hint">No slots</span>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function chip(className, text, checked, label, title, data) {
    const attrs = Object.entries(data || {}).map(([key, value]) => `data-${dash(key)}="${attr(value)}"`).join(" ");
    return `
      <label class="chip-check" title="${attr(title || label || text)}">
        <input class="${className}" type="checkbox" ${checked ? "checked" : ""} ${attrs}>
        <span>${esc(text)}</span>
      </label>
    `;
  }

  function emptyHtml(icon, message) {
    return `
      <div class="empty-state">
        <div>
          <i data-lucide="${icon}"></i>
          <div>${esc(message)}</div>
        </div>
      </div>
    `;
  }

  function onClick(event) {
    const tab = event.target.closest(".tab");
    if (tab) {
      state.ui.tab = tab.dataset.tab;
      render();
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) {
      const cell = event.target.closest(".routine-cell");
      if (cell && state.ui.blockMode) toggleRoutineCellBlock(cell);
      return;
    }

    const action = actionEl.dataset.action;
    if (action !== "toggle-sem-block" && action !== "toggle-faculty-block") {
      event.preventDefault();
    }

    switch (action) {
      case "add-common-slot":
        state.commonSlots.push(nextSlotFrom(state.commonSlots));
        break;
      case "remove-common-slot":
        state.commonSlots.splice(Number(actionEl.dataset.index), 1);
        break;
      case "add-semester":
        addSemester();
        break;
      case "clone-semester":
        cloneSemester(actionEl.dataset.sem);
        break;
      case "remove-semester":
        removeSemester(actionEl.dataset.sem);
        break;
      case "copy-common-to-sem":
        copyCommonToSemester(actionEl.dataset.sem);
        break;
      case "add-sem-slot":
        addSemesterSlot(actionEl.dataset.sem, actionEl.dataset.day);
        break;
      case "remove-sem-slot":
        removeSemesterSlot(actionEl.dataset.sem, actionEl.dataset.day, Number(actionEl.dataset.index));
        break;
      case "add-faculty":
        addFaculty();
        break;
      case "remove-faculty":
        removeFaculty(actionEl.dataset.fac);
        break;
      case "add-faculty-choice":
        addFacultyChoice(actionEl.dataset.fac);
        break;
      case "remove-faculty-choice":
        removeFacultyChoice(actionEl.dataset.fac, Number(actionEl.dataset.index));
        break;
      case "add-subject":
        addSubject();
        break;
      case "remove-subject":
        removeSubject(actionEl.dataset.sub);
        break;
      case "toggle-sem-block":
        toggleBlockForOwner("sem", actionEl.dataset.owner, actionEl.dataset.day, Number(actionEl.dataset.start), Number(actionEl.dataset.end));
        break;
      case "toggle-faculty-block":
        toggleBlockForOwner("faculty", actionEl.dataset.owner, actionEl.dataset.day, Number(actionEl.dataset.start), Number(actionEl.dataset.end));
        break;
      case "generate-routine":
        generateRoutine();
        break;
      case "clear-routine":
        state.routine.events = [];
        state.routine.unscheduled = [];
        state.routine.stats = null;
        toast("Routine cleared.");
        break;
      case "set-routine-view":
        state.ui.routineView = actionEl.dataset.view;
        break;
      case "toggle-block-mode":
        state.ui.blockMode = !state.ui.blockMode;
        break;
      case "toggle-event-lock":
        toggleEventLock(actionEl.dataset.event);
        break;
      case "delete-event":
        deleteEvent(actionEl.dataset.event);
        break;
      case "export-xlsx":
        exportXlsx();
        return;
      case "export-pdf":
        exportPdf();
        return;
      case "export-png":
        exportImage("png");
        return;
      case "export-jpg":
        exportImage("jpeg");
        return;
      case "export-json":
        exportJson();
        return;
      case "import-csv":
        pendingCsvSection = actionEl.dataset.section;
        $("#csvFile").click();
        return;
      case "download-demo-csv":
        downloadDemoCsv(actionEl.dataset.section);
        return;
      default:
        break;
    }
    render();
  }

  function onInput(event) {
    if (updateFromControl(event.target)) saveState();
  }

  function onChange(event) {
    const target = event.target;
    if (target.id === "jsonFile") {
      importJsonFile(target.files[0]);
      target.value = "";
      return;
    }
    if (target.id === "csvFile") {
      importCsvFile(target.files[0], pendingCsvSection);
      pendingCsvSection = null;
      target.value = "";
      return;
    }
    if (updateFromControl(target)) {
      render();
    }
  }

  function updateFromControl(target) {
    if (!target || !target.classList) return false;
    if (target.classList.contains("common-day-input")) {
      setDayChecked(state.commonDays, target.dataset.day, target.checked);
      state.commonDays = sortDays(state.commonDays);
      return true;
    }
    if (target.classList.contains("common-slot-field")) {
      updateSlot(state.commonSlots[Number(target.dataset.index)], target.dataset.field, target.value);
      state.commonSlots = normalizeSlots(state.commonSlots);
      return true;
    }
    if (target.classList.contains("sem-name-field")) {
      const sem = getSemester(target.dataset.sem);
      if (sem) sem.name = target.value;
      return true;
    }
    if (target.classList.contains("sem-use-common-days")) {
      const sem = getSemester(target.dataset.sem);
      if (sem) sem.useCommonDays = target.value === "true";
      return true;
    }
    if (target.classList.contains("sem-use-common-slots")) {
      const sem = getSemester(target.dataset.sem);
      if (sem) {
        sem.useCommonSlots = target.value === "true";
        if (!sem.useCommonSlots && !countSemSlots(sem)) copyCommonToSemester(sem.id);
      }
      return true;
    }
    if (target.classList.contains("sem-day-input")) {
      const sem = getSemester(target.dataset.sem);
      if (sem) {
        setDayChecked(sem.days, target.dataset.day, target.checked);
        sem.days = sortDays(sem.days);
      }
      return true;
    }
    if (target.classList.contains("sem-slot-field")) {
      const sem = getSemester(target.dataset.sem);
      if (sem) {
        const day = target.dataset.day;
        sem.slotsByDay[day] = sem.slotsByDay[day] || [];
        updateSlot(sem.slotsByDay[day][Number(target.dataset.index)], target.dataset.field, target.value);
        sem.slotsByDay[day] = normalizeSlots(sem.slotsByDay[day]);
      }
      return true;
    }
    if (target.classList.contains("faculty-name-field")) {
      const fac = getFaculty(target.dataset.fac);
      if (fac) fac.name = target.value;
      return true;
    }
    if (target.classList.contains("faculty-subjects-field")) {
      const fac = getFaculty(target.dataset.fac);
      if (fac) fac.subjects = parseChoiceText(target.value);
      return true;
    }
    if (target.classList.contains("faculty-holiday-input")) {
      const fac = getFaculty(target.dataset.fac);
      if (fac) {
        setDayChecked(fac.holidays, target.dataset.day, target.checked);
        fac.holidays = sortDays(fac.holidays);
      }
      return true;
    }
    if (target.classList.contains("subject-field")) {
      const sub = getSubject(target.dataset.sub);
      if (sub) {
        const field = target.dataset.field;
        if (["weeklyCount", "durationSlots", "facultyCount"].includes(field)) {
          sub[field] = clampInt(target.value, 1, field === "weeklyCount" ? 12 : 6, 1);
        } else if (field === "autoFacultyPool") {
          sub.autoFacultyPool = target.value === "true";
        } else {
          sub[field] = target.value;
        }
      }
      return true;
    }
    if (target.classList.contains("subject-sem-input")) {
      const sub = getSubject(target.dataset.sub);
      if (sub) setChecked(sub.semIds, target.dataset.sem, target.checked);
      return true;
    }
    if (target.classList.contains("subject-faculty-input")) {
      const sub = getSubject(target.dataset.sub);
      if (sub) setChecked(sub.candidateFacultyIds, target.dataset.fac, target.checked);
      return true;
    }
    if (target.classList.contains("ui-field")) {
      state.ui[target.dataset.field] = target.value;
      return true;
    }
    if (target.classList.contains("ui-checkbox")) {
      state.ui[target.dataset.field] = target.checked;
      return true;
    }
    return false;
  }

  function onDragStart(event) {
    const card = event.target.closest(".class-pill[draggable='true']");
    if (!card) return;
    draggedEventId = card.dataset.eventId;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedEventId);
  }

  function onDragEnd(event) {
    const card = event.target.closest(".class-pill");
    if (card) card.classList.remove("dragging");
    $$(".routine-cell.drop-ready").forEach((cell) => cell.classList.remove("drop-ready"));
    draggedEventId = null;
  }

  function onDragOver(event) {
    const cell = event.target.closest(".routine-cell[data-sem], .routine-cell[data-fac]");
    if (!cell || !draggedEventId) return;
    event.preventDefault();
    cell.classList.add("drop-ready");
  }

  function onDragLeave(event) {
    const cell = event.target.closest(".routine-cell.drop-ready");
    if (cell) cell.classList.remove("drop-ready");
  }

  function onDrop(event) {
    const cell = event.target.closest(".routine-cell[data-sem], .routine-cell[data-fac]");
    if (!cell) return;
    event.preventDefault();
    const eventId = event.dataTransfer.getData("text/plain") || draggedEventId;
    const result = moveEventToCell(eventId, cell);
    if (result.ok) {
      toast("Class moved.");
    } else {
      toast(result.reason || "That slot is not valid.");
    }
    render();
  }

  function addSemester() {
    const sem = {
      id: newId("sem"),
      name: `Sem ${state.semesters.length ? state.semesters.length * 2 + 1 : 1}`,
      useCommonDays: true,
      useCommonSlots: true,
      days: [...state.commonDays],
      slotsByDay: {},
      blocks: []
    };
    state.semesters.push(sem);
    state.ui.blockSemId = sem.id;
  }

  function cloneSemester(id) {
    const sem = getSemester(id);
    if (!sem) return;
    const copy = deepClone(sem);
    copy.id = newId("sem");
    copy.name = `${sem.name} Copy`;
    copy.blocks = [];
    state.semesters.push(copy);
  }

  function removeSemester(id) {
    state.semesters = state.semesters.filter((sem) => sem.id !== id);
    state.subjects.forEach((sub) => {
      sub.semIds = sub.semIds.filter((semId) => semId !== id);
    });
    state.routine.events = state.routine.events.filter((event) => !event.semIds.includes(id));
  }

  function copyCommonToSemester(id) {
    const sem = getSemester(id);
    if (!sem) return;
    getActiveDays(sem).forEach((day) => {
      sem.slotsByDay[day] = cloneSlots(state.commonSlots);
    });
  }

  function addSemesterSlot(semId, day) {
    const sem = getSemester(semId);
    if (!sem) return;
    sem.slotsByDay[day] = sem.slotsByDay[day] || [];
    sem.slotsByDay[day].push(nextSlotFrom(sem.slotsByDay[day]));
    sem.slotsByDay[day] = normalizeSlots(sem.slotsByDay[day]);
  }

  function removeSemesterSlot(semId, day, index) {
    const sem = getSemester(semId);
    if (!sem || !sem.slotsByDay[day]) return;
    sem.slotsByDay[day].splice(index, 1);
  }

  function addFaculty() {
    const fac = {
      id: newId("fac"),
      name: `Faculty ${state.faculties.length + 1}`,
      subjects: [],
      holidays: ["Sat", "Sun"],
      blocks: []
    };
    state.faculties.push(fac);
    state.ui.blockFacultyId = fac.id;
  }

  function removeFaculty(id) {
    state.faculties = state.faculties.filter((fac) => fac.id !== id);
    state.subjects.forEach((sub) => {
      sub.candidateFacultyIds = sub.candidateFacultyIds.filter((facId) => facId !== id);
    });
    state.routine.events.forEach((event) => {
      event.facultyIds = event.facultyIds.filter((facId) => facId !== id);
    });
  }

  function addSubject() {
    const firstSem = state.semesters[0];
    state.subjects.push({
      id: newId("sub"),
      code: `SUB${state.subjects.length + 1}`,
      name: "New Subject",
      type: "Theory",
      weeklyCount: 3,
      durationSlots: 1,
      facultyCount: 1,
      semIds: firstSem ? [firstSem.id] : [],
      autoFacultyPool: true,
      candidateFacultyIds: [],
      notes: ""
    });
  }

  function removeSubject(id) {
    state.subjects = state.subjects.filter((sub) => sub.id !== id);
    state.routine.events = state.routine.events.filter((event) => event.subjectId !== id);
  }

  function toggleBlockForOwner(kind, ownerId, day, start, end) {
    const owner = kind === "sem" ? getSemester(ownerId) : getFaculty(ownerId);
    if (!owner) return;
    toggleBlock(owner.blocks, day, start, end);
  }

  function toggleRoutineCellBlock(cell) {
    if (cell.dataset.sem) {
      const sem = getSemester(cell.dataset.sem);
      const slots = sem ? getSlots(sem, cell.dataset.day) : [];
      const slot = slots[Number(cell.dataset.slotIndex)];
      if (sem && slot) toggleBlock(sem.blocks, cell.dataset.day, timeToMin(slot.start), slotEndMin(slot));
    } else if (cell.dataset.fac) {
      const fac = getFaculty(cell.dataset.fac);
      if (fac) toggleBlock(fac.blocks, cell.dataset.day, Number(cell.dataset.start), Number(cell.dataset.end));
    }
    render();
  }

  function toggleBlock(blocks, day, start, end) {
    const index = blocks.findIndex((block) => block.day === day && block.start === start && block.end === end);
    if (index >= 0) blocks.splice(index, 1);
    else blocks.push({ day, start, end });
  }

  function toggleEventLock(id) {
    const event = state.routine.events.find((item) => item.id === id);
    if (event) event.locked = !event.locked;
  }

  function deleteEvent(id) {
    state.routine.events = state.routine.events.filter((event) => event.id !== id);
  }

  function generateRoutine() {
    const validation = preflight();
    if (validation.critical.length) {
      toast(validation.critical[0]);
      state.ui.tab = "subjects";
      return;
    }

    const locked = state.ui.keepLocked ? state.routine.events.filter((event) => event.locked).map((event) => ({ ...event })) : [];
    const tasks = buildTasks(locked);
    let best = null;
    const attempts = Math.min(90, Math.max(30, tasks.length * 6));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = runScheduleAttempt(tasks, locked, attempt + 1);
      if (!best || result.rank < best.rank) best = result;
      if (best && best.unscheduled.length === 0 && best.conflicts.length === 0 && attempt > 12) break;
    }

    state.routine.events = best.events;
    state.routine.unscheduled = best.unscheduled;
    state.routine.stats = {
      score: Math.round(best.score),
      attempts,
      generatedTasks: tasks.length
    };
    state.routine.lastGenerated = new Date().toISOString();
    state.ui.tab = "routine";
    state.ui.routineView = "sem";
    toast(`Generated ${best.events.length} classes with ${best.unscheduled.length} unscheduled.`);
  }

  function preflight() {
    const critical = [];
    if (!state.semesters.length) critical.push("Add at least one semester.");
    if (!state.faculties.length) critical.push("Add at least one faculty member.");
    if (!state.subjects.length) critical.push("Add at least one subject.");
    state.subjects.forEach((sub) => {
      if (!sub.semIds.length) critical.push(`${sub.code} needs at least one semester.`);
      if (candidateFacultyIdsForSubject(sub).length < sub.facultyCount) critical.push(`${sub.code} does not have enough candidate faculty.`);
    });
    return { critical };
  }

  function buildTasks(locked) {
    const lockedCounts = new Map();
    locked.forEach((event) => {
      lockedCounts.set(event.subjectId, (lockedCounts.get(event.subjectId) || 0) + 1);
    });
    const tasks = [];
    state.subjects.forEach((sub) => {
      const remaining = Math.max(0, sub.weeklyCount - (lockedCounts.get(sub.id) || 0));
      for (let i = 0; i < remaining; i += 1) {
        tasks.push({
          id: `${sub.id}_${i}`,
          subjectId: sub.id,
          label: `${sub.code} ${sub.name} (${i + 1}/${sub.weeklyCount})`
        });
      }
    });
    return tasks;
  }

  function runScheduleAttempt(tasks, locked, seed) {
    const rng = mulberry32(seed * 1327 + 11);
    const events = locked.map((event) => ({ ...event }));
    const ordered = [...tasks].sort((a, b) => taskDifficulty(b.subjectId) - taskDifficulty(a.subjectId) || rng() - 0.5);
    const unscheduled = [];
    let score = 0;

    ordered.forEach((task) => {
      const sub = getSubject(task.subjectId);
      const placement = findBestPlacement(sub, events, rng);
      if (placement) {
        events.push(makeEvent(sub, placement));
        score += placement.score;
      } else {
        unscheduled.push({ label: task.label, reason: "No collision-free slot satisfies all semesters, faculty, holidays, and blocks." });
        score += 10000;
      }
    });

    const metrics = calculateMetricsForEvents(events);
    const balancePenalty = metrics.balance * 25;
    const sameSubjectPenalty = metrics.sameSubjectWarnings.length * 70;
    const conflictPenalty = metrics.conflicts.length * 12000;
    const rank = unscheduled.length * 100000 + metrics.conflicts.length * 50000 + balancePenalty + sameSubjectPenalty + score;
    return {
      events,
      unscheduled,
      score: score + balancePenalty + sameSubjectPenalty + conflictPenalty,
      conflicts: metrics.conflicts,
      rank
    };
  }

  function findBestPlacement(sub, events, rng) {
    const sems = sub.semIds.map(getSemester).filter(Boolean);
    if (!sems.length) return null;
    const anchor = sems[0];
    const candidateFacultyIds = candidateFacultyIdsForSubject(sub);
    if (candidateFacultyIds.length < sub.facultyCount) return null;
    const combos = combinations(candidateFacultyIds, sub.facultyCount);
    let best = null;
    const days = intersectionDays(sems.map(getActiveDays));
    const dayOrder = shuffle([...days], rng);

    dayOrder.forEach((day) => {
      const slots = getSlots(anchor, day);
      for (let index = 0; index <= slots.length - sub.durationSlots; index += 1) {
        const start = timeToMin(slots[index].start);
        const end = slotEndMin(slots[index + sub.durationSlots - 1]);
        if (!sems.every((sem) => semHasExactRun(sem, day, start, end, sub.durationSlots))) continue;
        if (!sems.every((sem) => semAvailable(sem.id, day, start, end, events))) continue;

        const comboOrder = shuffle([...combos], rng);
        comboOrder.forEach((facultyIds) => {
          if (!facultyIds.every((facId) => facultyAvailable(facId, day, start, end, events))) return;
          const score = scorePlacement(sub, facultyIds, sems, day, start, end, events, rng);
          if (!best || score < best.score) {
            best = { day, start, end, facultyIds, score };
          }
        });
      }
    });
    return best;
  }

  function makeEvent(sub, placement) {
    return {
      id: newId("evt"),
      subjectId: sub.id,
      subjectCode: sub.code,
      subjectName: sub.name,
      type: sub.type,
      semIds: [...sub.semIds],
      day: placement.day,
      start: placement.start,
      end: placement.end,
      durationSlots: sub.durationSlots,
      facultyIds: [...placement.facultyIds],
      locked: false,
      manual: false
    };
  }

  function scorePlacement(sub, facultyIds, sems, day, start, end, events, rng) {
    let score = rng() * 2;
    const loads = loadMaps(events);
    facultyIds.forEach((facId) => {
      const totalLoad = loads.total.get(facId) || 0;
      const dayLoad = (loads.day.get(facId) && loads.day.get(facId).get(day)) || 0;
      score += totalLoad * 8 + dayLoad * 12;
      score += facultyAdjacencyPenalty(facId, day, start, end, events);
    });
    sems.forEach((sem) => {
      const semDayLoad = events.filter((event) => event.semIds.includes(sem.id) && event.day === day).length;
      score += semDayLoad * 3;
      const sameSubjectSameDay = events.some((event) => event.semIds.includes(sem.id) && event.subjectId === sub.id && event.day === day);
      if (sameSubjectSameDay) score += 20;
    });
    if (sub.type === "Theory") {
      const simultaneous = events.filter((event) => event.type === "Theory" && sameSubject(sub, event) && event.day === day && overlaps(start, end, event.start, event.end)).length;
      score += simultaneous * 80;
    }
    const late = start >= timeToMin("15:00") ? 4 : 0;
    score += late;
    return score;
  }

  function facultyAdjacencyPenalty(facId, day, start, end, events) {
    const sameDay = events
      .filter((event) => event.facultyIds.includes(facId) && event.day === day)
      .sort((a, b) => a.start - b.start);
    let penalty = 0;
    sameDay.forEach((event) => {
      if (event.end === start || event.start === end) penalty += 35;
      if (Math.abs(event.end - start) <= 10 || Math.abs(end - event.start) <= 10) penalty += 20;
    });
    const hypothetical = [...sameDay, { start, end }].sort((a, b) => a.start - b.start);
    let streak = 1;
    for (let i = 1; i < hypothetical.length; i += 1) {
      if (hypothetical[i - 1].end === hypothetical[i].start) {
        streak += 1;
        if (streak >= 3) penalty += 90;
      } else {
        streak = 1;
      }
    }
    return penalty;
  }

  function moveEventToCell(eventId, cell) {
    const event = state.routine.events.find((item) => item.id === eventId);
    if (!event) return { ok: false, reason: "Class not found." };
    const placement = placementFromCell(event, cell);
    if (!placement.ok) return placement;

    const issues = placementIssues(event, placement.day, placement.start, placement.end, placement.facultyIds, event.semIds, [event.id], state.routine.events);
    if (!issues.hard.length && !issues.conflicts.length) {
      if (placement.reassignNote && !window.confirm(`${placement.reassignNote}\n\nApply this faculty change?`)) return { ok: false, reason: "Move cancelled." };
      applyMove(event.id, placement);
      return { ok: true };
    }
    if (issues.hard.length) return { ok: false, reason: issues.hard[0] };

    const plan = buildRepairPlan(event, placement, issues.conflicts);
    if (!plan) {
      return { ok: false, reason: `That move clashes with ${issues.conflicts.map(eventLabel).join(", ")} and no clean switch was found.` };
    }

    if (!window.confirm(repairPlanMessage(event, placement, issues.conflicts, plan))) {
      return { ok: false, reason: "Move cancelled." };
    }
    plan.moves.forEach((move) => applyMove(move.eventId, move));
    return { ok: true };
  }

  function placementFromCell(event, cell) {
    if (cell.dataset.sem) {
      const sem = getSemester(cell.dataset.sem);
      if (!sem) return { ok: false, reason: "Semester not found." };
      if (!event.semIds.includes(sem.id)) return { ok: false, reason: "Move into one of the class semesters." };
      const slots = getSlots(sem, cell.dataset.day);
      const slotIndex = Number(cell.dataset.slotIndex);
      if (slotIndex < 0 || slotIndex + event.durationSlots > slots.length) return { ok: false, reason: "Not enough consecutive periods." };
      return {
        ok: true,
        day: cell.dataset.day,
        start: timeToMin(slots[slotIndex].start),
        end: slotEndMin(slots[slotIndex + event.durationSlots - 1]),
        facultyIds: [...event.facultyIds]
      };
    }

    if (cell.dataset.fac) {
      const targetFac = getFaculty(cell.dataset.fac);
      if (!targetFac) return { ok: false, reason: "Faculty not found." };
      const start = Number(cell.dataset.start);
      const run = runForEventAt(event, cell.dataset.day, start);
      if (!run) return { ok: false, reason: "That faculty cell does not line up with the class semesters." };
      const facultyPlan = facultyIdsForDrop(event, targetFac.id);
      if (!facultyPlan.ok) return facultyPlan;
      return {
        ok: true,
        day: cell.dataset.day,
        start,
        end: run.end,
        facultyIds: facultyPlan.facultyIds,
        reassignNote: facultyPlan.reassignNote || ""
      };
    }

    return { ok: false, reason: "Drop on a routine slot." };
  }

  function facultyIdsForDrop(event, targetFacId) {
    if (event.facultyIds.includes(targetFacId)) return { ok: true, facultyIds: [...event.facultyIds] };
    const subject = getSubject(event.subjectId);
    if (!subject || !candidateFacultyIdsForSubject(subject).includes(targetFacId)) {
      return { ok: false, reason: "That faculty member is not a candidate for this subject." };
    }
    if (event.facultyIds.length !== 1) {
      return { ok: false, reason: "Multi-faculty classes can be moved only within their assigned faculty routines." };
    }
    const oldFaculty = getFaculty(event.facultyIds[0]);
    const newFaculty = getFaculty(targetFacId);
    return {
      ok: true,
      facultyIds: [targetFacId],
      reassignNote: `This will reassign ${eventLabel(event)} from ${oldFaculty?.name || "the current faculty"} to ${newFaculty?.name || "the target faculty"}.`
    };
  }

  function runForEventAt(event, day, start) {
    const anchor = event.semIds.map(getSemester).find(Boolean);
    if (!anchor) return null;
    const slots = getSlots(anchor, day);
    const index = slots.findIndex((slot) => timeToMin(slot.start) === Number(start));
    if (index < 0 || index + event.durationSlots > slots.length) return null;
    const end = slotEndMin(slots[index + event.durationSlots - 1]);
    return event.semIds.every((semId) => {
      const sem = getSemester(semId);
      return sem && semHasExactRun(sem, day, start, end, event.durationSlots);
    }) ? { start, end } : null;
  }

  function buildRepairPlan(event, placement, conflicts) {
    if (conflicts.some((item) => item.locked)) return null;
    const directMoves = [
      { eventId: event.id, day: placement.day, start: placement.start, end: placement.end, facultyIds: [...placement.facultyIds], manual: true, note: "requested move" },
      ...conflicts.map((item) => {
        const run = runForEventAt(item, event.day, event.start);
        return run ? {
          eventId: item.id,
          day: event.day,
          start: event.start,
          end: run.end,
          facultyIds: [...item.facultyIds],
          manual: true,
          note: `switch into ${eventLabel(event)}'s old slot`
        } : null;
      }).filter(Boolean)
    ];
    if (directMoves.length === conflicts.length + 1 && movesAreValid(directMoves)) return { moves: directMoves, type: "swap" };

    const relocationMoves = [{ eventId: event.id, day: placement.day, start: placement.start, end: placement.end, facultyIds: [...placement.facultyIds], manual: true, note: "requested move" }];
    let tempEvents = projectedEvents(relocationMoves);
    for (const conflict of conflicts) {
      const relocation = findFreePlacementForExistingEvent(conflict, tempEvents, { day: placement.day, start: placement.start, end: placement.end });
      if (!relocation) return null;
      relocationMoves.push({ ...relocation, eventId: conflict.id, manual: true, note: "relocated to clear clash" });
      tempEvents = projectedEvents(relocationMoves);
    }
    return movesAreValid(relocationMoves) ? { moves: relocationMoves, type: "relocation" } : null;
  }

  function findFreePlacementForExistingEvent(event, events, avoid) {
    const sems = event.semIds.map(getSemester).filter(Boolean);
    const days = intersectionDays(sems.map(getActiveDays));
    let best = null;
    days.forEach((day) => {
      const anchor = sems[0];
      const slots = anchor ? getSlots(anchor, day) : [];
      for (let index = 0; index <= slots.length - event.durationSlots; index += 1) {
        const start = timeToMin(slots[index].start);
        const end = slotEndMin(slots[index + event.durationSlots - 1]);
        if (avoid && day === avoid.day && overlaps(start, end, avoid.start, avoid.end)) continue;
        const issues = placementIssues(event, day, start, end, event.facultyIds, event.semIds, [event.id], events);
        if (issues.hard.length || issues.conflicts.length) continue;
        const distance = Math.abs(start - event.start) + (day === event.day ? 0 : 180) + facultyAdjacencyPenalty(event.facultyIds[0], day, start, end, events);
        if (!best || distance < best.score) best = { day, start, end, facultyIds: [...event.facultyIds], score: distance };
      }
    });
    return best;
  }

  function movesAreValid(moves) {
    const events = projectedEvents(moves);
    return moves.every((move) => {
      const event = events.find((item) => item.id === move.eventId);
      if (!event) return false;
      const issues = placementIssues(event, event.day, event.start, event.end, event.facultyIds, event.semIds, [event.id], events);
      return !issues.hard.length && !issues.conflicts.length;
    });
  }

  function projectedEvents(moves) {
    const events = state.routine.events.map((event) => ({
      ...event,
      semIds: [...event.semIds],
      facultyIds: [...event.facultyIds]
    }));
    moves.forEach((move) => {
      const event = events.find((item) => item.id === move.eventId);
      if (!event) return;
      event.day = move.day;
      event.start = move.start;
      event.end = move.end;
      event.facultyIds = [...move.facultyIds];
      event.manual = true;
    });
    return events;
  }

  function applyMove(eventId, move) {
    const event = state.routine.events.find((item) => item.id === eventId);
    if (!event) return;
    event.day = move.day;
    event.start = move.start;
    event.end = move.end;
    event.facultyIds = [...move.facultyIds];
    event.manual = true;
  }

  function repairPlanMessage(event, placement, conflicts, plan) {
    const lines = [
      `${eventLabel(event)} cannot move directly to ${slotDescription(placement)} because it clashes with:`,
      ...conflicts.map((item) => `- ${eventLabel(item)} at ${slotDescription(item)}`),
      "",
      "Routine Studio can apply this switch plan:",
      ...plan.moves.map((move, index) => {
        const movedEvent = state.routine.events.find((item) => item.id === move.eventId);
        return `${index + 1}. Move ${eventLabel(movedEvent)} to ${slotDescription(move)}${move.note ? ` (${move.note})` : ""}.`;
      })
    ];
    if (placement.reassignNote) lines.push("", placement.reassignNote);
    lines.push("", "Apply these changes?");
    return lines.join("\n");
  }

  function eventLabel(event) {
    if (!event) return "Unknown class";
    return `${event.subjectCode || "Class"} ${event.subjectName || ""}`.trim();
  }

  function slotDescription(item) {
    return `${item.day} ${minToTime(item.start)}-${minToTime(item.end)}`;
  }

  function placementIssues(event, day, start, end, facultyIds, semIds, ignoreIds, events) {
    const ignore = toIgnoreSet(ignoreIds);
    const hard = [];
    const conflicts = [];
    semIds.forEach((semId) => {
      const sem = getSemester(semId);
      if (!sem) hard.push("Semester missing.");
      else if (!semHasExactRun(sem, day, start, end, event.durationSlots)) hard.push(`${sem.name} does not have matching consecutive periods.`);
      else if (rangeBlocked(sem.blocks, day, start, end)) hard.push(`${sem.name} has that slot blocked.`);
    });
    facultyIds.forEach((facId) => {
      const fac = getFaculty(facId);
      if (!fac) hard.push("Faculty missing.");
      else if (fac.holidays.includes(day)) hard.push(`${fac.name} is on holiday that day.`);
      else if (rangeBlocked(fac.blocks, day, start, end)) hard.push(`${fac.name} is blocked at that time.`);
    });
    (events || state.routine.events).forEach((other) => {
      if (ignore.has(other.id) || other.day !== day || !overlaps(start, end, other.start, other.end)) return;
      if (other.semIds.some((semId) => semIds.includes(semId)) || other.facultyIds.some((facId) => facultyIds.includes(facId))) {
        conflicts.push(other);
      }
    });
    return { hard: [...new Set(hard)], conflicts: uniqueEvents(conflicts) };
  }

  function validateEventPlacement(event, day, start, end, facultyIds, semIds, ignoreId, events = state.routine.events) {
    const issues = placementIssues(event, day, start, end, facultyIds, semIds, ignoreId, events);
    if (issues.hard.length) return { ok: false, reason: issues.hard[0] };
    if (issues.conflicts.length) return { ok: false, reason: `Clashes with ${issues.conflicts.map(eventLabel).join(", ")}.` };
    return { ok: true };
  }

  function semAvailable(semId, day, start, end, events, ignoreId) {
    const sem = getSemester(semId);
    if (!sem) return false;
    if (rangeBlocked(sem.blocks, day, start, end)) return false;
    const ignore = toIgnoreSet(ignoreId);
    return !events.some((event) => !ignore.has(event.id) && event.semIds.includes(semId) && event.day === day && overlaps(start, end, event.start, event.end));
  }

  function facultyAvailable(facId, day, start, end, events, ignoreId) {
    const fac = getFaculty(facId);
    if (!fac) return false;
    if (fac.holidays.includes(day)) return false;
    if (rangeBlocked(fac.blocks, day, start, end)) return false;
    const ignore = toIgnoreSet(ignoreId);
    return !events.some((event) => !ignore.has(event.id) && event.facultyIds.includes(facId) && event.day === day && overlaps(start, end, event.start, event.end));
  }

  function toIgnoreSet(ignoreIds) {
    if (ignoreIds instanceof Set) return ignoreIds;
    if (Array.isArray(ignoreIds)) return new Set(ignoreIds);
    return new Set(ignoreIds ? [ignoreIds] : []);
  }

  function uniqueEvents(events) {
    const seen = new Set();
    return events.filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  }

  function semHasExactRun(sem, day, start, end, durationSlots) {
    if (!getActiveDays(sem).includes(day)) return false;
    const slots = getSlots(sem, day);
    for (let i = 0; i <= slots.length - durationSlots; i += 1) {
      if (timeToMin(slots[i].start) === start && slotEndMin(slots[i + durationSlots - 1]) === end) return true;
    }
    return false;
  }

  function calculateMetrics() {
    return calculateMetricsForEvents(state.routine.events);
  }

  function calculateMetricsForEvents(events) {
    const conflicts = [];
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const a = events[i];
        const b = events[j];
        if (a.day !== b.day || !overlaps(a.start, a.end, b.start, b.end)) continue;
        const semHit = a.semIds.find((id) => b.semIds.includes(id));
        if (semHit) {
          conflicts.push(`${getSemester(semHit)?.name || "A semester"} has overlapping classes: ${a.subjectCode} and ${b.subjectCode} on ${a.day} ${minToTime(a.start)}.`);
        }
        const facHit = a.facultyIds.find((id) => b.facultyIds.includes(id));
        if (facHit) {
          conflicts.push(`${getFaculty(facHit)?.name || "A faculty member"} has overlapping classes: ${a.subjectCode} and ${b.subjectCode} on ${a.day} ${minToTime(a.start)}.`);
        }
      }
    }
    events.forEach((event) => {
      event.semIds.forEach((semId) => {
        const sem = getSemester(semId);
        if (sem && rangeBlocked(sem.blocks, event.day, event.start, event.end)) conflicts.push(`${sem.name} has ${event.subjectCode} inside a blocked slot.`);
      });
      event.facultyIds.forEach((facId) => {
        const fac = getFaculty(facId);
        if (fac && fac.holidays.includes(event.day)) conflicts.push(`${fac.name} has ${event.subjectCode} on a holiday.`);
        if (fac && rangeBlocked(fac.blocks, event.day, event.start, event.end)) conflicts.push(`${fac.name} has ${event.subjectCode} inside a blocked slot.`);
      });
    });

    const sameSubjectWarnings = [];
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const a = events[i];
        const b = events[j];
        if (a.type === "Theory" && b.type === "Theory" && norm(a.subjectCode) === norm(b.subjectCode) && a.day === b.day && overlaps(a.start, a.end, b.start, b.end)) {
          sameSubjectWarnings.push(`${a.subjectCode} theory runs simultaneously on ${a.day} ${minToTime(Math.max(a.start, b.start))}.`);
        }
      }
    }

    const loads = state.faculties.map((fac) => facultyLoad(fac.id, events));
    const max = loads.length ? Math.max(...loads) : 0;
    const min = loads.length ? Math.min(...loads) : 0;
    return {
      totalEvents: events.length,
      unscheduledCount: state.routine.unscheduled.length,
      conflicts,
      sameSubjectWarnings,
      balance: max - min
    };
  }

  function getConflictEventSet() {
    const set = new Set();
    const events = state.routine.events;
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const a = events[i];
        const b = events[j];
        if (a.day !== b.day || !overlaps(a.start, a.end, b.start, b.end)) continue;
        if (a.semIds.some((id) => b.semIds.includes(id)) || a.facultyIds.some((id) => b.facultyIds.includes(id))) {
          set.add(a.id);
          set.add(b.id);
        }
      }
    }
    return set;
  }

  function exportJson() {
    downloadFile(`routine-studio-${dateStamp()}.json`, JSON.stringify(state, null, 2), "application/json");
  }

  function importJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = normalizeState(JSON.parse(reader.result));
        toast("Project imported.");
        render();
      } catch (error) {
        console.error(error);
        toast("Could not import that JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function importCsvFile(file, section) {
    if (!file || !section) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = csvObjectRows(parseCsv(String(reader.result || "")));
        if (!rows.length) {
          toast("That CSV has no data rows.");
          return;
        }
        const count = importCsvRows(section, rows);
        state.routine.events = [];
        state.routine.unscheduled = [];
        state.routine.stats = null;
        toast(`Imported ${count} ${section} row${count === 1 ? "" : "s"}.`);
        render();
      } catch (error) {
        console.error(error);
        toast("Could not import that CSV file.");
      }
    };
    reader.readAsText(file);
  }

  function importCsvRows(section, rows) {
    if (section === "semesters") return importSemesterRows(rows);
    if (section === "faculty") return importFacultyRows(rows);
    if (section === "subjects") return importSubjectRows(rows);
    return 0;
  }

  function importSemesterRows(rows) {
    rows.forEach((row) => {
      const name = rowValue(row, "name") || `Sem ${state.semesters.length + 1}`;
      const sem = findSemesterByName(name) || {
        id: newId("sem"),
        name,
        useCommonDays: false,
        useCommonSlots: true,
        days: [...state.commonDays],
        slotsByDay: {},
        blocks: []
      };
      const isNew = !state.semesters.includes(sem);
      const days = parseDays(rowValue(row, "days"));
      const slotsByDay = parseSlotsByDay(rowValue(row, "slots_by_day"), rowValue(row, "slots"), days.length ? days : state.commonDays);
      sem.name = name;
      sem.useCommonDays = parseBool(rowValue(row, "use_common_days"), !days.length);
      sem.days = days.length ? days : [...state.commonDays];
      sem.useCommonSlots = parseBool(rowValue(row, "use_common_slots"), !Object.values(slotsByDay).some((slots) => slots.length));
      sem.slotsByDay = normalizeSlotsByDay(slotsByDay);
      sem.blocks = parseBlocks(rowValue(row, "blocks"));
      if (!sem.useCommonSlots && !countSemSlots(sem)) copyCommonToImportedSemester(sem);
      if (isNew) state.semesters.push(sem);
    });
    return rows.length;
  }

  function importFacultyRows(rows) {
    rows.forEach((row) => {
      const name = rowValue(row, "name") || `Faculty ${state.faculties.length + 1}`;
      const fac = findFacultyByName(name) || {
        id: newId("fac"),
        name,
        subjects: [],
        holidays: ["Sat", "Sun"],
        blocks: []
      };
      const isNew = !state.faculties.includes(fac);
      fac.name = name;
      fac.subjects = splitList(rowValue(row, "subject_preferences") || rowValue(row, "subjects"));
      fac.holidays = parseDays(rowValue(row, "holidays"));
      if (!fac.holidays.length) fac.holidays = ["Sat", "Sun"];
      fac.blocks = parseBlocks(rowValue(row, "blocks"));
      if (isNew) state.faculties.push(fac);
    });
    return rows.length;
  }

  function importSubjectRows(rows) {
    rows.forEach((row) => {
      const code = rowValue(row, "code") || `SUB${state.subjects.length + 1}`;
      const sub = findSubjectByCode(code) || {
        id: newId("sub"),
        code,
        name: rowValue(row, "name") || code,
        type: "Theory",
        weeklyCount: 3,
        durationSlots: 1,
        facultyCount: 1,
        semIds: [],
        autoFacultyPool: true,
        candidateFacultyIds: [],
        notes: ""
      };
      const isNew = !state.subjects.includes(sub);
      sub.code = code;
      sub.name = rowValue(row, "name") || code;
      sub.type = rowValue(row, "type") || "Theory";
      sub.weeklyCount = clampInt(rowValue(row, "weekly_count") || rowValue(row, "weekly_classes"), 1, 12, 3);
      sub.durationSlots = clampInt(rowValue(row, "duration_slots") || rowValue(row, "duration"), 1, 6, 1);
      sub.facultyCount = clampInt(rowValue(row, "faculty_count"), 1, 4, 1);
      sub.semIds = splitList(rowValue(row, "semesters")).map((name) => ensureSemesterByName(name).id);
      sub.autoFacultyPool = parseBool(rowValue(row, "auto_faculty_pool"), true);
      sub.candidateFacultyIds = splitList(rowValue(row, "candidate_faculty") || rowValue(row, "faculty")).map((name) => ensureFacultyByName(name, code).id);
      sub.notes = rowValue(row, "notes");
      sub.candidateFacultyIds.forEach((facId) => {
        const fac = getFaculty(facId);
        if (fac && !fac.subjects.some((choice) => norm(choice) === norm(code))) fac.subjects.push(code);
      });
      if (isNew) state.subjects.push(sub);
    });
    return rows.length;
  }

  function downloadDemoCsv(section) {
    const rows = {
      semesters: [
        ["name", "days", "use_common_slots", "slots", "slots_by_day", "blocks"],
        ["Sem 3", "Mon|Tue|Wed|Thu|Fri", "false", "", "Mon:P1@09:30+50|P2@10:25+50|P3@11:20+50;Tue:P1@09:30+50|P2@10:25+50", "Wed@14:00-14:50"]
      ],
      faculty: [
        ["name", "subject_preferences", "holidays", "blocks"],
        ["Dr. Demo", "DSA|DBMS", "Sat|Sun", "Mon@09:30-10:20"]
      ],
      subjects: [
        ["code", "name", "type", "weekly_count", "duration_slots", "faculty_count", "semesters", "auto_faculty_pool", "candidate_faculty"],
        ["DSA", "Data Structures", "Theory", "3", "1", "1", "Sem 3", "true", "Dr. Demo"]
      ]
    }[section];
    if (!rows) return;
    const csv = rows.map((row) => row.map(csvEscapeValue).join(",")).join("\n");
    downloadFile(`routine-studio-demo-${section}.csv`, csv, "text/csv");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const clean = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < clean.length; i += 1) {
      const char = clean[i];
      const next = clean[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    rows.push(row);
    return rows.filter((item) => item.some((cellValue) => String(cellValue).trim()));
  }

  function csvObjectRows(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map((row) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = String(row[index] || "").trim();
      });
      return object;
    }).filter((row) => Object.values(row).some(Boolean));
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function rowValue(row, key) {
    return row[normalizeHeader(key)] || "";
  }

  function splitList(value) {
    return String(value || "")
      .split(/[|;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseBool(value, fallback) {
    const clean = String(value || "").trim().toLowerCase();
    if (!clean) return fallback;
    if (["true", "yes", "y", "1"].includes(clean)) return true;
    if (["false", "no", "n", "0"].includes(clean)) return false;
    return fallback;
  }

  function parseDays(value) {
    return sortDays(splitList(value).map(normalizeDay).filter(Boolean));
  }

  function normalizeDay(value) {
    const clean = norm(value);
    return DAYS.find((day) => norm(day) === clean || norm(DAY_NAMES[day]) === clean) || null;
  }

  function parseBlocks(value) {
    return splitList(value).map((part) => {
      const match = part.match(/^([^@]+)@(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (!match) return null;
      const day = normalizeDay(match[1]);
      if (!day) return null;
      return { day, start: timeToMin(padTime(match[2])), end: timeToMin(padTime(match[3])) };
    }).filter(Boolean);
  }

  function parseSlotsByDay(slotsByDayText, slotsText, days) {
    const out = {};
    DAYS.forEach((day) => {
      out[day] = [];
    });
    if (slotsByDayText) {
      String(slotsByDayText).split(";").forEach((segment) => {
        const index = segment.indexOf(":");
        if (index < 0) return;
        const day = normalizeDay(segment.slice(0, index));
        if (!day) return;
        out[day] = parseSlotList(segment.slice(index + 1));
      });
      return out;
    }
    const shared = parseSlotList(slotsText);
    (days || state.commonDays).forEach((day) => {
      out[day] = cloneSlots(shared);
    });
    return out;
  }

  function parseSlotList(value) {
    return splitList(value).map((part, index) => {
      const match = part.match(/^(?:(.+?)@)?(\d{1,2}:\d{2})(?:\+(\d+)|-(\d{1,2}:\d{2}))$/);
      if (!match) return null;
      const start = padTime(match[2]);
      const duration = match[3] ? clampInt(match[3], 5, 240, 50) : Math.max(5, timeToMin(padTime(match[4])) - timeToMin(start));
      return {
        id: newId("slot"),
        label: (match[1] || `P${index + 1}`).trim(),
        start,
        duration
      };
    }).filter(Boolean);
  }

  function padTime(value) {
    const [h, m] = String(value || "00:00").split(":");
    return `${String(h).padStart(2, "0")}:${String(m || "00").padStart(2, "0")}`;
  }

  function copyCommonToImportedSemester(sem) {
    getActiveDays(sem).forEach((day) => {
      sem.slotsByDay[day] = cloneSlots(state.commonSlots);
    });
  }

  function findSemesterByName(name) {
    return state.semesters.find((sem) => norm(sem.name) === norm(name));
  }

  function findFacultyByName(name) {
    return state.faculties.find((fac) => norm(fac.name) === norm(name));
  }

  function findSubjectByCode(code) {
    return state.subjects.find((sub) => norm(sub.code) === norm(code));
  }

  function ensureSemesterByName(name) {
    const existing = findSemesterByName(name);
    if (existing) return existing;
    const sem = {
      id: newId("sem"),
      name,
      useCommonDays: true,
      useCommonSlots: true,
      days: [...state.commonDays],
      slotsByDay: {},
      blocks: []
    };
    state.semesters.push(sem);
    return sem;
  }

  function ensureFacultyByName(name, subjectCode) {
    const existing = findFacultyByName(name);
    if (existing) return existing;
    const fac = {
      id: newId("fac"),
      name,
      subjects: subjectCode ? [subjectCode] : [],
      holidays: ["Sat", "Sun"],
      blocks: []
    };
    state.faculties.push(fac);
    return fac;
  }

  function csvEscapeValue(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportXlsx() {
    if (!window.XLSX) {
      toast("XLSX library is still loading. Try again in a moment.");
      return;
    }
    const wb = window.XLSX.utils.book_new();
    state.semesters.forEach((sem) => {
      const sheet = window.XLSX.utils.aoa_to_sheet(semesterAoa(sem));
      window.XLSX.utils.book_append_sheet(wb, sheet, safeSheetName(sem.name));
    });
    state.faculties.forEach((fac) => {
      const sheet = window.XLSX.utils.aoa_to_sheet(facultyAoa(fac));
      window.XLSX.utils.book_append_sheet(wb, sheet, safeSheetName(fac.name));
    });
    const warnings = calculateMetrics();
    const summary = [
      ["Routine Studio Summary"],
      ["Generated", state.routine.lastGenerated || ""],
      ["Placed classes", state.routine.events.length],
      ["Unscheduled", state.routine.unscheduled.length],
      ["Conflicts", warnings.conflicts.length],
      [],
      ["Warnings"],
      ...state.routine.unscheduled.map((item) => [item.label, item.reason]),
      ...warnings.conflicts.map((item) => [item])
    ];
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(summary), "Summary");
    window.XLSX.writeFile(wb, `routine-studio-${dateStamp()}.xlsx`);
  }

  async function exportImage(format) {
    const area = $("#exportArea");
    if (!area || !window.html2canvas) {
      toast("Image exporter is still loading. Try again in a moment.");
      return;
    }
    toast(`Preparing ${format.toUpperCase()} export...`);
    const canvas = await window.html2canvas(area, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    canvas.toBlob((blob) => {
      if (!blob) {
        toast("Export failed.");
        return;
      }
      downloadBlob(`routine-studio-${dateStamp()}.${format === "jpeg" ? "jpg" : "png"}`, blob);
    }, mime, 0.94);
  }

  async function exportPdf() {
    const area = $("#exportArea");
    if (!area || !window.html2canvas || !window.jspdf) {
      toast("PDF exporter is still loading. Try again in a moment.");
      return;
    }
    toast("Preparing PDF export...");
    const canvas = await window.html2canvas(area, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let position = margin;
    let remaining = imgHeight;
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    remaining -= pageHeight - margin * 2;
    while (remaining > 0) {
      pdf.addPage();
      position = margin - (imgHeight - remaining);
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      remaining -= pageHeight - margin * 2;
    }
    pdf.save(`routine-studio-${dateStamp()}.pdf`);
  }

  function semesterAoa(sem) {
    const days = getActiveDays(sem);
    const maxSlots = Math.max(0, ...days.map((day) => getSlots(sem, day).length));
    const header = ["Day"];
    for (let i = 0; i < maxSlots; i += 1) header.push(`Slot ${i + 1}`);
    const rows = days.map((day) => {
      const slots = getSlots(sem, day);
      const row = [DAY_NAMES[day]];
      for (let i = 0; i < maxSlots; i += 1) {
        const slot = slots[i];
        row.push(slot ? semCellText(sem, day, slot) : "");
      }
      return row;
    });
    return [[sem.name], [], header, ...rows];
  }

  function facultyAoa(fac) {
    const slots = getGlobalSlots();
    const header = ["Day", ...slots.map((slot) => `${minToTime(slot.start)}-${minToTime(slot.end)}`)];
    const rows = getRoutineDays().map((day) => [
      `${DAY_NAMES[day]}${fac.holidays.includes(day) ? " (Holiday)" : ""}`,
      ...slots.map((slot) => facultyCellText(fac, day, slot))
    ]);
    return [[fac.name], [], header, ...rows];
  }

  function semCellText(sem, day, slot) {
    const start = timeToMin(slot.start);
    const end = slotEndMin(slot);
    const started = state.routine.events.filter((event) => event.semIds.includes(sem.id) && event.day === day && event.start === start);
    if (started.length) return started.map(eventText).join("\n");
    const covered = state.routine.events.some((event) => event.semIds.includes(sem.id) && event.day === day && overlaps(start, end, event.start, event.end));
    if (covered) return "Continues";
    if (rangeBlocked(sem.blocks, day, start, end)) return "Blocked";
    return "";
  }

  function facultyCellText(fac, day, slot) {
    const started = state.routine.events.filter((event) => event.facultyIds.includes(fac.id) && event.day === day && event.start === slot.start);
    if (started.length) return started.map(eventText).join("\n");
    const covered = state.routine.events.some((event) => event.facultyIds.includes(fac.id) && event.day === day && overlaps(slot.start, slot.end, event.start, event.end));
    if (covered) return "Continues";
    if (fac.holidays.includes(day)) return "Holiday";
    if (rangeBlocked(fac.blocks, day, slot.start, slot.end)) return "Blocked";
    return "";
  }

  function eventText(event) {
    const sems = event.semIds.map((id) => getSemester(id)?.name).filter(Boolean).join(", ");
    const facs = event.facultyIds.map((id) => getFaculty(id)?.name).filter(Boolean).join(", ");
    return `${event.subjectCode} ${event.subjectName} | ${sems} | ${facs} | ${event.day} ${minToTime(event.start)}-${minToTime(event.end)}`;
  }

  function loadDemo() {
    const demo = defaultState();
    demo.commonDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    demo.commonSlots = [
      { id: newId("slot"), label: "P1", start: "09:30", duration: 50 },
      { id: newId("slot"), label: "P2", start: "10:25", duration: 50 },
      { id: newId("slot"), label: "P3", start: "11:20", duration: 50 },
      { id: newId("slot"), label: "P4", start: "12:15", duration: 50 },
      { id: newId("slot"), label: "P5", start: "14:00", duration: 50 },
      { id: newId("slot"), label: "P6", start: "14:55", duration: 50 }
    ];
    const [s3, s5, s7] = demo.semesters;
    s3.name = "Sem 3";
    s5.name = "Sem 5";
    s7.name = "Sem 7";
    s7.useCommonSlots = false;
    s7.slotsByDay = normalizeSlotsByDay({});
    demo.commonDays.forEach((day) => {
      s7.slotsByDay[day] = cloneSlots(demo.commonSlots);
    });
    s7.slotsByDay.Fri = [
      { id: newId("slot"), label: "P1", start: "09:30", duration: 60 },
      { id: newId("slot"), label: "P2", start: "10:35", duration: 60 },
      { id: newId("slot"), label: "Seminar", start: "11:45", duration: 90 }
    ];
    s3.blocks = [{ day: "Wed", start: timeToMin("14:00"), end: timeToMin("14:50") }];
    s5.blocks = [{ day: "Thu", start: timeToMin("12:15"), end: timeToMin("13:05") }];

    demo.faculties = [
      faculty("Dr. Sen", ["DSA", "Algorithms", "AI"], ["Sat", "Sun"]),
      faculty("Prof. Rao", ["DBMS", "Data Mining"], ["Fri", "Sun"]),
      faculty("Dr. Mehta", ["OS", "Networks", "Cloud"], ["Sat", "Sun"]),
      faculty("Prof. Iqbal", ["Math", "Discrete Math", "Statistics"], ["Thu", "Sun"]),
      faculty("Dr. Das", ["ML", "Machine Learning", "AI"], ["Sat", "Sun"]),
      faculty("Prof. Kaur", ["SE", "Software Engineering", "Project"], ["Wed", "Sun"]),
      faculty("Dr. Nair", ["Compiler", "Theory of Computation"], ["Sat", "Sun"]),
      faculty("Prof. Roy", ["Lab", "DBMS Lab", "OS Lab"], ["Tue", "Sun"])
    ];
    demo.faculties[0].blocks = [{ day: "Mon", start: timeToMin("09:30"), end: timeToMin("10:20") }];
    demo.faculties[3].blocks = [{ day: "Fri", start: timeToMin("14:00"), end: timeToMin("14:50") }];

    const byName = Object.fromEntries(demo.faculties.map((fac) => [fac.name, fac.id]));
    demo.subjects = [
      subject("DSA", "Data Structures", "Theory", 3, 1, 1, [s3.id], true, []),
      subject("DSA Lab", "Data Structures Lab", "Lab", 1, 2, 2, [s3.id], false, [byName["Dr. Sen"], byName["Prof. Roy"]]),
      subject("DBMS", "Database Management", "Theory", 3, 1, 1, [s5.id], true, []),
      subject("DBMS Lab", "Database Lab", "Lab", 1, 2, 2, [s5.id], false, [byName["Prof. Rao"], byName["Prof. Roy"]]),
      subject("OS", "Operating Systems", "Theory", 3, 1, 1, [s5.id], true, []),
      subject("AI", "Artificial Intelligence", "Theory", 2, 1, 1, [s7.id], true, []),
      subject("ML", "Machine Learning", "Theory", 2, 1, 1, [s5.id, s7.id], true, []),
      subject("SE", "Software Engineering", "Theory", 2, 1, 1, [s3.id], true, []),
      subject("Project", "Major Project Review", "Project", 1, 2, 2, [s7.id], false, [byName["Prof. Kaur"], byName["Dr. Das"]]),
      subject("Math", "Discrete Mathematics", "Theory", 2, 1, 1, [s3.id], true, [])
    ];
    state = normalizeState(demo);
    generateRoutine();
  }

  function faculty(name, subjects, holidays) {
    return { id: newId("fac"), name, subjects, holidays, blocks: [] };
  }

  function subject(code, name, type, weeklyCount, durationSlots, facultyCount, semIds, autoFacultyPool, candidateFacultyIds) {
    return { id: newId("sub"), code, name, type, weeklyCount, durationSlots, facultyCount, semIds, autoFacultyPool, candidateFacultyIds, notes: "" };
  }

  $("#loadDemoBtn").addEventListener("click", () => {
    loadDemo();
    render();
    toast("Demo data loaded and generated.");
  });
  $("#quickGenerateBtn").addEventListener("click", () => {
    generateRoutine();
    render();
  });
  $("#exportJsonBtn").addEventListener("click", exportJson);
  $("#importJsonBtn").addEventListener("click", () => $("#jsonFile").click());

  function getSemester(id) {
    return state.semesters.find((sem) => sem.id === id);
  }

  function getFaculty(id) {
    return state.faculties.find((fac) => fac.id === id);
  }

  function getSubject(id) {
    return state.subjects.find((sub) => sub.id === id);
  }

  function getActiveDays(sem) {
    return sortDays(sem.useCommonDays ? state.commonDays : sem.days);
  }

  function getSlots(sem, day) {
    if (!sem) return [];
    return normalizeSlots(sem.useCommonSlots ? state.commonSlots : (sem.slotsByDay[day] || []));
  }

  function getRoutineDays() {
    const set = new Set();
    state.semesters.forEach((sem) => getActiveDays(sem).forEach((day) => set.add(day)));
    state.routine.events.forEach((event) => set.add(event.day));
    return sortDays([...set]);
  }

  function getGlobalSlots() {
    const map = new Map();
    state.semesters.forEach((sem) => {
      getActiveDays(sem).forEach((day) => {
        getSlots(sem, day).forEach((slot) => {
          const start = timeToMin(slot.start);
          const end = slotEndMin(slot);
          map.set(`${start}-${end}`, { start, end });
        });
      });
    });
    if (!map.size) {
      state.commonSlots.forEach((slot) => {
        const start = timeToMin(slot.start);
        map.set(`${start}-${slotEndMin(slot)}`, { start, end: slotEndMin(slot) });
      });
    }
    return [...map.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function getGlobalSlotTemplates() {
    return getGlobalSlots().map((slot, index) => ({
      id: `global_${index}`,
      label: `${minToTime(slot.start)}-${minToTime(slot.end)}`,
      start: minToTime(slot.start),
      duration: Math.max(5, slot.end - slot.start)
    }));
  }

  function candidateFacultyIdsForSubject(sub, includeNames) {
    const set = new Set(sub.candidateFacultyIds || []);
    if (sub.autoFacultyPool) {
      state.faculties.forEach((fac) => {
        if (facultyCanTeach(fac, sub)) set.add(fac.id);
      });
    }
    const ids = [...set].filter((id) => getFaculty(id));
    return includeNames ? ids : ids;
  }

  function facultyCanTeach(fac, sub) {
    const code = norm(sub.code);
    const name = norm(sub.name);
    return (fac.subjects || []).some((choice) => {
      const value = norm(choice);
      if (!value) return false;
      return value === code || value === name || code.includes(value) || name.includes(value) || value.includes(code);
    });
  }

  function taskDifficulty(subjectId) {
    const sub = getSubject(subjectId);
    if (!sub) return 0;
    const candidateCount = Math.max(1, candidateFacultyIdsForSubject(sub).length);
    return sub.durationSlots * 20 + sub.semIds.length * 25 + sub.facultyCount * 20 - candidateCount;
  }

  function facultyLoad(facId, events = state.routine.events) {
    return events.filter((event) => event.facultyIds.includes(facId)).reduce((sum, event) => sum + Math.max(1, event.durationSlots || 1), 0);
  }

  function loadMaps(events) {
    const total = new Map();
    const day = new Map();
    events.forEach((event) => {
      event.facultyIds.forEach((facId) => {
        const units = Math.max(1, event.durationSlots || 1);
        total.set(facId, (total.get(facId) || 0) + units);
        if (!day.has(facId)) day.set(facId, new Map());
        day.get(facId).set(event.day, (day.get(facId).get(event.day) || 0) + units);
      });
    });
    return { total, day };
  }

  function countSemSlots(sem) {
    return getActiveDays(sem).reduce((sum, day) => sum + getSlots(sem, day).length, 0);
  }

  function totalSemBlocks() {
    return state.semesters.reduce((sum, sem) => sum + sem.blocks.length, 0);
  }

  function totalFacultyBlocks() {
    return state.faculties.reduce((sum, fac) => sum + fac.blocks.length, 0);
  }

  function holidayCount() {
    return state.faculties.reduce((sum, fac) => sum + fac.holidays.length, 0);
  }

  function facultyWarnings() {
    const warnings = [];
    state.faculties.forEach((fac) => {
      if (fac.holidays.length !== 2) warnings.push(`<li class="critical">${esc(fac.name)} should have exactly two weekly holidays.</li>`);
      if (!fac.subjects.length) warnings.push(`<li>${esc(fac.name)} has no subject choices yet.</li>`);
    });
    return warnings;
  }

  function subjectWarnings() {
    const warnings = [];
    state.subjects.forEach((sub) => {
      if (!sub.semIds.length) warnings.push(`<li class="critical">${esc(sub.code)} has no semester selected.</li>`);
      const candidates = candidateFacultyIdsForSubject(sub);
      if (candidates.length < sub.facultyCount) warnings.push(`<li class="critical">${esc(sub.code)} needs ${sub.facultyCount} faculty but has ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}.</li>`);
      if (sub.semIds.length > 1 && sub.durationSlots > 1) warnings.push(`<li>${esc(sub.code)} is combined and multi-period; all selected semesters must have identical time runs.</li>`);
    });
    return warnings;
  }

  function rangeBlocked(blocks, day, start, end) {
    return (blocks || []).some((block) => block.day === day && overlaps(start, end, Number(block.start), Number(block.end)));
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return Number(aStart) < Number(bEnd) && Number(bStart) < Number(aEnd);
  }

  function sameSubject(sub, event) {
    return norm(sub.code) === norm(event.subjectCode) || norm(sub.name) === norm(event.subjectName);
  }

  function subjectTypeClass(type) {
    const value = norm(type);
    if (value.includes("lab")) return "lab";
    if (value.includes("project") || value.includes("tutorial")) return "project";
    return "";
  }

  function nextSlotFrom(slots) {
    const clean = normalizeSlots(slots || []);
    if (!clean.length) return { id: newId("slot"), label: "P1", start: "09:30", duration: 50 };
    const last = clean[clean.length - 1];
    return {
      id: newId("slot"),
      label: `P${clean.length + 1}`,
      start: minToTime(slotEndMin(last) + 5),
      duration: Number(last.duration) || 50
    };
  }

  function cloneSlots(slots) {
    return normalizeSlots(slots).map((slot) => ({ ...slot, id: newId("slot") }));
  }

  function updateSlot(slot, field, value) {
    if (!slot) return;
    if (field === "duration") slot.duration = clampInt(value, 5, 240, 50);
    else if (field === "start") slot.start = validTime(value) ? value : slot.start;
    else slot[field] = value;
  }

  function timeToMin(value) {
    if (typeof value === "number") return value;
    const [h, m] = String(value || "00:00").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  function minToTime(value) {
    let minutes = Number(value) || 0;
    minutes = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function slotEnd(slot) {
    return minToTime(slotEndMin(slot));
  }

  function slotEndMin(slot) {
    return timeToMin(slot.start) + clampInt(slot.duration, 5, 240, 50);
  }

  function validTime(value) {
    return /^\d{2}:\d{2}$/.test(String(value || ""));
  }

  function clampInt(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function parseChoiceText(text) {
    return String(text || "")
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function sortDays(days) {
    const set = new Set(days || []);
    return DAYS.filter((day) => set.has(day));
  }

  function setDayChecked(days, day, checked) {
    setChecked(days, day, checked);
  }

  function setChecked(list, value, checked) {
    const index = list.indexOf(value);
    if (checked && index < 0) list.push(value);
    if (!checked && index >= 0) list.splice(index, 1);
  }

  function intersectionDays(dayLists) {
    if (!dayLists.length) return [];
    return DAYS.filter((day) => dayLists.every((list) => list.includes(day)));
  }

  function combinations(items, size) {
    const result = [];
    const walk = (start, combo) => {
      if (combo.length === size) {
        result.push([...combo]);
        return;
      }
      for (let i = start; i < items.length; i += 1) {
        combo.push(items[i]);
        walk(i + 1, combo);
        combo.pop();
      }
    };
    walk(0, []);
    return result;
  }

  function shuffle(items, rng) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function mulberry32(seed) {
    return function random() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeSelections() {
    if (!state.ui.blockSemId || !getSemester(state.ui.blockSemId)) state.ui.blockSemId = state.semesters[0]?.id || null;
    if (!state.ui.blockTemplateSemId || !getSemester(state.ui.blockTemplateSemId)) state.ui.blockTemplateSemId = state.semesters[0]?.id || null;
    if (!state.ui.blockFacultyId || !getFaculty(state.ui.blockFacultyId)) state.ui.blockFacultyId = state.faculties[0]?.id || null;
    state.subjects.forEach((sub) => {
      sub.semIds = sub.semIds.filter((id) => getSemester(id));
      sub.candidateFacultyIds = sub.candidateFacultyIds.filter((id) => getFaculty(id));
    });
    state.routine.events.forEach((event) => {
      event.semIds = event.semIds.filter((id) => getSemester(id));
      event.facultyIds = event.facultyIds.filter((id) => getFaculty(id));
    });
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function norm(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function attr(value) {
    return esc(value);
  }

  function dash(value) {
    return String(value).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function safeSheetName(name) {
    return String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
  }

  function dateStamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  }

  function downloadFile(filename, contents, type) {
    const blob = new Blob([contents], { type });
    downloadBlob(filename, blob);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toast(message) {
    const host = $("#toast");
    const item = document.createElement("div");
    item.className = "toast-item";
    item.textContent = message;
    host.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }
})();
