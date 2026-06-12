/**
 * Capacity Planner widget — client controller.
 *
 * Near 1:1 port of the prototype vanilla JS, adapted to the Service Portal per
 * spec §10.3:
 *   - init(c.data.bootstrap) on first render; team keys = sys_ids (label via
 *     teamName(id)); month keys = ints 1..12.
 *   - ALL DOM lookups scoped to the widget element ($el / $() / $$()),
 *     NEVER document.getElementById.
 *   - Persistence via c.server.get({action:'saveCell',...}) optimistic UI
 *     (revert + toast on failure); reset-all re-fetches the bootstrap.
 *   - Every interpolated user value is HTML-escaped via esc() (prototype was
 *     XSS-unsafe).
 *   - No inline onclick — delegated listeners on the widget element with
 *     data-* attributes (CSP-safe).
 *   - Edit affordances (cell edit, add/remove team, fill-row) hidden unless
 *     c.data.canEdit === true.
 *   - Server-callback re-renders that touch c.data wrapped in $timeout(0).
 *   - Export keeps client-side SheetJS (XLSX, vendored UI Script dependency);
 *     server builds the 3 row-arrays; no CDN loader.
 */
api.controller = function ($scope, $element, spUtil, $timeout) {
  var c = this;
  var $el = $element[0];

  // Widget-scoped DOM helpers (replace document.getElementById / querySelectorAll).
  function $(id) { return $el.querySelector('#' + id); }
  function $$(sel) { return Array.prototype.slice.call($el.querySelectorAll(sel)); }

  // HTML-escape every interpolated user value.
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // ── STATE (ported, team keys = sys_id, month keys = 1..12) ──
  var projects = [], RAW = [], TEAMS = [], MONTHS = [], HEADCOUNT = {};
  var AREAS = [], AREA_META = {}, TEAM_META = {};
  var PRI_LBL = {}, SS_LBL = {}, SS_ORDER = [], AS_LBL = {};
  var YEAR = 2026;
  var canEdit = false;

  var selIdx = null, curView = 'overview', selTeam = null, editCell = null;
  var hmMode = 'capacity', monthS = 0, monthE = 11;
  var ovSort = { col: 'p', dir: 1 };
  var selectedSS = {}; // value -> true; empty = all

  // ── STATIC LOOKUPS (class maps keyed by codes/names) ────────
  var MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PRI_CLS = { '0': 'bp0', '1': 'bp1', '2': 'bp2', '3': 'bp3', '4': 'bp4', '': 'bp0' };
  // area-name -> css class (prototype AREA_CLS)
  var AREA_CLS = {
    'CCO': 'aCCO', 'Sales': 'aSales', 'Finance': 'aFinance', 'Legal': 'aLegal',
    'People Experience': 'aPX', 'Marketing': 'aMarketing', 'cross function': 'across',
    'Global IT': 'aGlobalIT', 'EA / IT': 'aEAIT', 'Cloud Ops': 'aCloudOps'
  };
  // snow_status CODE -> dot color (codes are lowercase per choices)
  var SS_DOT = {
    'approved': '#1a6b3a', 'screening': '#1a4fa8', 'qualified': '#5b35b0',
    'pending': '#b45309', 'new': '#7c2d12', 'completed': '#5c5a55',
    'canceled': '#c0392b', '': '#9a9790'
  };
  // snow_status CODE -> css class
  var SS_CLS = {
    'approved': 'ssApproved', 'screening': 'ssScreening', 'pending': 'ssPending',
    'qualified': 'ssQualified', 'completed': 'ssCompleted', 'canceled': 'ssCanceled',
    'new': 'ssNew', '': 'ssNone'
  };
  // ado_status CODE -> css class
  var AS_CLS = { 'in_progress': 'asIP', 'done': 'asDone', 'new': 'asNew', 'on_hold': 'asOH' };

  // ── INIT ────────────────────────────────────────────────────
  init(c.data.bootstrap);

  function init(b) {
    if (!b) { b = { months: MONTH_LABELS.slice(), teams: [], areas: [], choices: {}, headcount: {}, projects: [], year: 2026 }; }
    YEAR = b.year || 2026;
    canEdit = (c.data.canEdit === true);
    MONTHS = b.months && b.months.length ? b.months : MONTH_LABELS.slice();
    TEAMS = (b.teams || []).map(function (t) { return t.id; });
    TEAM_META = {};
    (b.teams || []).forEach(function (t) { TEAM_META[t.id] = t; });
    AREAS = b.areas || [];
    AREA_META = {};
    AREAS.forEach(function (a) { AREA_META[a.id] = a; });
    HEADCOUNT = b.headcount || {};
    projects = b.projects || [];
    RAW = angular.copy(projects);          // change-log baseline (this session)

    // choice label maps
    PRI_LBL = {}; (b.choices && b.choices.priority || []).forEach(function (o) { PRI_LBL[o.value] = o.label; });
    SS_LBL = {}; SS_ORDER = [];
    (b.choices && b.choices.snowStatus || []).forEach(function (o) { SS_LBL[o.value] = o.label; SS_ORDER.push(o.value); });
    AS_LBL = {}; (b.choices && b.choices.adoStatus || []).forEach(function (o) { AS_LBL[o.value] = o.label; });

    selIdx = null; selTeam = null; editCell = null;
    selectedSS = {}; monthS = 0; monthE = 11;

    buildDropdowns();
    renderSidebar();
    initSlider();
    initOvSort();
    wireEvents();
    switchView('overview');
  }

  // ── HELPERS ─────────────────────────────────────────────────
  function teamName(id) { return (TEAM_META[id] && TEAM_META[id].name) || id; }
  function areaName(id) { return (AREA_META[id] && AREA_META[id].name) || ''; }
  function areaClr(id) { return (AREA_META[id] && AREA_META[id].color) || '#888'; }
  function aCls(id) { return AREA_CLS[areaName(id)] || 'across'; }
  function pCls(p) { return PRI_CLS[p] || 'bp0'; }
  function pLbl(p) { return PRI_LBL[p] || '—'; }
  function ssCls(s) { return SS_CLS[s] || 'ssNone'; }
  function ssLbl(s) { return SS_LBL[s] || 'No status'; }
  function asCls(s) { return AS_CLS[s] || 'ssNone'; }
  function asLbl(s) { return AS_LBL[s] || s; }
  function getTA(p) { return p.ta || {}; }
  // active month INTEGERS (1..12)
  function activeMos() {
    var out = [];
    for (var i = monthS; i <= monthE; i++) { out.push(i + 1); }
    return out;
  }
  function moLabel(m) { return MONTHS[m - 1] || MONTH_LABELS[m - 1] || String(m); }
  function inActive(m) { return m >= (monthS + 1) && m <= (monthE + 1); }

  function cellClr(v) {
    if (!v || v === 0) return { bg: 'transparent', clr: 'var(--ink3)', txt: '—' };
    var t = v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
    if (v <= 1) return { bg: '#e8f4fd', clr: '#1a4fa8', txt: t };
    if (v <= 3) return { bg: '#93c6ee', clr: '#0c2d55', txt: t };
    if (v <= 5) return { bg: '#3d8fd4', clr: '#fff', txt: t };
    if (v <= 8) return { bg: '#1a4fa8', clr: '#fff', txt: t };
    return { bg: '#0c2d55', clr: '#fff', txt: t };
  }

  function projMoTotal(p, m) {
    if (!inActive(m)) return 0;
    var ta = getTA(p), s = 0;
    for (var k in ta) { if (ta.hasOwnProperty(k)) { s += (ta[k][m] || 0); } }
    return s;
  }
  function projTotal(p) {
    return activeMos().reduce(function (s, m) { return s + projMoTotal(p, m); }, 0);
  }
  function teamMoTotals() {
    var tot = {};
    TEAMS.forEach(function (t) { tot[t] = {}; for (var m = 1; m <= 12; m++) { tot[t][m] = 0; } });
    projects.forEach(function (p) {
      var ta = getTA(p);
      for (var team in ta) {
        if (!ta.hasOwnProperty(team)) continue;
        if (!tot[team]) tot[team] = {};
        var months = ta[team];
        for (var m in months) {
          if (!months.hasOwnProperty(m)) continue;
          var mi = parseInt(m, 10);
          if (inActive(mi)) tot[team][mi] = (tot[team][mi] || 0) + months[m];
        }
      }
    });
    return tot;
  }

  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    $timeout(function () { t.classList.remove('on'); }, 2400);
  }

  // ── MONTH SLIDER ─────────────────────────────────────────────
  function initSlider() {
    var track = $('mtrack'), fill = $('mfill'), ts = $('mthumb-s'), te = $('mthumb-e');
    var lbl = $('mrange-label'), pips = $('mpips');
    if (!track) return;
    pips.innerHTML = MONTHS.map(function (m) { return '<span class="mbar-pip">' + esc(m) + '</span>'; }).join('');

    function upd() {
      var p0 = (monthS / 11) * 100, p1 = (monthE / 11) * 100;
      fill.style.left = p0 + '%'; fill.style.width = (p1 - p0) + '%';
      ts.style.left = p0 + '%'; te.style.left = p1 + '%';
      lbl.textContent = MONTHS[monthS] + ' – ' + MONTHS[monthE];
      Array.prototype.forEach.call(pips.querySelectorAll('.mbar-pip'), function (p, i) {
        p.classList.toggle('on', i >= monthS && i <= monthE);
      });
    }
    function toPip(x) {
      var r = track.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 11);
    }
    function drag(isS, e) {
      e.preventDefault();
      var mv = function (ev) {
        var cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        var pip = toPip(cx);
        if (isS) monthS = Math.min(pip, monthE); else monthE = Math.max(pip, monthS);
        upd(); refreshViews();
      };
      var up = function () {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up);
      };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', mv, { passive: false }); document.addEventListener('touchend', up);
    }
    ts.addEventListener('mousedown', function (e) { drag(true, e); });
    te.addEventListener('mousedown', function (e) { drag(false, e); });
    ts.addEventListener('touchstart', function (e) { drag(true, e); }, { passive: false });
    te.addEventListener('touchstart', function (e) { drag(false, e); }, { passive: false });
    track.addEventListener('click', function (e) {
      var pip = toPip(e.clientX);
      if (Math.abs(pip - monthS) <= Math.abs(pip - monthE)) monthS = Math.min(pip, monthE);
      else monthE = Math.max(pip, monthS);
      upd(); refreshViews();
    });
    $('mreset').addEventListener('click', function () { monthS = 0; monthE = 11; upd(); refreshViews(); });
    upd();
  }

  function refreshViews() {
    if (curView === 'heatmap') renderHeatmap();
    else if (curView === 'team') { renderTeamCards(); if (selTeam) renderTeamDetail(selTeam); }
    else if (curView === 'overview') renderOverview();
    else if (curView === 'pipeline') renderPipeline();
    else if (curView === 'projects' && selIdx !== null) { renderAllocTable(); refreshFooter(); }
  }

  // ── DROPDOWNS ────────────────────────────────────────────────
  function buildDropdowns() {
    // area options keyed by sys_id, label = name
    var areaOpts = AREAS.map(function (a) { return { v: a.id, l: a.name }; });
    // teams that appear in projects + all known teams
    var teamSet = {};
    projects.forEach(function (p) { for (var k in getTA(p)) { if (getTA(p).hasOwnProperty(k)) teamSet[k] = true; } });
    TEAMS.forEach(function (t) { teamSet[t] = true; });
    var teamOpts = TEAMS.filter(function (t) { return teamSet[t]; }).map(function (t) { return { v: t, l: teamName(t) }; });

    ['sb-area', 'hm-area', 'ov-area', 'pl-area'].forEach(function (id) {
      var el = $(id); if (!el || el.children.length > 1) return;
      areaOpts.forEach(function (a) { var o = document.createElement('option'); o.value = a.v; o.textContent = a.l; el.appendChild(o); });
    });
    ['sb-team', 'hm-team', 'pl-team'].forEach(function (id) {
      var el = $(id); if (!el || el.children.length > 1) return;
      teamOpts.forEach(function (t) { var o = document.createElement('option'); o.value = t.v; o.textContent = t.l; el.appendChild(o); });
    });
  }

  // ── SNOW MULTI-SELECT ────────────────────────────────────────
  function ssAll() { return SS_ORDER.length ? SS_ORDER : ['approved', 'screening', 'qualified', 'pending', 'new', 'completed', 'canceled', '']; }
  function ssCount() { var n = 0; for (var k in selectedSS) if (selectedSS.hasOwnProperty(k)) n++; return n; }

  function buildSnowDropdown(dropId, triggerId, labelId, onChange) {
    var drop = $(dropId), trigger = $(triggerId);
    if (!drop || !trigger) return;

    function renderDrop() {
      drop.innerHTML =
        '<div class="snow-opt" data-v="__all__">' +
        '<input type="checkbox" ' + (ssCount() === 0 ? 'checked' : '') + '>' +
        '<span class="snow-opt-label" style="font-weight:600">All statuses</span></div>' +
        '<div class="snow-div"></div>' +
        ssAll().map(function (s) {
          return '<div class="snow-opt" data-v="' + esc(s) + '">' +
            '<input type="checkbox" ' + (selectedSS[s] ? 'checked' : '') + '>' +
            '<span class="snow-opt-dot" style="background:' + (SS_DOT[s] || '#9a9790') + '"></span>' +
            '<span class="snow-opt-label">' + esc(ssLbl(s)) + '</span></div>';
        }).join('') +
        '<div class="snow-div"></div>' +
        '<button class="snow-clear">Clear selection</button>';

      Array.prototype.forEach.call(drop.querySelectorAll('.snow-opt'), function (opt) {
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          var v = opt.getAttribute('data-v');
          if (v === '__all__') { selectedSS = {}; }
          else { if (selectedSS[v]) delete selectedSS[v]; else selectedSS[v] = true; }
          renderDrop(); updateTrigger(); onChange();
        });
      });
      drop.querySelector('.snow-clear').addEventListener('click', function (e) {
        e.stopPropagation(); selectedSS = {}; renderDrop(); updateTrigger(); onChange();
      });
    }

    function updateTrigger() {
      var lbl = $(labelId), n = ssCount();
      if (n === 0) {
        lbl.textContent = labelId.indexOf('ov') >= 0 ? 'All SNOW status' : 'All SNOW';
        var old = trigger.querySelector('.snow-cnt'); if (old) old.remove();
      } else {
        var keys = []; for (var k in selectedSS) if (selectedSS.hasOwnProperty(k)) keys.push(k);
        lbl.textContent = n === 1 ? (ssLbl(keys[0])) : (n + ' selected');
        var cnt = trigger.querySelector('.snow-cnt');
        if (!cnt) { cnt = document.createElement('span'); cnt.className = 'snow-cnt'; trigger.insertBefore(cnt, trigger.querySelector('.snow-arrow')); }
        cnt.textContent = n;
      }
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = drop.classList.contains('open');
      Array.prototype.forEach.call($el.querySelectorAll('.snow-drop.open'), function (d) {
        d.classList.remove('open');
        if (d.previousElementSibling) d.previousElementSibling.classList.remove('open');
      });
      if (!isOpen) { drop.classList.add('open'); trigger.classList.add('open'); renderDrop(); }
      else { trigger.classList.remove('open'); }
    });
    document.addEventListener('click', function () { drop.classList.remove('open'); trigger.classList.remove('open'); });
    drop.addEventListener('click', function (e) { e.stopPropagation(); });

    renderDrop(); updateTrigger();
  }

  function snowMatches(p) {
    if (ssCount() === 0) return true;
    return !!selectedSS[p.ss || ''];
  }

  // ── SIDEBAR ──────────────────────────────────────────────────
  function getSbFiltered() {
    var q = ($('sb-search') || { value: '' }).value.toLowerCase();
    var area = ($('sb-area') || { value: '' }).value;
    var pri = ($('sb-pri') || { value: '' }).value;
    var team = ($('sb-team') || { value: '' }).value;
    return projects.map(function (p, i) { var o = angular.extend({}, p); o._i = i; return o; }).filter(function (p) {
      var an = areaName(p.a).toLowerCase();
      if (q && p.n.toLowerCase().indexOf(q) < 0 && an.indexOf(q) < 0) return false;
      if (area && p.a !== area) return false;
      if (pri && p.p !== pri) return false;
      if (team && Object.keys(getTA(p)).indexOf(team) < 0) return false;
      if (!snowMatches(p)) return false;
      return true;
    });
  }

  function renderSidebar() {
    var fps = getSbFiltered();
    if ($('sb-title-count')) $('sb-title-count').textContent = fps.length;
    var list = $('sb-list'); if (!list) return;
    if (!fps.length) { list.innerHTML = '<div style="padding:18px;text-align:center;color:var(--ink3)">No projects found</div>'; return; }
    list.innerHTML = '<div class="sb-count">' + fps.length + ' projects</div>' + fps.map(function (p) {
      var ta = getTA(p); var hasA = Object.keys(ta).length > 0;
      var teams = Object.keys(ta);
      return '<div class="pitem' + (p._i === selIdx ? ' sel' : '') + '" data-idx="' + p._i + '">' +
        '<div class="pitem-name">' + esc(p.n) + '</div>' +
        '<div class="pitem-meta">' +
        '<span class="badge ' + pCls(p.p) + '">' + esc(pLbl(p.p)) + '</span>' +
        '<span class="badge ' + aCls(p.a) + '">' + esc(areaName(p.a)) + '</span>' +
        (p.s ? '<span class="badge bsize">' + esc(p.s) + '</span>' : '') +
        (!hasA ? '<span class="bunplanned">unplanned</span>' : '') +
        '</div>' +
        '<div class="pitem-meta" style="margin-top:3px">' +
        (p.ss ? '<span class="badge ' + ssCls(p.ss) + '" style="font-size:9px">⬡ ' + esc(ssLbl(p.ss)) + '</span>' : '') +
        (p.as ? '<span class="badge ' + asCls(p.as) + '" style="font-size:9px">◈ ' + esc(asLbl(p.as)) + '</span>' : '') +
        '</div>' +
        (teams.length ? '<div class="pitem-teams">' + esc(teams.slice(0, 4).map(teamName).join(' · ')) + (teams.length > 4 ? ' +' + (teams.length - 4) : '') + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ── PROJECT DETAIL ───────────────────────────────────────────
  function renderDetail() {
    var root = $('detail-root'); if (!root) return;
    if (selIdx === null) {
      root.innerHTML = '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>' +
        '<p>Select a project from the sidebar</p>' +
        '<p style="font-size:12px;color:var(--ink3)">Click any project to view and edit capacity allocations</p></div>';
      return;
    }
    var p = projects[selIdx];
    var ta = getTA(p); var tList = Object.keys(ta);
    var total = projTotal(p);
    var moTots = activeMos().map(function (m) { return projMoTotal(p, m); });
    var addable = TEAMS.filter(function (t) { return tList.indexOf(t) < 0; });
    var priExtra = p.p === '1' ? ' High' : p.p === '2' ? ' Medium' : p.p === '3' ? ' Low' : '';

    root.innerHTML =
      '<div class="dcard">' +
      '<div class="dtitle">' + esc(p.n) + '</div>' +
      '<div class="dbadges">' +
      '<span class="badge ' + pCls(p.p) + '">' + esc(pLbl(p.p) + priExtra) + '</span>' +
      '<span class="badge ' + aCls(p.a) + '">' + esc(areaName(p.a)) + '</span>' +
      (p.s ? '<span class="badge bsize">' + esc(p.s) + '</span>' : '') +
      (p.ty ? '<span class="badge bpx">' + esc(p.ty) + '</span>' : '') +
      (!tList.length ? '<span class="badge" style="background:var(--amber-lt);color:var(--amber)">⚠ No allocation</span>' : '') +
      '</div>' +
      ((p.ss || p.as) ? '<div class="dstatus-row">' +
        (p.ss ? '<span class="badge ' + ssCls(p.ss) + '" style="font-size:11px;padding:3px 10px">⬡ SNOW: ' + esc(ssLbl(p.ss)) + '</span>' : '') +
        (p.as ? '<span class="badge ' + asCls(p.as) + '" style="font-size:11px;padding:3px 10px">◈ ADO: ' + esc(asLbl(p.as)) + '</span>' : '') +
        (p.snow ? '<span style="font-size:11px;color:var(--ink3)">🎫 ' + esc(p.snow) + '</span>' : '') +
        (p.ado ? '<span style="font-size:11px;color:var(--ink3)">📋 ' + esc(p.ado) + '</span>' : '') +
        '</div>' : '') +
      '<div class="dgrid">' +
      '<div class="dstat"><div class="dstat-label">Start</div><div class="dstat-val" style="font-size:13px">' + esc(p.st || '—') + '</div></div>' +
      '<div class="dstat"><div class="dstat-label">End</div><div class="dstat-val" style="font-size:13px">' + esc(p.en || '—') + '</div></div>' +
      '<div class="dstat"><div class="dstat-label">Teams</div><div class="dstat-val">' + tList.length + '</div></div>' +
      '<div class="dstat"><div class="dstat-label">FTE (period)</div><div class="dstat-val">' + total.toFixed(1) + '</div></div>' +
      '</div>' +
      (p.sc ? '<div class="dcomment" style="margin-bottom:8px">📌 SteerCo: <strong>' + esc(p.sc) + '</strong></div>' : '') +
      (p.comments ? '<div class="dcomment">💬 ' + esc(p.comments) + '</div>' : '') +
      '</div>' +

      '<div class="dcard">' +
      '<div class="sec-title">Capacity allocation — ' + esc(MONTHS[monthS]) + ' to ' + esc(MONTHS[monthE]) + ' <span></span>' +
      (canEdit ? '<button class="btn" data-act="resetProj" title="Reload from server"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 7A5 5 0 1 0 7 2"/><path d="M2 2v5h5"/></svg>Reset</button>' : '') +
      '</div>' +

      (canEdit ? (
        '<div class="add-team-bar">' +
        '<button class="add-team-btn" id="add-team-toggle"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 1v10M1 6h10"/></svg>Add team</button>' +
        '<span style="font-size:10px;color:var(--ink3)" id="add-team-hint">' + (addable.length ? (addable.length + ' team' + (addable.length > 1 ? 's' : '') + ' available') : 'All teams already added') + '</span>' +
        '</div>' +
        '<div class="add-team-panel" id="add-team-panel">' +
        TEAMS.map(function (t) {
          var already = tList.indexOf(t) >= 0;
          return '<div class="add-team-chip' + (already ? ' already' : '') + '" data-team="' + esc(t) + '"' + (already ? '' : ' data-act="addTeam"') + '>' +
            (already ? '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M2 6l3 3 5-5"/></svg>' : '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M6 1v10M1 6h10"/></svg>') +
            esc(teamName(t)) + '</div>';
        }).join('') +
        '</div>'
      ) : '') +

      '<div class="alloc-wrap"><table class="alloc-table" id="alloc-table">' +
      '<thead><tr><th class="team-th" style="width:155px">Team</th>' +
      activeMos().map(function (m) { return '<th style="min-width:44px">' + esc(moLabel(m)) + '</th>'; }).join('') +
      '<th style="width:54px">Total</th></tr></thead>' +
      '<tbody id="alloc-tbody"></tbody>' +
      '<tfoot><tr>' +
      '<td class="team-td" style="font-size:9px;color:var(--ink3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:0 10px">Period total</td>' +
      activeMos().map(function (m, i) { var v = Math.round(moTots[i] * 10) / 10; var s = cellClr(v); return '<td class="total-td"><div class="hm-val" style="background:' + s.bg + ';color:' + s.clr + ';height:34px">' + s.txt + '</div></td>'; }).join('') +
      '<td class="total-td"><div class="hm-val" style="font-weight:700;height:34px">' + total.toFixed(1) + '</div></td>' +
      '</tr></tfoot></table></div>' +
      (canEdit ? '<div class="edit-hint" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><span style="display:flex;align-items:center;gap:5px"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:11px;height:11px"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/></svg>Click cell to edit · Tab / ← → ↑ ↓ to navigate · Enter to confirm · Esc to cancel</span></div>' : '<div class="edit-hint">Read-only — you do not have the planner role.</div>') +
      '</div>';

    renderAllocTable();

    if (canEdit) {
      var toggle = $('add-team-toggle');
      if (toggle) toggle.addEventListener('click', function () {
        var panel = $('add-team-panel'); var btn = $('add-team-toggle');
        var open = panel.classList.toggle('open');
        btn.style.color = open ? 'var(--blue)' : '';
        btn.style.borderColor = open ? 'var(--blue)' : '';
      });
    }
  }

  // add a team row locally (no allocation persisted until a cell is saved)
  function addTeamLocal(teamId) {
    if (!canEdit || !teamId) return;
    var p = projects[selIdx];
    if (!p.ta) p.ta = {};
    if (!p.ta[teamId]) p.ta[teamId] = {};
    renderDetail();
    $timeout(function () {
      var panel = $('add-team-panel'); if (panel) panel.classList.add('open');
      var btn = $('add-team-toggle'); if (btn) { btn.style.color = 'var(--blue)'; btn.style.borderColor = 'var(--blue)'; }
    }, 0);
    if (curView === 'heatmap') renderHeatmap();
    toast(teamName(teamId) + ' added');
  }

  function renderAllocTable() {
    if (selIdx === null) return;
    var p = projects[selIdx]; var ta = getTA(p);
    var tbody = $('alloc-tbody'); if (!tbody) return;
    var amos = activeMos();
    var tList = Object.keys(ta);
    var origTA = (RAW[selIdx] || {}).ta || {};

    if (!tList.length) {
      tbody.innerHTML = '<tr><td colspan="' + (amos.length + 2) + '" style="text-align:center;padding:20px;color:var(--ink3)">' +
        (canEdit ? 'No teams added yet — click <strong>Add team</strong> above to start allocating' : 'No allocations') + '</td></tr>';
      return;
    }

    tbody.innerHTML = tList.map(function (team) {
      var mos = ta[team] || {};
      var origMos = (origTA[team] || {});
      var rt = amos.reduce(function (s, m) { return s + (mos[m] || 0); }, 0);
      var cells = amos.map(function (m) {
        var v = mos[m] || 0;
        var origV = origMos[m] || 0;
        var changed = Math.abs(v - origV) > 0.001;
        var s = cellClr(v);
        return '<td><div class="acell' + (v > 0 ? ' has-val' : '') + (changed ? ' changed' : '') + '"' +
          ' style="background:' + s.bg + ';color:' + s.clr + '"' +
          ' data-team="' + esc(team) + '" data-month="' + m + '" data-val="' + v + '"' +
          (canEdit ? ' data-act="edit"' : '') +
          ' title="' + esc(teamName(team)) + ' · ' + esc(moLabel(m)) + (changed ? ' (edited)' : '') + '">' +
          (s.txt === '—' ? '' : s.txt) + '</div></td>';
      }).join('');
      return '<tr data-team="' + esc(team) + '">' +
        '<td class="team-td" style="padding:0"><div class="team-td-inner">' +
        '<span class="team-td-name">' + esc(teamName(team)) + '</span>' +
        (canEdit ? '<button class="team-remove" data-act="removeTeam" data-team="' + esc(team) + '" title="Remove ' + esc(teamName(team)) + '">×</button>' : '') +
        '</div></td>' + cells +
        '<td class="total-td"><div class="hm-val" style="font-weight:700;height:34px">' + rt.toFixed(1) + '</div></td></tr>';
    }).join('');
  }

  function getAllCells() { return $$('#alloc-tbody .acell'); }

  function navigateCell(fromEl, direction) {
    var cells = getAllCells();
    var idx = cells.indexOf(fromEl);
    if (idx < 0) return null;
    var numCols = activeMos().length;
    var next = null;
    if (direction === 'right' || direction === 'tab') next = cells[idx + 1];
    if (direction === 'left' || direction === 'stab') next = cells[idx - 1];
    if (direction === 'down') next = cells[idx + numCols];
    if (direction === 'up') next = cells[idx - numCols];
    return next || null;
  }

  function startEdit(el, cur) {
    if (!canEdit) return;
    if (editCell && editCell !== el) finishEdit();
    if (editCell === el) return;
    editCell = el;
    el.classList.add('editing');
    var row = el.closest('tr'); if (row) row.classList.add('row-editing');

    var inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '99'; inp.step = '0.1';
    inp.value = cur || ''; inp.placeholder = '0';
    inp.style.cssText = 'width:100%;height:100%;text-align:center;border:none;background:transparent;font-size:12px;font-weight:700;color:inherit;outline:none;font-family:inherit';
    el.innerHTML = ''; el.appendChild(inp);
    inp.focus(); inp.select();

    inp.addEventListener('blur', function () { $timeout(finishEdit, 80); });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        finishEdit();
        var next = navigateCell(el, 'down');
        if (next) $timeout(function () { startEdit(next, parseFloat(next.getAttribute('data-val')) || 0); }, 0);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        el.classList.remove('editing');
        var r = el.closest('tr'); if (r) r.classList.remove('row-editing');
        editCell = null; renderAllocTable(); e.preventDefault();
      } else if (e.key === 'Tab') {
        finishEdit();
        var n2 = navigateCell(el, e.shiftKey ? 'stab' : 'tab');
        if (n2) $timeout(function () { startEdit(n2, parseFloat(n2.getAttribute('data-val')) || 0); }, 0);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) {
        finishEdit(); var n3 = navigateCell(el, 'right');
        if (n3) $timeout(function () { startEdit(n3, parseFloat(n3.getAttribute('data-val')) || 0); }, 0); e.preventDefault();
      } else if (e.key === 'ArrowLeft' && inp.selectionStart === 0) {
        finishEdit(); var n4 = navigateCell(el, 'left');
        if (n4) $timeout(function () { startEdit(n4, parseFloat(n4.getAttribute('data-val')) || 0); }, 0); e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        finishEdit(); var n5 = navigateCell(el, 'down');
        if (n5) $timeout(function () { startEdit(n5, parseFloat(n5.getAttribute('data-val')) || 0); }, 0); e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        finishEdit(); var n6 = navigateCell(el, 'up');
        if (n6) $timeout(function () { startEdit(n6, parseFloat(n6.getAttribute('data-val')) || 0); }, 0); e.preventDefault();
      }
    });
  }

  function finishEdit() {
    if (!editCell) return;
    var el = editCell;
    var inp = el.querySelector('input');
    if (!inp) { editCell = null; return; }
    var val = Math.max(0, Math.min(99, parseFloat(inp.value) || 0));
    var team = el.getAttribute('data-team');
    var month = parseInt(el.getAttribute('data-month'), 10);
    var p = projects[selIdx];
    if (!p.ta) p.ta = {};
    if (!p.ta[team]) p.ta[team] = {};
    var old = p.ta[team][month] || 0;
    val = Math.round(val * 10) / 10;
    el.classList.remove('editing');
    var row = el.closest('tr'); if (row) row.classList.remove('row-editing');
    editCell = null;

    if (Math.abs(val - old) < 0.001) { renderAllocTable(); refreshFooter(); return; }
    commitCell(p, team, month, val, old);
  }

  // ── PERSISTENCE (optimistic UI; revert + toast on failure) ──
  function setLocal(p, team, month, val) {
    if (!p.ta) p.ta = {};
    if (!p.ta[team]) p.ta[team] = {};
    if (val === 0) delete p.ta[team][month];
    else p.ta[team][month] = Math.round(val * 10) / 10;
  }

  function commitCell(p, team, month, val, old) {
    setLocal(p, team, month, val);                 // optimistic
    renderAllocTable(); refreshFooter();
    if (curView === 'heatmap') renderHeatmap();
    if (curView === 'team' && selTeam) renderTeamDetail(selTeam);
    c.server.get({ action: 'saveCell', projectId: p.id, teamId: team, year: YEAR, month: month, fte: val })
      .then(function (r) {
        $timeout(function () {
          var res = r.data.result;
          if (res && res.ok) { toast('Saved'); }
          else {
            setLocal(p, team, month, old);           // revert
            toast('Save failed: ' + ((res && res.error) || r.data.error || 'unknown'));
            if (selIdx !== null) { renderAllocTable(); refreshFooter(); }
            if (curView === 'heatmap') renderHeatmap();
            if (curView === 'team' && selTeam) renderTeamDetail(selTeam);
          }
        }, 0);
      });
  }

  function refreshFooter() {
    if (selIdx === null) return;
    var p = projects[selIdx]; var amos = activeMos();
    var moTots = amos.map(function (m) { return projMoTotal(p, m); });
    var total = moTots.reduce(function (s, v) { return s + v; }, 0);
    var tbl = $('alloc-table'); if (!tbl) return;
    var tfoot = tbl.querySelector('tfoot tr'); if (!tfoot) return;
    var tds = tfoot.querySelectorAll('td');
    amos.forEach(function (m, i) { var v = Math.round(moTots[i] * 10) / 10; var s = cellClr(v); tds[i + 1].innerHTML = '<div class="hm-val" style="background:' + s.bg + ';color:' + s.clr + ';height:34px">' + s.txt + '</div>'; });
    tds[amos.length + 1].innerHTML = '<div class="hm-val" style="font-weight:700;height:34px">' + total.toFixed(1) + '</div>';
  }

  function removeTeam(team) {
    if (!canEdit) return;
    if (!window.confirm('Remove ' + teamName(team) + '? This deletes all of its allocations for ' + YEAR + '.')) return;
    var p = projects[selIdx];
    var backup = angular.copy(p.ta[team]);
    delete p.ta[team];                               // optimistic
    renderDetail(); if (curView === 'heatmap') renderHeatmap();
    c.server.get({ action: 'removeTeam', projectId: p.id, teamId: team, year: YEAR })
      .then(function (r) {
        $timeout(function () {
          var res = r.data.result;
          if (res && res.ok) { toast(teamName(team) + ' removed'); }
          else { p.ta[team] = backup; renderDetail(); toast('Remove failed: ' + ((res && res.error) || r.data.error || 'unknown')); }
        }, 0);
      });
  }

  // Reset just the open project from server truth (re-fetch bootstrap).
  function resetProj() {
    if (!canEdit) return;
    if (!window.confirm('Reload this project from the server (discard unsaved local edits)?')) return;
    reloadFromServer('Reloaded');
  }

  // ── HEATMAP ──────────────────────────────────────────────────
  function renderHeatmap() {
    var area = ($('hm-area') || { value: '' }).value;
    var pri = ($('hm-pri') || { value: '' }).value;
    var teamF = ($('hm-team') || { value: '' }).value;
    var amos = activeMos();
    var fps = projects.filter(function (p) { return (!area || p.a === area) && (!pri || p.p === pri); });

    var alloc = {};
    TEAMS.forEach(function (t) { alloc[t] = {}; amos.forEach(function (m) { alloc[t][m] = 0; }); });
    fps.forEach(function (p) {
      var ta = getTA(p);
      for (var team in ta) {
        if (!ta.hasOwnProperty(team)) continue;
        if (!alloc[team]) alloc[team] = {};
        var mos = ta[team];
        for (var m in mos) { if (!mos.hasOwnProperty(m)) continue; var mi = parseInt(m, 10); if (amos.indexOf(mi) >= 0) alloc[team][mi] = (alloc[team][mi] || 0) + mos[m]; }
      }
    });

    var vTeams = teamF ? [teamF] : TEAMS.filter(function (t) {
      return amos.some(function (m) { return (alloc[t] || {})[m] > 0; }) || HEADCOUNT[t];
    });
    var tbl = $('hm-table'); if (!tbl) return;

    if (hmMode === 'alloc') {
      tbl.innerHTML = '<thead><tr><th class="team-h">Team</th>' + amos.map(function (m) { return '<th>' + esc(moLabel(m)) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
        vTeams.map(function (team) {
          var row = alloc[team] || {};
          var rt = amos.reduce(function (s, m) { return s + (row[m] || 0); }, 0);
          return '<tr><td class="hm-tcell" data-act="drillTeam" data-team="' + esc(team) + '">' + esc(teamName(team)) + '</td>' +
            amos.map(function (m) { var v = Math.round((row[m] || 0) * 10) / 10; var s = cellClr(v); return '<td><div class="hm-val" style="background:' + s.bg + ';color:' + s.clr + '">' + s.txt + '</div></td>'; }).join('') +
            '<td class="hm-total"><div class="hm-val" style="font-weight:700">' + rt.toFixed(1) + '</div></td></tr>';
        }).join('') + '</tbody>';
      return;
    }

    tbl.innerHTML = '<thead><tr><th class="team-h" style="vertical-align:bottom">Team</th>' + amos.map(function (m) { return '<th>' + esc(moLabel(m)) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
      vTeams.map(function (team) {
        var row = alloc[team] || {};
        var hc = HEADCOUNT[team] || {};
        var at = Math.round(amos.reduce(function (s, m) { return s + (row[m] || 0); }, 0) * 10) / 10;
        var ct = amos.reduce(function (s, m) { return s + (hc[m] || 0); }, 0);
        var allocRow = amos.map(function (m) { var v = Math.round((row[m] || 0) * 10) / 10; var s = cellClr(v); return '<td title="' + esc(teamName(team)) + ' ' + esc(moLabel(m)) + ': ' + v + '"><div class="hm-val" style="background:' + s.bg + ';color:' + s.clr + ';height:30px;font-size:12px">' + (v > 0 ? v.toFixed(1) : '—') + '</div></td>'; }).join('');
        var capRow = amos.map(function (m) { var cc = hc[m] || 0; return '<td><div class="cap-val">' + (cc > 0 ? cc : '—') + '</div></td>'; }).join('');
        var gapRow = amos.map(function (m) { var g = Math.round(((hc[m] || 0) - (row[m] || 0)) * 10) / 10; var cls = g > 1 ? 'gok' : g >= 0 ? 'gwarn' : 'gover'; var sg = g > 0 ? '+' : ''; return '<td><div class="gap-val ' + cls + '">' + (g !== 0 ? sg + g.toFixed(1) : '0') + '</div></td>'; }).join('');
        var gt = Math.round((ct - at) * 10) / 10; var gcls = gt > 1 ? 'gok' : gt >= 0 ? 'gwarn' : 'gover'; var gs = gt > 0 ? '+' : '';
        var projCount = projects.filter(function (p) { return Object.keys(getTA(p)).indexOf(team) >= 0; }).length;
        return '<tr><td class="hm-tcell" data-act="drillTeam" data-team="' + esc(team) + '" rowspan="3" style="vertical-align:middle">' + esc(teamName(team)) +
          '<div style="font-size:9px;color:var(--ink3);font-weight:400;margin-top:2px">' + projCount + ' projects</div></td>' +
          allocRow + '<td class="hm-total"><div class="hm-val" style="font-weight:700;height:30px">' + at.toFixed(1) + '</div></td></tr>' +
          '<tr>' + capRow + '<td class="hm-total"><div class="cap-val" style="font-weight:600">' + ct + '</div></td></tr>' +
          '<tr style="border-bottom:2px solid var(--border)">' + gapRow + '<td class="hm-total"><div class="gap-val ' + gcls + '" style="margin:2px 4px">' + gs + gt.toFixed(1) + '</div></td></tr>';
      }).join('') + '</tbody>' +
      '<tfoot><tr style="border-top:2px solid var(--border2)">' +
      '<td style="padding:7px 13px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);background:var(--card2)">Alloc · HC · Gap</td>' +
      amos.map(function (m) {
        var ta2 = Math.round(vTeams.reduce(function (s, t) { return s + ((alloc[t] || {})[m] || 0); }, 0) * 10) / 10;
        var tc = vTeams.reduce(function (s, t) { return s + ((HEADCOUNT[t] || {})[m] || 0); }, 0);
        var tg = Math.round((tc - ta2) * 10) / 10;
        var gc = tg > 1 ? 'gok' : tg >= 0 ? 'gwarn' : 'gover'; var gs2 = tg > 0 ? '+' : '';
        return '<td style="background:var(--card2);border-top:1px solid var(--border);text-align:center;padding:3px 1px">' +
          '<div style="font-size:11px;font-weight:700;color:var(--ink2)">' + ta2.toFixed(1) + '</div>' +
          '<div style="font-size:9px;color:var(--ink3)">' + tc + '</div>' +
          '<div class="gap-val ' + gc + '" style="margin:2px 3px;font-size:10px">' + gs2 + tg.toFixed(1) + '</div></td>';
      }).join('') +
      '<td style="background:var(--card2);border-top:1px solid var(--border);text-align:center;padding:3px">' +
      (function () {
        var ta3 = vTeams.reduce(function (s, t) { return s + amos.reduce(function (ss, m) { return ss + ((alloc[t] || {})[m] || 0); }, 0); }, 0);
        var tc = vTeams.reduce(function (s, t) { return s + amos.reduce(function (ss, m) { return ss + ((HEADCOUNT[t] || {})[m] || 0); }, 0); }, 0);
        var tg = Math.round((tc - ta3) * 10) / 10; var gc = tg > 1 ? 'gok' : tg >= 0 ? 'gwarn' : 'gover';
        return '<div style="font-size:12px;font-weight:700">' + ta3.toFixed(1) + '</div><div style="font-size:9px;color:var(--ink3)">' + tc + '</div><div class="gap-val ' + gc + '" style="margin:2px 3px">' + (tg > 0 ? '+' : '') + tg.toFixed(1) + '</div>';
      })() +
      '</td></tr></tfoot>';
  }

  // ── TEAM VIEW ────────────────────────────────────────────────
  function renderTeamCards() {
    var tots = teamMoTotals(); var amos = activeMos();
    var g = $('team-cards'); if (!g) return;
    g.innerHTML = TEAMS.map(function (t) {
      var row = tots[t] || {}; var hc = HEADCOUNT[t] || {};
      var total = amos.reduce(function (s, m) { return s + (row[m] || 0); }, 0);
      var cap = amos.reduce(function (s, m) { return s + (hc[m] || 0); }, 0);
      var pct = cap > 0 ? Math.min(100, Math.round(total / cap * 100)) : 0;
      var barClr = pct > 100 ? 'var(--red)' : pct > 85 ? 'var(--amber)' : 'var(--blue)';
      var cnt = projects.filter(function (p) { return Object.keys(getTA(p)).indexOf(t) >= 0; }).length;
      var gap = Math.round((cap - total) * 10) / 10;
      var gapStr = gap > 0 ? ('+' + gap.toFixed(1) + ' free') : gap < 0 ? (gap.toFixed(1) + ' over') : 'at capacity';
      var gapClr = gap > 1 ? 'var(--green)' : gap >= 0 ? 'var(--amber)' : 'var(--red)';
      return '<div class="tcard' + (t === selTeam ? ' sel' : '') + '" data-act="drillTeam" data-team="' + esc(t) + '">' +
        '<div class="tcard-name">' + esc(teamName(t)) + '</div>' +
        '<div class="tcard-bar"><div class="tcard-fill" style="width:' + pct + '%;background:' + barClr + '"></div></div>' +
        '<div class="tcard-stat">' + pct + '% utilised · ' + cnt + ' projects</div>' +
        '<div class="tcard-gap" style="color:' + gapClr + '">' + gapStr + '</div></div>';
    }).join('');
  }

  function drillTeam(team) {
    selTeam = team;
    if (curView !== 'team') switchView('team');
    else { renderTeamCards(); renderTeamDetail(team); }
  }

  function renderTeamDetail(team) {
    var amos = activeMos();
    var fps = projects.filter(function (p) { return Object.keys(getTA(p)).indexOf(team) >= 0; })
      .sort(function (a, b) { return (parseInt(a.p) || 9) - (parseInt(b.p) || 9); });
    var grand = fps.reduce(function (s, p) { return s + amos.reduce(function (ss, m) { return ss + ((getTA(p)[team] || {})[m] || 0); }, 0); }, 0);
    var wrap = $('team-detail'); if (!wrap) return;
    wrap.innerHTML = '<div class="tdet-wrap"><div class="tdet-head">' +
      '<div class="tdet-head-name">' + esc(teamName(team)) + ' — ' + fps.length + ' projects</div>' +
      '<div class="tdet-head-stat">' + grand.toFixed(1) + ' FTE · ' + esc(MONTHS[monthS]) + '–' + esc(MONTHS[monthE]) + '</div></div>' +
      '<div style="overflow-x:auto"><table class="tdet-table"><thead><tr>' +
      '<th style="min-width:175px">Project</th><th style="width:85px">Area</th><th style="width:38px">Pri</th>' +
      amos.map(function (m) { return '<th style="text-align:center;width:38px">' + esc(moLabel(m)) + '</th>'; }).join('') +
      '<th style="text-align:center;width:48px">Total</th></tr></thead><tbody>' +
      fps.map(function (p) {
        var alloc = getTA(p)[team] || {};
        var rt = amos.reduce(function (s, m) { return s + (alloc[m] || 0); }, 0);
        var oi = projects.indexOf(p);
        return '<tr data-act="jumpToProject" data-proj="' + oi + '">' +
          '<td style="font-weight:600;font-size:12px">' + esc(p.n) + '</td>' +
          '<td><span class="badge ' + aCls(p.a) + '" style="font-size:9px">' + esc(areaName(p.a)) + '</span></td>' +
          '<td><span class="badge ' + pCls(p.p) + '">' + esc(pLbl(p.p)) + '</span></td>' +
          amos.map(function (m) { var v = Math.round((alloc[m] || 0) * 10) / 10; var s = cellClr(v); return '<td class="mth-td"><div class="mv" style="background:' + s.bg + ';color:' + s.clr + '">' + (v > 0 ? (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) : '') + '</div></td>'; }).join('') +
          '<td class="mth-td" style="font-weight:700">' + rt.toFixed(1) + '</td></tr>';
      }).join('') + '</tbody><tfoot>' +
      '<tr style="border-top:1px solid var(--border)"><td colspan="3" style="padding:6px 9px;font-weight:700;font-size:10px;color:var(--ink3);text-transform:uppercase">Allocated</td>' +
      amos.map(function (m) { var v = Math.round(fps.reduce(function (s, p) { return s + ((getTA(p)[team] || {})[m] || 0); }, 0) * 10) / 10; var s = cellClr(v); return '<td class="mth-td"><div class="mv" style="background:' + s.bg + ';color:' + s.clr + ';font-weight:700">' + (v > 0 ? (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) : '') + '</div></td>'; }).join('') +
      '<td class="mth-td" style="font-weight:700">' + grand.toFixed(1) + '</td></tr>' +
      '<tr><td colspan="3" style="padding:6px 9px;font-weight:600;font-size:10px;color:var(--ink3);text-transform:uppercase">Headcount</td>' +
      amos.map(function (m) { var cc = (HEADCOUNT[team] || {})[m] || 0; return '<td class="mth-td"><div class="mv" style="background:var(--card2);color:var(--ink3)">' + (cc || '') + '</div></td>'; }).join('') +
      '<td class="mth-td" style="color:var(--ink3);font-weight:600">' + amos.reduce(function (s, m) { return s + ((HEADCOUNT[team] || {})[m] || 0); }, 0) + '</td></tr>' +
      '<tr style="border-top:1px solid var(--border)"><td colspan="3" style="padding:6px 9px;font-weight:700;font-size:10px;color:var(--ink3);text-transform:uppercase">Gap</td>' +
      amos.map(function (m) { var a = fps.reduce(function (s, p) { return s + ((getTA(p)[team] || {})[m] || 0); }, 0); var cc = (HEADCOUNT[team] || {})[m] || 0; var g = Math.round((cc - a) * 10) / 10; var cls = g > 1 ? 'gok' : g >= 0 ? 'gwarn' : 'gover'; var sg = g > 0 ? '+' : ''; return '<td class="mth-td"><div class="gap-val ' + cls + '" style="min-width:28px;height:20px">' + (g !== 0 ? sg + g.toFixed(1) : '0') + '</div></td>'; }).join('') +
      (function () { var ta = grand; var tc = amos.reduce(function (s, m) { return s + ((HEADCOUNT[team] || {})[m] || 0); }, 0); var tg = Math.round((tc - ta) * 10) / 10; var gc = tg > 1 ? 'gok' : tg >= 0 ? 'gwarn' : 'gover'; return '<td class="mth-td"><div class="gap-val ' + gc + '" style="min-width:28px;height:20px">' + (tg > 0 ? '+' : '') + tg.toFixed(1) + '</div></td>'; })() +
      '</tr></tfoot></table></div></div>';
  }

  function jumpToProject(idx) { selIdx = idx; switchView('projects'); renderSidebar(); renderDetail(); }

  // ── OVERVIEW ─────────────────────────────────────────────────
  function countChanges() {
    var n = 0;
    projects.forEach(function (p, i) {
      var orig = (RAW[i] || {}).ta || {}; var curr = p.ta || {};
      var ts = {}; for (var k in orig) ts[k] = 1; for (var k2 in curr) ts[k2] = 1;
      for (var t in ts) { for (var m = 1; m <= 12; m++) { var ov = (orig[t] || {})[m] || 0, cv = (curr[t] || {})[m] || 0; if (Math.abs(ov - cv) > 0.001) n++; } }
    });
    return n;
  }
  function hasChanges(idx) {
    var orig = (RAW[idx] || {}).ta || {}; var curr = projects[idx].ta || {};
    var ts = {}; for (var k in orig) ts[k] = 1; for (var k2 in curr) ts[k2] = 1;
    for (var t in ts) { for (var m = 1; m <= 12; m++) { var ov = (orig[t] || {})[m] || 0, cv = (curr[t] || {})[m] || 0; if (Math.abs(ov - cv) > 0.001) return true; } }
    return false;
  }
  function updateChgBar() {
    var n = countChanges(); var bar = $('chg-bar'); if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    var cc = $('chg-count'); if (cc) cc.textContent = n + ' change' + (n !== 1 ? 's' : '');
  }

  function isHoliday(p) { return ['Holidays', 'Hollidays'].indexOf(p.n) >= 0; }

  function renderOverview() {
    updateChgBar();
    var all = projects.filter(function (p) { return !isHoliday(p); });
    var planned = all.filter(function (p) { return Object.keys(getTA(p)).length > 0; });
    var tmt = teamMoTotals();
    var over = TEAMS.filter(function (t) { var hc = HEADCOUNT[t] || {}, tot = tmt[t] || {}; return activeMos().some(function (m) { return (tot[m] || 0) > (hc[m] || 0); }); });
    var totFTE = all.reduce(function (s, p) { return s + projTotal(p); }, 0);
    var chg = countChanges();

    if ($('ov-kpis')) $('ov-kpis').innerHTML = [
      { l: 'Total projects', v: all.length, sub: planned.length + ' planned · ' + (all.length - planned.length) + ' unplanned' },
      { l: 'FTE / period', v: totFTE.toFixed(0), sub: MONTHS[monthS] + '–' + MONTHS[monthE] },
      { l: 'Teams over capacity', v: over.length, sub: over.length > 0 ? over.slice(0, 2).map(teamName).join(', ') : 'All within limits', red: over.length > 0 },
      { l: 'P1 projects', v: all.filter(function (p) { return p.p === '1'; }).length, sub: 'High priority' },
      { l: 'Pending changes', v: chg, sub: chg > 0 ? 'Ready to export' : 'No edits yet', amber: chg > 0 },
      { l: 'Areas', v: (function () { var s = {}; all.forEach(function (p) { s[p.a] = 1; }); return Object.keys(s).length; })(), sub: 'business units' }
    ].map(function (k) {
      return '<div class="ov-kpi"><div class="ov-kpi-label">' + esc(k.l) + '</div>' +
        '<div class="ov-kpi-val" style="color:' + (k.red ? 'var(--red)' : k.amber ? 'var(--amber)' : 'var(--ink)') + '">' + esc(String(k.v)) + '</div>' +
        '<div class="ov-kpi-sub">' + esc(k.sub) + '</div></div>';
    }).join('');

    var byArea = {};
    all.forEach(function (p) { if (!byArea[p.a]) byArea[p.a] = { n: 0, fte: 0, p1: 0 }; byArea[p.a].n++; byArea[p.a].fte += projTotal(p); if (p.p === '1') byArea[p.a].p1++; });
    var maxFte = Math.max.apply(null, Object.keys(byArea).map(function (a) { return byArea[a].fte; }).concat([1]));
    if ($('ov-areas')) $('ov-areas').innerHTML = Object.keys(byArea).map(function (a) { return [a, byArea[a]]; })
      .sort(function (a, b) { return b[1].fte - a[1].fte; }).map(function (e) {
        var areaId = e[0], st = e[1]; var clr = areaClr(areaId); var pct = Math.round(st.fte / maxFte * 100);
        return '<div class="ov-acard" data-act="filterOvArea" data-area="' + esc(areaId) + '">' +
          '<div style="font-weight:700;font-size:13px;margin-bottom:5px">' + esc(areaName(areaId)) + '</div>' +
          '<div class="ov-abar-wrap"><div class="ov-abar" style="width:' + pct + '%;background:' + clr + '"></div></div>' +
          '<div class="ov-astat"><span>' + st.n + ' projects</span><span>' + st.fte.toFixed(1) + ' FTE</span></div>' +
          (st.p1 > 0 ? '<div style="font-size:9px;color:var(--blue);margin-top:3px;font-weight:600">' + st.p1 + ' high priority</div>' : '') + '</div>';
      }).join('');

    renderOvTable();
  }

  function filterOvArea(a) { var el = $('ov-area'); if (el) el.value = a; renderOvTable(); }

  function renderOvTable() {
    var q = ($('ov-search') || { value: '' }).value.toLowerCase();
    var af = ($('ov-area') || { value: '' }).value;
    var pf = ($('ov-pri') || { value: '' }).value;
    var stf = ($('ov-status') || { value: '' }).value;
    var fps = projects.filter(function (p) {
      if (isHoliday(p)) return false;
      var an = areaName(p.a).toLowerCase();
      if (q && p.n.toLowerCase().indexOf(q) < 0 && an.indexOf(q) < 0) return false;
      if (af && p.a !== af) return false;
      if (pf && p.p !== pf) return false;
      if (!snowMatches(p)) return false;
      var ha = Object.keys(getTA(p)).length > 0;
      if (stf === 'planned' && !ha) return false;
      if (stf === 'unplanned' && ha) return false;
      return true;
    });
    fps.sort(function (a, b) {
      var av = a[ovSort.col], bv = b[ovSort.col];
      if (ovSort.col === 'p') { av = parseInt(av) || 9; bv = parseInt(bv) || 9; }
      if (ovSort.col === 'fte') { av = projTotal(a); bv = projTotal(b); }
      if (ovSort.col === 'ss') { av = a.ss || 'zzz'; bv = b.ss || 'zzz'; }
      if (ovSort.col === 'a') { av = areaName(a.a); bv = areaName(b.a); }
      return av < bv ? -ovSort.dir : av > bv ? ovSort.dir : 0;
    });
    var cnt = $('ov-count'); if (cnt) cnt.textContent = fps.length + ' projects';
    var tbody = $('ov-tbody'); if (!tbody) return;
    tbody.innerHTML = fps.map(function (p) {
      var oi = projects.indexOf(p); var ha = Object.keys(getTA(p)).length > 0; var fte = projTotal(p);
      var amos = activeMos(); var mvs = amos.map(function (m) { return projMoTotal(p, m); });
      var maxM = Math.max.apply(null, mvs.concat([0.01]));
      var spark = mvs.map(function (v) { var h = Math.max(2, Math.round(v / maxM * 16)); var col = v > 0 ? cellClr(v).bg : 'var(--card3)'; return '<div class="spark-col" style="height:' + h + 'px;background:' + col + '"></div>'; }).join('');
      var teams = Object.keys(getTA(p)); var chd = hasChanges(oi);
      return '<tr data-act="jumpToProject" data-proj="' + oi + '" style="' + (chd ? 'background:rgba(26,79,168,.03)' : '') + '">' +
        '<td><div style="font-weight:600;font-size:12px;display:flex;align-items:center;gap:6px">' + (chd ? '<span class="chg-dot"></span>' : '') + esc(p.n) + '</div>' + (!ha ? '<div style="font-size:10px;color:var(--ink3);margin-top:2px">⚠ No allocation</div>' : '') + '</td>' +
        '<td><span class="badge ' + aCls(p.a) + '" style="font-size:9px">' + esc(areaName(p.a)) + '</span></td>' +
        '<td><span class="badge ' + pCls(p.p) + '">' + esc(pLbl(p.p)) + '</span></td>' +
        '<td>' + (p.s ? '<span class="badge bsize">' + esc(p.s) + '</span>' : '<span style="color:var(--ink3)">—</span>') + '</td>' +
        '<td>' + (p.ss ? '<span class="badge ' + ssCls(p.ss) + '" style="font-size:9px">' + esc(ssLbl(p.ss)) + '</span>' : '<span style="color:var(--ink3);font-size:10px">—</span>') + '</td>' +
        '<td style="font-size:10px;color:var(--ink2)">' + esc(teams.slice(0, 2).map(teamName).join(', ')) + (teams.length > 2 ? ' +' + (teams.length - 2) : '') + '</td>' +
        '<td style="color:var(--ink3);font-size:11px">' + esc(p.st || '—') + '</td>' +
        '<td style="color:var(--ink3);font-size:11px">' + esc(p.en || '—') + '</td>' +
        '<td><div class="spark">' + spark + '</div></td>' +
        '<td style="text-align:right;font-weight:700">' + (fte > 0 ? fte.toFixed(1) : '—') + '</td></tr>';
    }).join('');
  }

  function initOvSort() {
    $$('.ov-table th[data-s]').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-s');
        if (ovSort.col === col) ovSort.dir *= -1; else { ovSort.col = col; ovSort.dir = 1; }
        $$('.ov-table th span[id^="si-"]').forEach(function (s) { s.textContent = '↕'; });
        var si = $('si-' + col); if (si) si.textContent = ovSort.dir === 1 ? '↑' : '↓';
        renderOvTable();
      });
    });
    ['ov-search', 'ov-area', 'ov-pri', 'ov-status'].forEach(function (id) {
      var el = $(id); if (el) { el.addEventListener('input', renderOvTable); el.addEventListener('change', renderOvTable); }
    });
  }

  // ── PIPELINE KANBAN ──────────────────────────────────────────
  function renderPipeline() {
    var area = ($('pl-area') || { value: '' }).value;
    var pri = ($('pl-pri') || { value: '' }).value;
    var team = ($('pl-team') || { value: '' }).value;
    var q = ($('pl-search') || { value: '' }).value.toLowerCase();
    var fps = projects.map(function (p, i) { var o = angular.extend({}, p); o._i = i; return o; }).filter(function (p) {
      if (isHoliday(p)) return false;
      if (area && p.a !== area) return false;
      if (pri && p.p !== pri) return false;
      if (team && Object.keys(getTA(p)).indexOf(team) < 0) return false;
      var an = areaName(p.a).toLowerCase();
      if (q && p.n.toLowerCase().indexOf(q) < 0 && an.indexOf(q) < 0) return false;
      if (!snowMatches(p)) return false;
      return true;
    });
    var cnt = $('pl-count'); if (cnt) cnt.textContent = fps.length + ' projects';
    var order = SS_ORDER.length ? SS_ORDER : ['approved', 'screening', 'qualified', 'pending', 'new', 'completed', 'canceled', ''];
    var groups = {}; order.forEach(function (s) { groups[s] = []; });
    fps.forEach(function (p) { var k = p.ss || ''; if (!groups[k]) groups[k] = []; groups[k].push(p); });
    var board = $('pl-board'); if (!board) return;
    board.innerHTML = order.filter(function (s) { return groups[s] && groups[s].length > 0; }).map(function (status) {
      var lbl = ssLbl(status); var dot = SS_DOT[status] || '#9a9790';
      var cards = groups[status];
      var totFte = cards.reduce(function (s, p) { return s + projTotal(p); }, 0);
      return '<div class="pl-col"><div class="pl-col-head">' +
        '<div class="pl-col-title"><span class="pl-dot" style="background:' + dot + '"></span>' + esc(lbl) + '</div>' +
        '<span class="pl-count">' + cards.length + '</span></div>' +
        '<div class="pl-body">' + cards.sort(function (a, b) { return (parseInt(a.p) || 9) - (parseInt(b.p) || 9); }).map(function (p) {
          var teams = Object.keys(getTA(p));
          return '<div class="pl-card" data-act="jumpToProject" data-proj="' + p._i + '">' +
            '<div class="pl-card-name">' + esc(p.n) + '</div>' +
            '<div class="pl-card-meta">' +
            '<span class="badge ' + pCls(p.p) + '">' + esc(pLbl(p.p)) + '</span>' +
            '<span class="badge ' + aCls(p.a) + '" style="font-size:9px">' + esc(areaName(p.a)) + '</span>' +
            (p.s ? '<span class="badge bsize">' + esc(p.s) + '</span>' : '') + '</div>' +
            (p.as ? '<div style="margin-top:4px"><span class="badge ' + asCls(p.as) + '" style="font-size:9px">◈ ' + esc(asLbl(p.as)) + '</span></div>' : '') +
            (teams.length ? '<div class="pl-card-sub">' + esc(teams.slice(0, 3).map(teamName).join(' · ')) + (teams.length > 3 ? ' +' + (teams.length - 3) : '') + '</div>' : '') +
            (projTotal(p) > 0 ? '<div class="pl-card-sub">' + projTotal(p).toFixed(1) + ' FTE</div>' : '') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="pl-col-foot">' + totFte.toFixed(1) + ' FTE total</div></div>';
    }).join('');
  }

  // ── EXPORT (client SheetJS; server builds the 3 row-arrays) ──
  function doExport() {
    // Gather session changes (diff projects vs RAW), with display-friendly names.
    var changes = [];
    projects.forEach(function (p, i) {
      var orig = (RAW[i] || {}).ta || {}; var curr = p.ta || {};
      var ts = {}; for (var k in orig) ts[k] = 1; for (var k2 in curr) ts[k2] = 1;
      for (var t in ts) {
        for (var m = 1; m <= 12; m++) {
          var ov = (orig[t] || {})[m] || 0, cv = (curr[t] || {})[m] || 0;
          if (Math.abs(ov - cv) > 0.001) {
            changes.push({ projectName: p.n, team: t, teamName: teamName(t), month: m, original: ov, updated: cv });
          }
        }
      }
    });
    toast('Preparing export…');
    c.server.get({ action: 'export', year: YEAR, changes: changes }).then(function (r) {
      $timeout(function () {
        var res = r.data.result;
        if (!res || !res.ok) { toast('Export failed: ' + ((res && res.error) || r.data.error || 'unknown')); return; }
        if (typeof XLSX === 'undefined') { toast('Export library not loaded'); return; }
        buildXLSX(res);
      }, 0);
    });
  }

  function buildXLSX(res) {
    var d = new Date();
    var yyyymmdd = String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var fname = yyyymmdd + '_projects_capacity_' + YEAR + '.xlsx';
    var wb = XLSX.utils.book_new();

    var ws1 = XLSX.utils.aoa_to_sheet(res.sheet1.rows);
    ws1['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 46 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 10 }]
      .concat(MONTHS.map(function () { return { wch: 5 }; })).concat([{ wch: 30 }]);
    XLSX.utils.book_append_sheet(wb, ws1, res.sheet1.name);

    var ws2 = XLSX.utils.aoa_to_sheet(res.sheet2.rows);
    ws2['!cols'] = [{ wch: 22 }, { wch: 11 }].concat(MONTHS.map(function () { return { wch: 6 }; })).concat([{ wch: 10 }]);
    XLSX.utils.book_append_sheet(wb, ws2, res.sheet2.name);

    var ws3 = XLSX.utils.aoa_to_sheet(res.sheet3.rows);
    ws3['!cols'] = [{ wch: 46 }, { wch: 20 }, { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws3, res.sheet3.name);

    XLSX.writeFile(wb, fname);
    toast('✓ Downloaded ' + fname);
  }

  // Reset-all = re-fetch bootstrap (server is source of truth).
  function reloadFromServer(msg) {
    c.server.get({ action: 'bootstrap', year: YEAR }).then(function (r) {
      $timeout(function () {
        if (r.data && r.data.bootstrap) {
          c.data.bootstrap = r.data.bootstrap;
          var keepView = curView, keepSel = selIdx, keepTeam = selTeam;
          init(r.data.bootstrap);
          // restore navigation context where still valid
          curView = keepView; selTeam = keepTeam;
          if (keepSel !== null && keepSel < projects.length) selIdx = keepSel;
          switchView(curView);
          if (selIdx !== null && curView === 'projects') renderDetail();
          toast(msg || 'Reloaded');
        } else { toast('Reload failed'); }
      }, 0);
    });
  }

  function resetAll() {
    if (!canEdit) return;
    if (!window.confirm('Reset all edits? This reloads from the server.')) return;
    reloadFromServer('All changes reloaded');
  }

  // ── VIEW SWITCHING ───────────────────────────────────────────
  function switchView(v) {
    curView = v;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-v') === v); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'view-' + v); });
    var layout = $('layout'); if (layout) layout.classList.toggle('wide', v === 'overview' || v === 'pipeline');
    if (v === 'heatmap') renderHeatmap();
    if (v === 'team') { renderTeamCards(); if (selTeam) renderTeamDetail(selTeam); }
    if (v === 'overview') renderOverview();
    if (v === 'pipeline') renderPipeline();
    if (v === 'projects') renderDetail();
  }

  // ── EVENT WIRING (delegated; CSP-safe) ──────────────────────
  function wireEvents() {
    // tabs
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { switchView(t.getAttribute('data-v')); }); });

    // sidebar filters
    ['sb-search', 'sb-area', 'sb-pri', 'sb-team'].forEach(function (id) {
      var el = $(id); if (el) { el.addEventListener('input', renderSidebar); el.addEventListener('change', renderSidebar); }
    });

    // snow multi-selects
    var refreshAll = function () { renderSidebar(); if (curView === 'overview') renderOvTable(); if (curView === 'pipeline') renderPipeline(); };
    buildSnowDropdown('sb-snow-drop', 'sb-snow-trigger', 'sb-snow-label', refreshAll);
    buildSnowDropdown('ov-snow-drop', 'ov-snow-trigger', 'ov-snow-label', refreshAll);
    buildSnowDropdown('pl-snow-drop', 'pl-snow-trigger', 'pl-snow-label', refreshAll);

    // heatmap controls
    ['hm-area', 'hm-pri', 'hm-team'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', renderHeatmap); });
    $$('.mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        hmMode = btn.getAttribute('data-mode');
        $$('.mode-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        renderHeatmap();
      });
    });

    // pipeline controls
    ['pl-area', 'pl-pri', 'pl-team', 'pl-search'].forEach(function (id) {
      var el = $(id); if (el) { el.addEventListener('input', renderPipeline); el.addEventListener('change', renderPipeline); }
    });

    // export buttons
    var eb = $('export-btn'); if (eb) eb.addEventListener('click', doExport);
    var ceb = $('chg-export-btn'); if (ceb) ceb.addEventListener('click', doExport);
    var crb = $('chg-reset-btn'); if (crb) crb.addEventListener('click', resetAll);

    // DELEGATED clicks for dynamically rendered content (replaces inline onclick)
    $el.addEventListener('click', function (e) {
      // sidebar project item
      var pit = e.target.closest('.pitem');
      if (pit && pit.hasAttribute('data-idx')) {
        selIdx = parseInt(pit.getAttribute('data-idx'), 10);
        renderSidebar(); renderDetail();
        if (curView !== 'projects') switchView('projects');
        return;
      }
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var action = act.getAttribute('data-act');
      switch (action) {
        case 'edit':
          startEdit(act, parseFloat(act.getAttribute('data-val')) || 0);
          break;
        case 'addTeam':
          addTeamLocal(act.getAttribute('data-team'));
          break;
        case 'removeTeam':
          e.stopPropagation();
          removeTeam(act.getAttribute('data-team'));
          break;
        case 'resetProj':
          resetProj();
          break;
        case 'drillTeam':
          drillTeam(act.getAttribute('data-team'));
          break;
        case 'jumpToProject':
          jumpToProject(parseInt(act.getAttribute('data-proj'), 10));
          break;
        case 'filterOvArea':
          filterOvArea(act.getAttribute('data-area'));
          break;
      }
    });
  }
};
