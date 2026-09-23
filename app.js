(function(){
  "use strict";

  var COLORS = {
    amber:'#e8b84b', rose:'#e08a92', sky:'#7ca8d9', sage:'#7fc29a',
    lilac:'#c793d9', clay:'#e0925c', aqua:'#6fc8c0', olive:'#b7c77a'
  };
  var COLOR_KEYS = Object.keys(COLORS);
  var CURRENCIES = {UAH:'₴', USD:'$', EUR:'€', GBP:'£', PLN:'zł', RUB:'₽'};
  var CURRENCY_KEYS = Object.keys(CURRENCIES);
  var DEFAULT_CURRENCY = 'UAH';
  var DOW_LABELS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  var DOW_VALUES = [1,2,3,4,5,6,0];
  var STORAGE_KEY = 'lessoncal_boards_v1';
  var THEME_KEY = 'lessoncal_theme';

  function getTheme(){
    try{ return localStorage.getItem(THEME_KEY)==='light' ? 'light' : 'dark'; }
    catch(e){ return 'dark'; }
  }
  function setTheme(t){
    var theme = (t==='light') ? 'light' : 'dark';
    try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
    document.documentElement.setAttribute('data-theme', theme);
    state.theme = theme;
    render();
  }

  var state = {
    boards: [],
    activeBoardId: null,
    viewDate: startOfMonth(todayD()),
    selectedDate: null,
    modal: null,
    menuOpen: false,
    storageOk: true,
    pendingImport: null,
    newBoardType: 'lessons',
    financeView: 'income',
    theme: getTheme(),
    editing: null,
    transactionTarget: null
  };

  // ---------- date helpers ----------
  function pad(n){ return String(n).padStart(2,'0'); }
  function fmt(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseD(s){ var p=s.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
  function todayD(){ var n=new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }
  function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  var MONTH_NAMES_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  function fmtHuman(ds){
    var d = parseD(ds);
    return d.getDate()+' '+MONTH_NAMES_GEN[d.getMonth()]+' '+d.getFullYear();
  }
  function fmtHumanNoYear(ds){
    var d = parseD(ds);
    return d.getDate()+' '+MONTH_NAMES_GEN[d.getMonth()];
  }
  function timeRangeStr(s){
    if(!s.timeStart) return '';
    return s.timeStart + (s.timeEnd ? '–'+s.timeEnd : '');
  }
  var MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function uid(){ return 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function newBoard(name, type){
    var t = (type==='events') ? 'events' : (type==='finance' ? 'finance' : 'lessons');
    return {id: uid(), name: name, type: t, subjects: [], events: [], income: [], expenses: [], balances: [], rates: {}, wheelCurrency: ''};
  }
  function activeBoard(){
    var b = state.boards.find(function(x){ return x.id===state.activeBoardId; });
    return b || state.boards[0];
  }
  function normalizeBoard(b){
    b.type = (b.type==='events') ? 'events' : (b.type==='finance' ? 'finance' : 'lessons');
    if(!Array.isArray(b.subjects)) b.subjects = [];
    if(!Array.isArray(b.events)) b.events = [];
    if(!Array.isArray(b.income)) b.income = [];
    if(!Array.isArray(b.expenses)) b.expenses = [];
    if(!Array.isArray(b.balances)) b.balances = [];
    if(!b.rates || typeof b.rates!=='object') b.rates = {};
    if(typeof b.wheelCurrency!=='string' || CURRENCY_KEYS.indexOf(b.wheelCurrency)===-1) b.wheelCurrency = '';
    b.subjects.forEach(function(s){
      s.planType = (s.planType==='static') ? 'static' : 'dynamic';
      if(typeof s.total!=='number') s.total = s.total ? Number(s.total)||0 : 0;
      if(typeof s.paidUntil!=='string') s.paidUntil = '';
      if(typeof s.timeStart!=='string') s.timeStart = '';
      if(typeof s.timeEnd!=='string') s.timeEnd = '';
      if(!s.cancelled) s.cancelled = [];
      if(!s.rescheduled) s.rescheduled = {};
    });
    b.events.forEach(function(e){ e.yearly = !!e.yearly; });
    b.income.forEach(function(x){
      if(typeof x.amount!=='number') x.amount = Number(x.amount)||0;
      x.scheduleType = (x.scheduleType==='monthly') ? 'monthly' : 'once';
      if(typeof x.date!=='string') x.date = '';
      x.currency = (CURRENCY_KEYS.indexOf(x.currency)!==-1) ? x.currency : DEFAULT_CURRENCY;
      var dom = parseInt(x.dayOfMonth,10);
      x.dayOfMonth = (dom>=1 && dom<=28) ? dom : 1;
      if(!Array.isArray(x.history)) x.history = [];
    });
    b.expenses.forEach(function(x){
      if(typeof x.amount!=='number') x.amount = Number(x.amount)||0;
      x.currency = (CURRENCY_KEYS.indexOf(x.currency)!==-1) ? x.currency : DEFAULT_CURRENCY;
      if(!Array.isArray(x.history)) x.history = [];
    });
    b.balances.forEach(function(x){
      if(typeof x.amount!=='number') x.amount = Number(x.amount)||0;
      x.currency = (CURRENCY_KEYS.indexOf(x.currency)!==-1) ? x.currency : DEFAULT_CURRENCY;
      if(typeof x.label!=='string') x.label = '';
    });
    return b;
  }

  function getRate(ab, from, to){
    if(from===to) return 1;
    var direct = ab.rates[from+'_'+to];
    if(typeof direct==='number' && direct>0) return direct;
    var inverse = ab.rates[to+'_'+from];
    if(typeof inverse==='number' && inverse>0) return 1/inverse;
    return null;
  }

  var ratesLoading = false;
  function refreshRatesFromApi(display){
    if(ratesLoading) return;
    if(typeof fetch!=='function'){ showToast('Автообновление курсов недоступно в этом браузере'); return; }
    ratesLoading = true;
    showToast('Обновляем курсы…');
    fetch('https://open.er-api.com/v6/latest/'+encodeURIComponent(display))
      .then(function(r){ return r.json(); })
      .then(function(data){
        ratesLoading = false;
        if(!data || data.result!=='success' || !data.rates){
          showToast('Не удалось получить курсы');
          return;
        }
        var ab = activeBoard();
        var updated = 0;
        CURRENCY_KEYS.forEach(function(c){
          if(c!==display && typeof data.rates[c]==='number' && data.rates[c]>0){
            ab.rates[c+'_'+display] = 1/data.rates[c];
            updated++;
          }
        });
        showToast(updated ? 'Курсы обновлены' : 'Курсы не изменились');
        saveData();
      })
      .catch(function(){
        ratesLoading = false;
        showToast('Не удалось получить курсы — проверьте подключение к интернету');
      });
  }

  // ---------- scheduling logic (lessons) ----------
  function occurrencesInRange(subj, rangeStart, rangeEnd){
    var start = parseD(subj.startDate);
    var from = start > rangeStart ? start : rangeStart;
    var cancelled = new Set(subj.cancelled||[]);
    var reschedFrom = new Set(Object.keys(subj.rescheduled||{}));
    var set = new Set();
    if(from <= rangeEnd){
      var guard = 0;
      for(var d=new Date(from); d<=rangeEnd && guard<4000; d=addDays(d,1), guard++){
        var ds = fmt(d);
        if(subj.days.indexOf(d.getDay())!==-1 && !reschedFrom.has(ds) && !cancelled.has(ds)){
          set.add(ds);
        }
      }
    }
    Object.keys(subj.rescheduled||{}).forEach(function(fromKey){
      var to_ = subj.rescheduled[fromKey];
      var td = parseD(to_);
      if(td>=rangeStart && td<=rangeEnd && !cancelled.has(to_)) set.add(to_);
    });
    return Array.from(set).sort();
  }
  function usedCount(subj){
    var t = todayD();
    return occurrencesInRange(subj, parseD(subj.startDate), t).length;
  }
  function remaining(subj){ return subj.total - usedCount(subj); }
  function forecast(subj){
    var rem = remaining(subj);
    if(rem<=0) return {done:true};
    var t = todayD();
    var future = occurrencesInRange(subj, addDays(t,1), addDays(t, 365*3));
    if(future.length < rem) return {unknown:true, upcoming:future};
    return {date: future[rem-1], upcoming: future.slice(0,8)};
  }
  function daysUntil(ds){
    return Math.round((parseD(ds) - todayD()) / 86400000);
  }
  function dayInfo(subj, ds){
    var d = parseD(ds);
    var isPattern = subj.days.indexOf(d.getDay())!==-1 && ds >= subj.startDate;
    var cancelled = (subj.cancelled||[]).indexOf(ds)!==-1;
    var reschedMap = subj.rescheduled||{};
    var isReschedFrom = Object.prototype.hasOwnProperty.call(reschedMap, ds);
    var movedToKey = null;
    Object.keys(reschedMap).forEach(function(k){ if(reschedMap[k]===ds) movedToKey = k; });
    var past = ds <= fmt(todayD());
    if(movedToKey !== null && !cancelled){
      return {kind: past ? 'moved-done' : 'moved-upcoming', movedFrom: movedToKey};
    }
    if(isPattern && cancelled){ return {kind:'cancelled'}; }
    if(isPattern && isReschedFrom){ return {kind:'moved-away', movedTo: reschedMap[ds]}; }
    if(isPattern){ return {kind: past ? 'done' : 'upcoming'}; }
    return null;
  }

  // ---------- events logic ----------
  function eventOccursOn(ev, ds){
    if(ev.yearly){
      var d = parseD(ds), ed = parseD(ev.date);
      return d.getMonth()===ed.getMonth() && d.getDate()===ed.getDate();
    }
    return ev.date === ds;
  }
  function nextOccurrence(ev){
    var t = todayD();
    if(!ev.yearly){
      return ev.date >= fmt(t) ? ev.date : null;
    }
    var ed = parseD(ev.date);
    var candidate = new Date(t.getFullYear(), ed.getMonth(), ed.getDate());
    if(candidate < t) candidate = new Date(t.getFullYear()+1, ed.getMonth(), ed.getDate());
    return fmt(candidate);
  }

  // ---------- finance logic ----------
  function incomeOccursOn(inc, ds){
    var d = parseD(ds);
    if(inc.scheduleType==='monthly') return d.getDate()===inc.dayOfMonth;
    return inc.date === ds;
  }
  function nextIncomeDate(inc){
    var t = todayD();
    if(inc.scheduleType==='monthly'){
      var candidate = new Date(t.getFullYear(), t.getMonth(), inc.dayOfMonth);
      if(candidate < t) candidate = new Date(t.getFullYear(), t.getMonth()+1, inc.dayOfMonth);
      return fmt(candidate);
    }
    return inc.date >= fmt(t) ? inc.date : null;
  }
  function fmtMoney(n, currency){
    var num;
    try{ num = Number(n).toLocaleString('ru-RU'); }
    catch(e){ num = String(n); }
    if(!currency) return num;
    var sym = CURRENCIES[currency] || currency;
    return num + ' ' + sym;
  }
  function currenciesUsed(list){
    var seen = {};
    var out = [];
    list.forEach(function(x){ if(!seen[x.currency]){ seen[x.currency]=true; out.push(x.currency); } });
    return out;
  }

  // ---------- storage (real browser localStorage — persists on any real host, incl. GitHub Pages) ----------
  function loadData(){
    var raw = null;
    try{ raw = localStorage.getItem(STORAGE_KEY); }
    catch(e){ state.storageOk = false; }
    if(raw){
      try{
        var data = JSON.parse(raw);
        state.boards = data.boards || [];
        state.activeBoardId = data.activeBoardId;
      }catch(e){ state.boards = []; }
    }
    state.boards.forEach(normalizeBoard);
    if(!state.boards || state.boards.length===0){
      var b = newBoard('Мой календарь', 'lessons');
      state.boards = [b]; state.activeBoardId = b.id;
    }
    if(!state.boards.find(function(b){ return b.id===state.activeBoardId; })){
      state.activeBoardId = state.boards[0].id;
    }
    checkHashImport();
    render();
  }
  function saveData(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({boards: state.boards, activeBoardId: state.activeBoardId}));
    }catch(e){ state.storageOk = false; }
    render();
  }

  // ---------- sharing: the "code" is the board's data itself, base64-encoded ----------
  function encodeBoard(board){
    try{ return btoa(encodeURIComponent(JSON.stringify({n: board.name, t: board.type, s: board.subjects, e: board.events, i: board.income, x: board.expenses, y: board.balances, r: board.rates, w: board.wheelCurrency}))); }
    catch(e){ return null; }
  }
  function decodeBoard(code){
    var json = decodeURIComponent(atob(code));
    var obj = JSON.parse(json);
    if(!obj || typeof obj.n!=='string') throw new Error('bad payload');
    var b = {
      name: obj.n,
      type: (obj.t==='events'?'events':(obj.t==='finance'?'finance':'lessons')),
      subjects: Array.isArray(obj.s)?obj.s:[],
      events: Array.isArray(obj.e)?obj.e:[],
      income: Array.isArray(obj.i)?obj.i:[],
      expenses: Array.isArray(obj.x)?obj.x:[],
      balances: Array.isArray(obj.y)?obj.y:[],
      rates: (obj.r && typeof obj.r==='object') ? obj.r : {},
      wheelCurrency: typeof obj.w==='string' ? obj.w : ''
    };
    return b;
  }
  function checkHashImport(){
    var h = window.location.hash;
    if(h && h.indexOf('#board=')===0){
      var raw = h.slice('#board='.length);
      try{
        var code = decodeURIComponent(raw);
        var decoded = decodeBoard(code);
        state.pendingImport = {code: code, name: decoded.name, type: decoded.type, subjects: decoded.subjects, events: decoded.events, income: decoded.income, expenses: decoded.expenses, balances: decoded.balances, rates: decoded.rates, wheelCurrency: decoded.wheelCurrency};
      }catch(e){ /* ignore malformed hash */ }
    }
  }
  function clearHash(){
    try{ history.replaceState(null, '', window.location.pathname + window.location.search); }
    catch(e){ window.location.hash=''; }
  }

  // ---------- board mutations ----------
  function createBoard(name, type){
    var b = newBoard(name && name.trim() ? name.trim() : 'Новая доска', type);
    state.boards.push(b);
    state.activeBoardId = b.id;
    state.menuOpen = false;
    state.financeView = 'income';
    state.editing = null;
    state.transactionTarget = null;
    saveData();
  }
  function switchBoard(id){
    state.activeBoardId = id;
    state.menuOpen = false;
    state.financeView = 'income';
    state.editing = null;
    state.transactionTarget = null;
    saveData();
  }
  function deleteBoard(id){
    if(state.boards.length<=1){ showToast('Нельзя удалить последнюю доску'); return; }
    state.boards = state.boards.filter(function(b){ return b.id!==id; });
    if(state.activeBoardId===id){ state.activeBoardId = state.boards[0].id; }
    saveData();
  }
  function acceptImport(){
    if(!state.pendingImport) return;
    var b = newBoard(state.pendingImport.name, state.pendingImport.type);
    b.subjects = state.pendingImport.subjects;
    b.events = state.pendingImport.events;
    b.income = state.pendingImport.income || [];
    b.expenses = state.pendingImport.expenses || [];
    b.balances = state.pendingImport.balances || [];
    b.rates = state.pendingImport.rates || {};
    b.wheelCurrency = state.pendingImport.wheelCurrency || '';
    normalizeBoard(b);
    state.boards.push(b);
    state.activeBoardId = b.id;
    state.pendingImport = null;
    clearHash();
    showToast('Доска добавлена');
    saveData();
  }
  function dismissImport(){
    state.pendingImport = null;
    clearHash();
    render();
  }

  // ---------- subject mutations (operate on the active board) ----------
  function addSubject(data){
    var b = activeBoard();
    b.subjects.push({
      id: uid(), name: data.name, color: data.color, days: data.days,
      startDate: data.startDate,
      planType: data.planType,
      total: data.total || 0,
      paidUntil: data.paidUntil || '',
      timeStart: data.timeStart || '',
      timeEnd: data.timeEnd || '',
      cancelled: [], rescheduled: {}
    });
    saveData();
  }
  function deleteSubject(id){
    var b = activeBoard();
    b.subjects = b.subjects.filter(function(s){ return s.id!==id; });
    saveData();
  }
  function updateTotal(id, total){
    var b = activeBoard();
    var s = b.subjects.find(function(x){ return x.id===id; });
    if(s){ s.total = Math.max(0, total); saveData(); }
  }
  function updatePaidUntil(id, dateStr){
    var b = activeBoard();
    var s = b.subjects.find(function(x){ return x.id===id; });
    if(s){ s.paidUntil = dateStr; saveData(); }
  }
  function cancelOccurrence(subjId, ds){
    var b = activeBoard();
    var s = b.subjects.find(function(x){ return x.id===subjId; });
    if(!s) return;
    var info = dayInfo(s, ds);
    if(!info) return;
    if(info.kind==='moved-done' || info.kind==='moved-upcoming'){
      var origin = info.movedFrom;
      delete s.rescheduled[origin];
      s.cancelled = (s.cancelled||[]).concat([origin]);
    } else {
      s.cancelled = (s.cancelled||[]).concat([ds]);
    }
    saveData();
  }
  function restoreOccurrence(subjId, ds){
    var b = activeBoard();
    var s = b.subjects.find(function(x){ return x.id===subjId; });
    if(!s) return;
    s.cancelled = (s.cancelled||[]).filter(function(x){ return x!==ds; });
    saveData();
  }
  function rescheduleOccurrence(subjId, fromDs, toDs){
    var b = activeBoard();
    var s = b.subjects.find(function(x){ return x.id===subjId; });
    if(!s || !toDs) return;
    s.rescheduled = s.rescheduled || {};
    s.rescheduled[fromDs] = toDs;
    saveData();
  }

  // ---------- event mutations ----------
  function addEvent(data){
    var b = activeBoard();
    b.events.push({id: uid(), name: data.name, color: data.color, date: data.date, yearly: !!data.yearly});
    saveData();
  }
  function deleteEvent(id){
    var b = activeBoard();
    b.events = b.events.filter(function(e){ return e.id!==id; });
    saveData();
  }
  function updateEvent(id, data){
    var b = activeBoard();
    var e = b.events.find(function(x){ return x.id===id; });
    if(!e) return;
    e.name = data.name; e.color = data.color; e.date = data.date; e.yearly = !!data.yearly;
    saveData();
  }

  // ---------- finance mutations ----------
  function addIncome(data){
    var b = activeBoard();
    b.income.push({
      id: uid(), name: data.name, color: data.color, amount: data.amount, currency: data.currency,
      scheduleType: data.scheduleType, date: data.date || '', dayOfMonth: data.dayOfMonth || 1
    });
    saveData();
  }
  function updateIncome(id, data){
    var b = activeBoard();
    var x = b.income.find(function(v){ return v.id===id; });
    if(!x) return;
    x.name = data.name; x.color = data.color; x.amount = data.amount; x.currency = data.currency;
    x.scheduleType = data.scheduleType; x.date = data.date || ''; x.dayOfMonth = data.dayOfMonth || 1;
    saveData();
  }
  function deleteIncome(id){
    var b = activeBoard();
    b.income = b.income.filter(function(x){ return x.id!==id; });
    saveData();
  }
  function addExpense(data){
    var b = activeBoard();
    b.expenses.push({id: uid(), name: data.name, color: data.color, amount: data.amount, currency: data.currency});
    saveData();
  }
  function updateExpense(id, data){
    var b = activeBoard();
    var x = b.expenses.find(function(v){ return v.id===id; });
    if(!x) return;
    x.name = data.name; x.color = data.color; x.amount = data.amount; x.currency = data.currency;
    saveData();
  }
  function deleteExpense(id){
    var b = activeBoard();
    b.expenses = b.expenses.filter(function(x){ return x.id!==id; });
    saveData();
  }

  // ---------- balance mutations ----------
  function addBalance(data){
    var b = activeBoard();
    b.balances.push({id: uid(), label: data.label || '', currency: data.currency, amount: data.amount});
    saveData();
  }
  function updateBalance(id, data){
    var b = activeBoard();
    var x = b.balances.find(function(v){ return v.id===id; });
    if(!x) return;
    x.label = data.label || ''; x.currency = data.currency; x.amount = data.amount;
    saveData();
  }
  function deleteBalance(id){
    var b = activeBoard();
    b.balances = b.balances.filter(function(x){ return x.id!==id; });
    saveData();
  }

  // ---------- transactions: add an amount to an income/expense card and move a chosen balance account ----------
  function addTransaction(kind, id, amount, balanceId, date){
    var b = activeBoard();
    var list = kind==='income' ? b.income : b.expenses;
    var item = list.find(function(x){ return x.id===id; });
    if(!item) return null;
    item.amount = Math.max(0, item.amount + amount);
    var bal = balanceId ? b.balances.find(function(x){ return x.id===balanceId; }) : null;
    var found = !!bal;
    if(bal){
      bal.amount += (kind==='income' ? amount : -amount);
    }
    if(!Array.isArray(item.history)) item.history = [];
    item.history.push({id: uid(), date: date || fmt(todayD()), amount: amount, balanceId: found ? balanceId : null});
    saveData();
    return found;
  }
  function deleteTransaction(kind, itemId, historyId){
    var b = activeBoard();
    var list = kind==='income' ? b.income : b.expenses;
    var item = list.find(function(x){ return x.id===itemId; });
    if(!item || !Array.isArray(item.history)) return;
    var idx = item.history.findIndex(function(h){ return h.id===historyId; });
    if(idx===-1) return;
    var h = item.history[idx];
    item.amount = Math.max(0, item.amount - h.amount);
    if(h.balanceId){
      var bal = b.balances.find(function(x){ return x.id===h.balanceId; });
      if(bal){ bal.amount -= (kind==='income' ? h.amount : -h.amount); }
    }
    item.history.splice(idx, 1);
    saveData();
  }

  // ---------- render ----------
  var app = document.getElementById('app');

  function render(){
    var html = '';
    html += renderHeader();
    if(state.pendingImport) html += renderImportBanner();
    html += '<div class="layout">';
    html += renderSidebar();
    html += renderCalendar();
    html += '</div>';
    if(state.modal==='add') html += renderAddModal();
    if(state.modal==='day') html += renderDayModal();
    if(state.modal==='balance') html += renderBalanceModal();
    if(state.modal==='transaction') html += renderTransactionModal();
    if(state.modal==='rates') html += renderRatesModal();
    if(state.modal==='history') html += renderTransactionHistoryModal();
    if(state.menuOpen) html += renderMenuDrawer();
    app.innerHTML = html;
    attachHandlers();
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function renderAddModal(){
    var ab = activeBoard();
    if(ab.type==='events') return renderAddEventModal();
    if(ab.type==='finance') return state.financeView==='expenses' ? renderAddExpenseModal() : renderAddIncomeModal();
    return renderAddSubjectModal();
  }
  function renderDayModal(){
    var ab = activeBoard();
    if(ab.type==='events') return renderEventDayModal();
    if(ab.type==='finance') return renderFinanceDayModal();
    return renderLessonDayModal();
  }

  function renderImportBanner(){
    return ''+
    '<div class="import-banner">'+
      '<div class="txt">Ссылка содержит доску «<b>'+escapeHtml(state.pendingImport.name)+'</b>» ('+(state.pendingImport.type==='events'?'события':'занятия')+'). Добавить её к своим?</div>'+
      '<div class="import-actions">'+
        '<button class="btn primary small" data-act="accept-import">Добавить</button>'+
        '<button class="btn small" data-act="dismiss-import">Скрыть</button>'+
      '</div>'+
    '</div>';
  }

  function renderHeader(){
    var vd = state.viewDate;
    var ab = activeBoard();
    var typeLabel = ab.type==='events' ? 'события' : (ab.type==='finance' ? 'финансы' : 'занятия');
    var storageWarn = state.storageOk ? '' :
      '<div class="storage-warn">Локальное хранилище браузера недоступно (например, приватный режим) — изменения не сохранятся.</div>';
    var financeToggle = '';
    if(ab.type==='finance'){
      financeToggle = ''+
        '<button class="btn small'+(state.financeView==='income'?' primary':'')+'" data-act="finance-view" data-view="income">Доходы</button>'+
        '<button class="btn small'+(state.financeView==='expenses'?' primary':'')+'" data-act="finance-view" data-view="expenses">Расходы</button>';
    }
    return ''+
      '<header class="top">'+
        '<div class="top-left">'+
          '<button class="icon-btn" data-act="open-menu" title="Доски">☰</button>'+
          '<div><h1 class="display">Календарь<span>Доска: <b>'+escapeHtml(ab.name)+'</b> · '+typeLabel+'</span></h1></div>'+
        '</div>'+
        '<div class="month-nav">'+
          '<button class="icon-btn" data-act="prev-month">‹</button>'+
          '<div class="label mono">'+MONTH_NAMES[vd.getMonth()]+' '+vd.getFullYear()+'</div>'+
          '<button class="icon-btn" data-act="next-month">›</button>'+
          financeToggle+
          '<button class="btn small" data-act="today">Сегодня</button>'+
        '</div>'+
      '</header>'+
      storageWarn;
  }

  function renderSidebar(){
    var ab = activeBoard();
    if(ab.type==='events') return renderEventsSidebar(ab);
    if(ab.type==='finance') return state.financeView==='expenses' ? renderExpensesSidebar(ab) : renderIncomeSidebar(ab);
    return renderLessonsSidebar(ab);
  }

  function renderLessonsSidebar(ab){
    var html = '<div class="sidebar"><h2>Курсы</h2><div class="cards">';
    if(ab.subjects.length===0){
      html += '<div class="empty" style="padding:20px 6px;"><div class="display">Пока пусто</div>Добавьте первый курс, чтобы начать отсчёт уроков.</div>';
    }
    ab.subjects.forEach(function(s){
      var color = COLORS[s.color] || COLORS.amber;
      var daysStr = s.days.slice().sort(function(a,b){ return DOW_VALUES.indexOf(a)-DOW_VALUES.indexOf(b); })
        .map(function(v){ return DOW_LABELS[DOW_VALUES.indexOf(v)]; }).join(', ');
      var timeStr = timeRangeStr(s);
      var metaLine = daysStr + ' · с '+fmtHuman(s.startDate) + (timeStr ? ' · '+timeStr : '');

      var bodyHtml;
      if(s.planType==='static'){
        var statLine;
        if(!s.paidUntil){
          statLine = '<span class="dim">Дата окончания не указана</span>';
        } else {
          var dl = daysUntil(s.paidUntil);
          if(dl<0) statLine = '<span class="warn">Абонемент истёк '+fmtHuman(s.paidUntil)+'</span>';
          else if(dl<=7) statLine = '<span class="warn">Осталось '+dl+' дн. (до '+fmtHuman(s.paidUntil)+')</span>';
          else statLine = 'Оплачено до <b>'+fmtHuman(s.paidUntil)+'</b>';
        }
        bodyHtml = ''+
          '<div class="pc-stats">'+
            'Абонемент до <span class="pc-total-edit"><input type="date" class="mono" data-act="edit-paiduntil" data-id="'+s.id+'" value="'+(s.paidUntil||'')+'"></span>'+
            '<br>'+statLine+
          '</div>';
      } else {
        var used = usedCount(s);
        var rem = remaining(s);
        var fc = forecast(s);
        var maxDots = 60;
        var dotsHtml = '';
        var dotCount = Math.min(s.total, maxDots);
        for(var i=0;i<dotCount;i++){
          dotsHtml += '<i class="'+(i<used?'filled':'')+'" style="--dotcolor:'+color+'"></i>';
        }
        var overflowNote = s.total>maxDots ? ' <span class="mono" style="font-size:10px;">+'+(s.total-maxDots)+'</span>' : '';
        var statLine2;
        if(rem<0){
          statLine2 = '<span class="warn">Превышение на '+Math.abs(rem)+' — увеличьте количество уроков</span>';
        } else if(rem===0){
          statLine2 = '<span class="warn">Уроки закончились</span>';
        } else if(fc.date){
          statLine2 = 'Хватит до <b>'+fmtHuman(fc.date)+'</b>';
        } else if(fc.unknown){
          statLine2 = '<span class="dim">хватит более чем на 3 года вперёд</span>';
        } else {
          statLine2 = '';
        }
        bodyHtml = ''+
          '<div class="dots">'+dotsHtml+overflowNote+'</div>'+
          '<div class="pc-stats">'+
            'Осталось <b>'+rem+'</b> из '+
            '<span class="pc-total-edit"><input type="number" min="0" class="mono" data-act="edit-total" data-id="'+s.id+'" value="'+s.total+'"></span>'+
            '<br>'+statLine2+
          '</div>';
      }

      html += ''+
        '<div class="punch-card" data-subj="'+s.id+'">'+
          '<div class="notch left"></div><div class="notch right"></div><div class="perf"></div>'+
          '<div class="pc-head">'+
            '<div class="pc-name"><span class="dot" style="background:'+color+'"></span><span class="txt">'+escapeHtml(s.name)+'</span></div>'+
            '<button class="icon-btn" data-act="delete-subject" data-id="'+s.id+'" title="Удалить" style="width:26px;height:26px;font-size:13px;">✕</button>'+
          '</div>'+
          '<div class="pc-days mono">'+metaLine+'</div>'+
          '<div class="pc-body">'+bodyHtml+'</div>'+
        '</div>';
    });
    html += '</div>';
    html += '<button class="add-card" data-act="open-add">+ Добавить курс</button>';
    html += '</div>';
    return html;
  }

  function renderEventsSidebar(ab){
    var html = '<div class="sidebar"><h2>События</h2><div class="cards">';
    if(ab.events.length===0){
      html += '<div class="empty" style="padding:20px 6px;"><div class="display">Пока пусто</div>Добавьте первое событие — например, день рождения.</div>';
    }
    var sorted = ab.events.slice().sort(function(a,b){
      var na = nextOccurrence(a), nb = nextOccurrence(b);
      if(!na && !nb) return 0;
      if(!na) return 1;
      if(!nb) return -1;
      return na < nb ? -1 : 1;
    });
    sorted.forEach(function(ev){
      var color = COLORS[ev.color] || COLORS.amber;
      var next = nextOccurrence(ev);
      var line1 = ev.yearly ? ('Ежегодно · '+fmtHumanNoYear(ev.date)) : fmtHuman(ev.date);
      var line2;
      if(next){
        var dl = daysUntil(next);
        if(dl===0) line2 = '<b style="color:var(--amber)">Сегодня!</b>';
        else line2 = 'через '+dl+' дн.';
      } else {
        line2 = '<span class="dim">прошло</span>';
      }
      html += ''+
        '<div class="punch-card">'+
          '<div class="notch left"></div><div class="notch right"></div><div class="perf"></div>'+
          '<div class="pc-head">'+
            '<div class="pc-name"><span class="dot" style="background:'+color+'"></span><span class="txt">'+escapeHtml(ev.name)+'</span></div>'+
            '<div style="display:flex;gap:4px;">'+
              '<button class="icon-btn" data-act="edit-event" data-id="'+ev.id+'" title="Изменить" style="width:26px;height:26px;font-size:12px;">✎</button>'+
              '<button class="icon-btn" data-act="delete-event" data-id="'+ev.id+'" title="Удалить" style="width:26px;height:26px;font-size:13px;">✕</button>'+
            '</div>'+
          '</div>'+
          '<div class="pc-body">'+
            '<div class="pc-stats">'+line1+'<br>'+line2+'</div>'+
          '</div>'+
        '</div>';
    });
    html += '</div>';
    html += '<button class="add-card" data-act="open-add">+ Добавить событие</button>';
    html += '</div>';
    return html;
  }

  function renderBalanceWidget(ab){
    var totals = {};
    var order = [];
    ab.balances.forEach(function(x){
      if(!totals[x.currency]){ totals[x.currency]=0; order.push(x.currency); }
      totals[x.currency] += x.amount;
    });
    var summary = order.length ? order.map(function(c){ return fmtMoney(totals[c], c); }).join(' · ') : 'Добавить баланс';
    return ''+
      '<button class="balance-widget" data-act="open-balance">'+
        '<div class="balance-widget-label">Баланс</div>'+
        '<div class="balance-widget-value mono">'+escapeHtml(summary)+'</div>'+
      '</button>';
  }

  function renderIncomeSidebar(ab){
    var html = '<div class="sidebar">'+renderBalanceWidget(ab)+'<h2>Доходы</h2><div class="cards">';
    if(ab.income.length===0){
      html += '<div class="empty" style="padding:20px 6px;"><div class="display">Пока пусто</div>Добавьте зарплату, инвестиции или другой источник дохода.</div>';
    }
    var sorted = ab.income.slice().sort(function(a,b){
      var na = nextIncomeDate(a), nb = nextIncomeDate(b);
      if(!na && !nb) return 0;
      if(!na) return 1;
      if(!nb) return -1;
      return na < nb ? -1 : 1;
    });
    sorted.forEach(function(inc){
      var color = COLORS[inc.color] || COLORS.amber;
      var line1 = inc.scheduleType==='monthly' ? ('Ежемесячно · '+inc.dayOfMonth+' числа') : ('Разово · '+fmtHuman(inc.date));
      var next = nextIncomeDate(inc);
      var line2;
      if(next){
        var dl = daysUntil(next);
        if(dl===0) line2 = '<b style="color:var(--amber)">Сегодня!</b>';
        else line2 = 'через '+dl+' дн.';
      } else {
        line2 = '<span class="dim">прошло</span>';
      }
      html += ''+
        '<div class="punch-card">'+
          '<div class="notch left"></div><div class="notch right"></div><div class="perf"></div>'+
          '<div class="pc-head">'+
            '<div class="pc-name"><span class="dot" style="background:'+color+'"></span><span class="txt">'+escapeHtml(inc.name)+'</span></div>'+
            '<div style="display:flex;gap:4px;">'+
              '<button class="icon-btn" data-act="add-transaction" data-kind="income" data-id="'+inc.id+'" title="Добавить сумму" style="width:26px;height:26px;font-size:14px;">+</button>'+
              '<button class="icon-btn" data-act="edit-income" data-id="'+inc.id+'" title="Изменить" style="width:26px;height:26px;font-size:12px;">✎</button>'+
              '<button class="icon-btn" data-act="delete-income" data-id="'+inc.id+'" title="Удалить" style="width:26px;height:26px;font-size:13px;">✕</button>'+
            '</div>'+
          '</div>'+
          '<div class="pc-body">'+
            '<div class="pc-stats"><b>'+fmtMoney(inc.amount, inc.currency)+'</b><br>'+line1+'<br>'+line2+'</div>'+
          '</div>'+
        '</div>';
    });
    html += '</div>';
    html += '<button class="add-card" data-act="open-add">+ Добавить доход</button>';
    html += '</div>';
    return html;
  }

  function renderExpensesSidebar(ab){
    var html = '<div class="sidebar">'+renderBalanceWidget(ab)+'<h2>Расходы</h2><div class="cards">';
    if(ab.expenses.length===0){
      html += '<div class="empty" style="padding:20px 6px;"><div class="display">Пока пусто</div>Добавьте статьи расходов, чтобы увидеть их на колесе.</div>';
    }
    var totalsByCur = {};
    ab.expenses.forEach(function(e){ totalsByCur[e.currency] = (totalsByCur[e.currency]||0) + e.amount; });
    ab.expenses.forEach(function(exp){
      var color = COLORS[exp.color] || COLORS.amber;
      var curTotal = totalsByCur[exp.currency] || 0;
      var pct = curTotal>0 ? Math.round(exp.amount/curTotal*100) : 0;
      html += ''+
        '<div class="punch-card">'+
          '<div class="notch left"></div><div class="notch right"></div><div class="perf"></div>'+
          '<div class="pc-head">'+
            '<div class="pc-name"><span class="dot" style="background:'+color+'"></span><span class="txt">'+escapeHtml(exp.name)+'</span></div>'+
            '<div style="display:flex;gap:4px;">'+
              '<button class="icon-btn" data-act="add-transaction" data-kind="expense" data-id="'+exp.id+'" title="Добавить сумму" style="width:26px;height:26px;font-size:14px;">+</button>'+
              '<button class="icon-btn" data-act="edit-expense" data-id="'+exp.id+'" title="Изменить" style="width:26px;height:26px;font-size:12px;">✎</button>'+
              '<button class="icon-btn" data-act="delete-expense" data-id="'+exp.id+'" title="Удалить" style="width:26px;height:26px;font-size:13px;">✕</button>'+
            '</div>'+
          '</div>'+
          '<div class="pc-body">'+
            '<div class="pc-stats"><b>'+fmtMoney(exp.amount, exp.currency)+'</b><br>'+pct+'% от расходов в '+(CURRENCIES[exp.currency]||exp.currency)+'</div>'+
          '</div>'+
        '</div>';
    });
    html += '</div>';
    html += '<button class="add-card" data-act="open-add">+ Добавить расход</button>';
    html += '</div>';
    return html;
  }

  function renderCalendar(){
    var ab = activeBoard();
    var compact = (ab.type==='finance' && state.financeView==='expenses');
    var html = '<div class="cal-col">';
    html += renderCalendarGrid(compact);
    if(compact) html += renderExpenseWheel(ab);
    html += '</div>';
    return html;
  }

  function renderCalendarGrid(compact){
    var vd = state.viewDate;
    var ab = activeBoard();
    var y = vd.getFullYear(), m = vd.getMonth();
    var firstOfMonth = new Date(y,m,1);
    var jsDow = firstOfMonth.getDay();
    var mondayOffset = (jsDow===0) ? 6 : jsDow-1;
    var gridStart = addDays(firstOfMonth, -mondayOffset);
    var todayStr = fmt(todayD());

    var dowRow = '<div class="cal-dow">'+DOW_LABELS.map(function(l){ return '<div>'+l+'</div>'; }).join('')+'</div>';
    var cells = '';
    for(var i=0;i<42;i++){
      var d = addDays(gridStart, i);
      var ds = fmt(d);
      var outside = d.getMonth()!==m;
      var isToday = ds===todayStr;
      var markers = '';
      if(ab.type==='events'){
        ab.events.forEach(function(ev){
          if(!eventOccursOn(ev, ds)) return;
          var color = COLORS[ev.color] || COLORS.amber;
          var cls = 'marker' + (ds<=todayStr ? '' : ' outline');
          markers += '<span class="'+cls+'" title="'+escapeHtml(ev.name)+'" style="--mc:'+color+'"></span>';
        });
      } else if(ab.type==='finance'){
        ab.income.forEach(function(inc){
          var scheduled = incomeOccursOn(inc, ds);
          var histEntry = (inc.history||[]).find(function(h){ return h.date===ds; });
          if(!scheduled && !histEntry) return;
          var color = COLORS[inc.color] || COLORS.amber;
          var cls = 'marker' + (ds<=todayStr ? '' : ' outline');
          var tt = histEntry ? (inc.name+' · +'+fmtMoney(histEntry.amount, inc.currency)) : (inc.name+' · '+fmtMoney(inc.amount, inc.currency));
          markers += '<span class="'+cls+'" title="'+escapeHtml(tt)+'" style="--mc:'+color+'"></span>';
        });
        ab.expenses.forEach(function(exp){
          var histEntry = (exp.history||[]).find(function(h){ return h.date===ds; });
          if(!histEntry) return;
          var color = COLORS[exp.color] || COLORS.amber;
          var cls = 'marker' + (ds<=todayStr ? '' : ' outline');
          var tt = exp.name+' · -'+fmtMoney(histEntry.amount, exp.currency);
          markers += '<span class="'+cls+'" title="'+escapeHtml(tt)+'" style="--mc:'+color+'"></span>';
        });
      } else {
        ab.subjects.forEach(function(s){
          var info = dayInfo(s, ds);
          if(!info) return;
          var color = COLORS[s.color] || COLORS.amber;
          var cls = 'marker';
          if(info.kind==='cancelled'){ cls += ' cancelled'; }
          else if(info.kind==='upcoming'){ cls += ' outline'; }
          else if(info.kind==='moved-upcoming'){ cls += ' outline moved'; }
          else if(info.kind==='moved-done'){ cls += ' moved'; }
          var tt = s.name + (timeRangeStr(s) ? ' · '+timeRangeStr(s) : '');
          markers += '<span class="'+cls+'" title="'+escapeHtml(tt)+'" style="--mc:'+color+'"></span>';
        });
      }
      cells += ''+
        '<div class="cal-cell'+(outside?' outside':'')+(isToday?' today':'')+'" data-act="open-day" data-date="'+ds+'">'+
          '<div class="num">'+d.getDate()+'</div>'+
          '<div class="cal-markers">'+markers+'</div>'+
        '</div>';
    }
    return '<div class="cal-wrap'+(compact?' compact':'')+'">'+dowRow+'<div class="cal-grid">'+cells+'</div></div>';
  }

  function renderExpenseWheel(ab){
    var curs = currenciesUsed(ab.expenses);
    var display = (ab.wheelCurrency && CURRENCY_KEYS.indexOf(ab.wheelCurrency)!==-1) ? ab.wheelCurrency : (curs[0] || DEFAULT_CURRENCY);
    var controlsHtml = ''+
      '<div class="wheel-controls">'+
        '<label class="mono">Колесо в:</label>'+
        '<select data-act="set-wheel-currency">'+
          CURRENCY_KEYS.map(function(c){ return '<option value="'+c+'"'+(c===display?' selected':'')+'>'+c+' ('+CURRENCIES[c]+')</option>'; }).join('')+
        '</select>'+
        '<button type="button" class="btn small" data-act="refresh-rates" data-to="'+display+'">Обновить курсы</button>'+
        '<button type="button" class="btn small" data-act="open-rates">Курсы валют</button>'+
        '<button type="button" class="btn small" data-act="open-history">История транзакций</button>'+
      '</div>';
    if(ab.expenses.length===0){
      return controlsHtml + '<div class="empty" style="padding:24px 10px;"><div class="display">Колесо пусто</div>Добавьте расходы слева, чтобы увидеть распределение.</div>';
    }

    var missing = [];
    var items = ab.expenses.map(function(exp){
      var rate = getRate(ab, exp.currency, display);
      var known = rate!==null;
      if(!known){ rate = 1; if(missing.indexOf(exp.currency)===-1 && exp.currency!==display) missing.push(exp.currency); }
      return {exp: exp, val: exp.amount*rate, known: known};
    });
    var total = items.reduce(function(s,it){ return s+it.val; }, 0);

    var selectorHtml = controlsHtml;

    var rateHtml = '';
    if(missing.length){
      rateHtml = '<div class="wheel-rate-warning">Не удалось найти курс автоматически — введите вручную:'+
        missing.map(function(c){
          return '<div class="rate-row"><span class="mono">1 '+c+' ('+CURRENCIES[c]+') = </span>'+
            '<input type="number" step="0.0001" min="0" placeholder="курс" data-act="set-rate" data-from="'+c+'" data-to="'+display+'">'+
            '<span class="mono">'+display+'</span></div>';
        }).join('')+
      '</div>';
    }

    if(total<=0){
      var flatLegend = ab.expenses.map(function(exp){
        var color = COLORS[exp.color] || COLORS.amber;
        return '<div class="wheel-legend-item"><span class="dot" style="background:'+color+'"></span><span>'+escapeHtml(exp.name)+'</span><span class="pct">'+fmtMoney(exp.amount, exp.currency)+'</span></div>';
      }).join('');
      return selectorHtml + rateHtml + ''+
      '<div class="finance-wheel-wrap">'+
        '<div class="wheel-outer" style="background:var(--surface-2);">'+
          '<div class="wheel-hole"><div class="wheel-total mono" style="font-size:12px;">0</div><div class="mono" style="font-size:10px;color:var(--ink-faint);">пока нечего делить</div></div>'+
        '</div>'+
        '<div class="wheel-legend">'+flatLegend+'</div>'+
      '</div>';
    }

    var cum = 0;
    var stops = [];
    var legend = '';
    items.forEach(function(it){
      var exp = it.exp;
      var color = COLORS[exp.color] || COLORS.amber;
      var pct = it.val/total*100;
      var start = cum;
      cum += pct;
      stops.push(color+' '+start.toFixed(2)+'% '+cum.toFixed(2)+'%');
      var shown = fmtMoney(exp.amount, exp.currency);
      var extra = '';
      if(exp.currency!==display){
        extra = it.known ? (' ≈ '+fmtMoney(it.val, display)) : ' <span style="color:var(--rose)">— нужен курс</span>';
      }
      legend += ''+
        '<div class="wheel-legend-item">'+
          '<span class="dot" style="background:'+color+'"></span>'+
          '<span>'+escapeHtml(exp.name)+'</span>'+
          '<span class="pct">'+shown+extra+' · '+Math.round(pct)+'%</span>'+
        '</div>';
    });
    var gradient = 'conic-gradient('+stops.join(', ')+')';
    return selectorHtml + rateHtml + ''+
    '<div class="finance-wheel-wrap">'+
      '<div class="wheel-outer" style="background:'+gradient+'">'+
        '<div class="wheel-hole"><div class="wheel-total">'+fmtMoney(total, display)+'</div><div class="mono" style="font-size:10px;color:var(--ink-faint);">всего</div></div>'+
      '</div>'+
      '<div class="wheel-legend">'+legend+'</div>'+
    '</div>';
  }

  function renderAddSubjectModal(){
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">Новый курс</h3>'+
        '<div class="sub">Добавьте занятие и укажите, по каким дням оно проходит</div>'+
        '<form id="add-form">'+
          '<div class="field"><label>Название</label><input type="text" name="name" placeholder="Например, английский" required></div>'+
          '<div class="field"><label>Цвет</label><div class="color-picker">'+
            COLOR_KEYS.map(function(k,idx){
              return '<div class="swatch'+(idx===0?' active':'')+'" data-color="'+k+'" style="background:'+COLORS[k]+'"></div>';
            }).join('')+
          '</div><input type="hidden" name="color" value="'+COLOR_KEYS[0]+'"></div>'+
          '<div class="field"><label>Дни недели</label><div class="day-toggles">'+
            DOW_VALUES.map(function(v,idx){
              return '<button type="button" class="day-toggle" data-day="'+v+'">'+DOW_LABELS[idx]+'</button>';
            }).join('')+
          '</div></div>'+
          '<div class="field"><label>Время (необязательно)</label><div class="field-row">'+
            '<input type="time" name="timeStart">'+
            '<input type="time" name="timeEnd">'+
          '</div></div>'+
          '<div class="field"><label>Дата начала</label><input type="date" name="startDate" value="'+fmt(todayD())+'" required></div>'+
          '<div class="field">'+
            '<label>Тип оплаты</label>'+
            '<div class="toggle-row">'+
              '<button type="button" class="toggle-btn active" data-plan="dynamic">По урокам</button>'+
              '<button type="button" class="toggle-btn" data-plan="static">По абонементу</button>'+
            '</div>'+
            '<input type="hidden" name="planType" value="dynamic">'+
          '</div>'+
          '<div class="field" data-plan-field="dynamic"><label>Количество уроков</label><input type="number" name="total" min="1" value="8"></div>'+
          '<div class="field" data-plan-field="static" style="display:none;"><label>Оплачено до</label><input type="date" name="paidUntil"><div class="field-hint">Вместо счётчика уроков будет показываться, до какого числа оплачен курс.</div></div>'+
          '<div class="modal-actions">'+
            '<button type="button" class="btn" data-act="close-modal">Отмена</button>'+
            '<button type="submit" class="btn primary">Создать курс</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderAddEventModal(){
    var editing = (state.editing && state.editing.kind==='event') ? activeBoard().events.find(function(x){ return x.id===state.editing.id; }) : null;
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">'+(editing?'Изменить событие':'Новое событие')+'</h3>'+
        '<div class="sub">Например, день рождения или разовое напоминание</div>'+
        '<form id="add-event-form">'+
          (editing?'<input type="hidden" name="editId" value="'+editing.id+'">':'')+
          '<div class="field"><label>Название</label><input type="text" name="name" placeholder="Например, день рождения Иры" value="'+(editing?escapeHtml(editing.name):'')+'" required></div>'+
          '<div class="field"><label>Цвет</label><div class="color-picker">'+
            COLOR_KEYS.map(function(k){
              var active = editing ? (editing.color===k) : (k===COLOR_KEYS[0]);
              return '<div class="swatch'+(active?' active':'')+'" data-color="'+k+'" style="background:'+COLORS[k]+'"></div>';
            }).join('')+
          '</div><input type="hidden" name="color" value="'+(editing?editing.color:COLOR_KEYS[0])+'"></div>'+
          '<div class="field"><label>Дата</label><input type="date" name="date" value="'+(editing?editing.date:fmt(todayD()))+'" required></div>'+
          '<div class="field">'+
            '<label style="display:flex; align-items:center; gap:8px; cursor:pointer;">'+
              '<input type="checkbox" name="yearly" style="width:16px;height:16px;"'+(editing&&editing.yearly?' checked':'')+'> Повторять каждый год'+
            '</label>'+
          '</div>'+
          '<div class="modal-actions">'+
            '<button type="button" class="btn" data-act="close-modal">Отмена</button>'+
            '<button type="submit" class="btn primary">'+(editing?'Сохранить':'Добавить событие')+'</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderLessonDayModal(){
    var ds = state.selectedDate;
    var ab = activeBoard();
    var items = '';
    var any = false;
    ab.subjects.forEach(function(s){
      var info = dayInfo(s, ds);
      if(!info) return;
      any = true;
      var color = COLORS[s.color] || COLORS.amber;
      var timeTag = timeRangeStr(s) ? '<span class="mono" style="font-size:11px; color:var(--ink-dim);">'+timeRangeStr(s)+'</span>' : '';
      var head = '<div class="day-item-head"><span class="dot" style="background:'+color+'"></span><span class="nm">'+escapeHtml(s.name)+'</span>'+timeTag+'</div>';
      var body = '';
      if(info.kind==='cancelled'){
        body = '<div class="status warn">Занятие отменено</div>'+
          '<div class="row-actions"><button class="btn small" data-act="restore" data-subj="'+s.id+'" data-date="'+ds+'">Восстановить</button></div>';
      } else if(info.kind==='moved-away'){
        body = '<div class="status">Перенесено на '+fmtHuman(info.movedTo)+'</div>';
      } else if(info.kind==='moved-done' || info.kind==='moved-upcoming'){
        body = '<div class="status ok">Перенесено сюда с '+fmtHuman(info.movedFrom)+'</div>'+
          '<div class="row-actions"><button class="btn small danger" data-act="cancel" data-subj="'+s.id+'" data-date="'+ds+'">Отменить</button></div>';
      } else {
        var label = info.kind==='done' ? 'Прошло / засчитано' : 'Запланировано';
        var cls = info.kind==='done' ? 'ok' : '';
        body = '<div class="status '+cls+'">'+label+'</div>'+
          '<div class="row-actions">'+
            '<button class="btn small danger" data-act="cancel" data-subj="'+s.id+'" data-date="'+ds+'">Отменить</button>'+
            '<button class="btn small" data-act="show-resched" data-subj="'+s.id+'" data-date="'+ds+'">Перенести</button>'+
          '</div>'+
          '<div class="resched-box" data-subj-box="'+s.id+'" data-date-box="'+ds+'" style="display:none;">'+
            '<div class="resched-form">'+
              '<input type="date" class="mono" value="'+ds+'">'+
              '<button class="btn small primary" data-act="confirm-resched" data-subj="'+s.id+'" data-date="'+ds+'">ОК</button>'+
            '</div>'+
          '</div>';
      }
      items += '<div class="day-item">'+head+body+'</div>';
    });
    if(!any){
      items = '<div class="empty" style="padding:20px 6px;">На этот день ничего не запланировано.</div>';
    }
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">'+fmtHuman(ds)+'</h3>'+
        '<div class="sub">Занятия и действия на этот день</div>'+
        items+
      '</div>'+
    '</div>';
  }

  function renderEventDayModal(){
    var ds = state.selectedDate;
    var ab = activeBoard();
    var items = '';
    var any = false;
    ab.events.forEach(function(ev){
      if(!eventOccursOn(ev, ds)) return;
      any = true;
      var color = COLORS[ev.color] || COLORS.amber;
      var head = '<div class="day-item-head"><span class="dot" style="background:'+color+'"></span><span class="nm">'+escapeHtml(ev.name)+'</span></div>';
      var body = (ev.yearly ? '<div class="status ok">Повторяется каждый год</div>' : '<div class="status">Разовое событие</div>')+
        '<div class="row-actions"><button class="btn small danger" data-act="delete-event" data-id="'+ev.id+'">Удалить</button></div>';
      items += '<div class="day-item">'+head+body+'</div>';
    });
    if(!any){
      items = '<div class="empty" style="padding:20px 6px;">На этот день ничего не запланировано.</div>';
    }
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">'+fmtHuman(ds)+'</h3>'+
        '<div class="sub">События на этот день</div>'+
        items+
      '</div>'+
    '</div>';
  }

  function currencyOptionsHtml(selected){
    return CURRENCY_KEYS.map(function(c){
      return '<option value="'+c+'"'+(c===selected?' selected':'')+'>'+c+' ('+CURRENCIES[c]+')</option>';
    }).join('');
  }

  function renderAddIncomeModal(){
    var editing = (state.editing && state.editing.kind==='income') ? activeBoard().income.find(function(x){ return x.id===state.editing.id; }) : null;
    var isMonthly = editing && editing.scheduleType==='monthly';
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">'+(editing?'Изменить доход':'Новый доход')+'</h3>'+
        '<div class="sub">Зарплата, инвестиции или другой источник дохода</div>'+
        '<form id="add-income-form">'+
          (editing?'<input type="hidden" name="editId" value="'+editing.id+'">':'')+
          '<div class="field"><label>Название</label><input type="text" name="name" placeholder="Например, зарплата" value="'+(editing?escapeHtml(editing.name):'')+'" required></div>'+
          '<div class="field-row">'+
            '<div class="field" style="flex:2;"><label>Сумма</label><input type="number" name="amount" min="0" step="0.01" placeholder="0" value="'+(editing?editing.amount:'')+'" required></div>'+
            '<div class="field" style="flex:1;"><label>Валюта</label><select name="currency">'+currencyOptionsHtml(editing?editing.currency:DEFAULT_CURRENCY)+'</select></div>'+
          '</div>'+
          '<div class="field"><label>Цвет</label><div class="color-picker">'+
            COLOR_KEYS.map(function(k){
              var active = editing ? (editing.color===k) : (k===COLOR_KEYS[0]);
              return '<div class="swatch'+(active?' active':'')+'" data-color="'+k+'" style="background:'+COLORS[k]+'"></div>';
            }).join('')+
          '</div><input type="hidden" name="color" value="'+(editing?editing.color:COLOR_KEYS[0])+'"></div>'+
          '<div class="field">'+
            '<label>Периодичность</label>'+
            '<div class="toggle-row">'+
              '<button type="button" class="toggle-btn'+(!isMonthly?' active':'')+'" data-schedule="once">Разово</button>'+
              '<button type="button" class="toggle-btn'+(isMonthly?' active':'')+'" data-schedule="monthly">Ежемесячно</button>'+
            '</div>'+
            '<input type="hidden" name="scheduleType" value="'+(isMonthly?'monthly':'once')+'">'+
          '</div>'+
          '<div class="field" data-schedule-field="once" style="'+(isMonthly?'display:none;':'')+'"><label>Дата</label><input type="date" name="date" value="'+(editing&&editing.date?editing.date:fmt(todayD()))+'"></div>'+
          '<div class="field" data-schedule-field="monthly" style="'+(isMonthly?'':'display:none;')+'"><label>Число месяца</label><input type="number" name="dayOfMonth" min="1" max="28" value="'+(editing?editing.dayOfMonth:1)+'"></div>'+
          '<div class="modal-actions">'+
            '<button type="button" class="btn" data-act="close-modal">Отмена</button>'+
            '<button type="submit" class="btn primary">'+(editing?'Сохранить':'Добавить доход')+'</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderAddExpenseModal(){
    var editing = (state.editing && state.editing.kind==='expense') ? activeBoard().expenses.find(function(x){ return x.id===state.editing.id; }) : null;
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">'+(editing?'Изменить расход':'Новый расход')+'</h3>'+
        '<div class="sub">Появится как доля на колесе расходов</div>'+
        '<form id="add-expense-form">'+
          (editing?'<input type="hidden" name="editId" value="'+editing.id+'">':'')+
          '<div class="field"><label>Название</label><input type="text" name="name" placeholder="Например, аренда" value="'+(editing?escapeHtml(editing.name):'')+'" required></div>'+
          '<div class="field-row">'+
            '<div class="field" style="flex:2;"><label>Сумма</label><input type="number" name="amount" min="0" step="0.01" placeholder="0" value="'+(editing?editing.amount:'')+'" required></div>'+
            '<div class="field" style="flex:1;"><label>Валюта</label><select name="currency">'+currencyOptionsHtml(editing?editing.currency:DEFAULT_CURRENCY)+'</select></div>'+
          '</div>'+
          '<div class="field"><label>Цвет</label><div class="color-picker">'+
            COLOR_KEYS.map(function(k){
              var active = editing ? (editing.color===k) : (k===COLOR_KEYS[0]);
              return '<div class="swatch'+(active?' active':'')+'" data-color="'+k+'" style="background:'+COLORS[k]+'"></div>';
            }).join('')+
          '</div><input type="hidden" name="color" value="'+(editing?editing.color:COLOR_KEYS[0])+'"></div>'+
          '<div class="modal-actions">'+
            '<button type="button" class="btn" data-act="close-modal">Отмена</button>'+
            '<button type="submit" class="btn primary">'+(editing?'Сохранить':'Добавить расход')+'</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderFinanceDayModal(){
    var ds = state.selectedDate;
    var ab = activeBoard();
    var items = '';
    var any = false;
    ab.income.forEach(function(inc){
      var color = COLORS[inc.color] || COLORS.amber;
      if(incomeOccursOn(inc, ds)){
        any = true;
        var head = '<div class="day-item-head"><span class="dot" style="background:'+color+'"></span><span class="nm">'+escapeHtml(inc.name)+'</span><span class="mono" style="font-size:11px;color:var(--ink-dim);">'+fmtMoney(inc.amount, inc.currency)+'</span></div>';
        var body = (inc.scheduleType==='monthly' ? '<div class="status ok">Повторяется ежемесячно</div>' : '<div class="status">Разовый доход</div>')+
          '<div class="row-actions"><button class="btn small danger" data-act="delete-income" data-id="'+inc.id+'">Удалить</button></div>';
        items += '<div class="day-item">'+head+body+'</div>';
      }
      (inc.history||[]).filter(function(h){ return h.date===ds; }).forEach(function(h){
        any = true;
        var head = '<div class="day-item-head"><span class="dot" style="background:'+color+'"></span><span class="nm">'+escapeHtml(inc.name)+' · пополнение</span><span class="mono" style="font-size:11px;color:var(--sage);">+'+fmtMoney(h.amount, inc.currency)+'</span></div>';
        var body = '<div class="row-actions"><button class="btn small danger" data-act="delete-transaction" data-kind="income" data-item="'+inc.id+'" data-hist="'+h.id+'">Удалить запись</button></div>';
        items += '<div class="day-item">'+head+body+'</div>';
      });
    });
    ab.expenses.forEach(function(exp){
      var color = COLORS[exp.color] || COLORS.amber;
      (exp.history||[]).filter(function(h){ return h.date===ds; }).forEach(function(h){
        any = true;
        var head = '<div class="day-item-head"><span class="dot" style="background:'+color+'"></span><span class="nm">'+escapeHtml(exp.name)+' · трата</span><span class="mono" style="font-size:11px;color:var(--rose);">-'+fmtMoney(h.amount, exp.currency)+'</span></div>';
        var body = '<div class="row-actions"><button class="btn small danger" data-act="delete-transaction" data-kind="expense" data-item="'+exp.id+'" data-hist="'+h.id+'">Удалить запись</button></div>';
        items += '<div class="day-item">'+head+body+'</div>';
      });
    });
    if(!any){
      items = '<div class="empty" style="padding:20px 6px;">На этот день ничего не запланировано.</div>';
    }
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">'+fmtHuman(ds)+'</h3>'+
        '<div class="sub">Финансы за этот день</div>'+
        items+
      '</div>'+
    '</div>';
  }

  function renderBalanceModal(){
    var ab = activeBoard();
    var editing = (state.editing && state.editing.kind==='balance') ? ab.balances.find(function(x){ return x.id===state.editing.id; }) : null;
    var rows = '';
    ab.balances.forEach(function(x){
      rows += ''+
        '<div class="day-item">'+
          '<div class="day-item-head">'+
            '<span class="nm">'+(x.label?escapeHtml(x.label)+' · ':'')+fmtMoney(x.amount, x.currency)+'</span>'+
          '</div>'+
          '<div class="row-actions">'+
            '<button class="btn small" data-act="edit-balance" data-id="'+x.id+'">Изменить</button>'+
            '<button class="btn small danger" data-act="delete-balance" data-id="'+x.id+'">Удалить</button>'+
          '</div>'+
        '</div>';
    });
    if(!rows){
      rows = '<div class="empty" style="padding:16px 6px;">Пока нет ни одной записи баланса.</div>';
    }
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">Баланс</h3>'+
        '<div class="sub">Добавьте баланс в своей валюте, а ниже — остальные (наличные, карта в другой валюте и т.д.)</div>'+
        rows+
        '<div class="drawer-hr"></div>'+
        '<form id="balance-form">'+
          (editing?'<input type="hidden" name="editId" value="'+editing.id+'">':'')+
          '<div class="field"><label>Пометка (необязательно)</label><input type="text" name="label" placeholder="Например, карта или наличные" value="'+(editing?escapeHtml(editing.label||''):'')+'"></div>'+
          '<div class="field-row">'+
            '<div class="field" style="flex:2;"><label>Сумма</label><input type="number" name="amount" min="0" step="0.01" placeholder="0" value="'+(editing?editing.amount:'')+'" required></div>'+
            '<div class="field" style="flex:1;"><label>Валюта</label><select name="currency">'+currencyOptionsHtml(editing?editing.currency:DEFAULT_CURRENCY)+'</select></div>'+
          '</div>'+
          '<div class="modal-actions">'+
            (editing?'<button type="button" class="btn" data-act="cancel-edit-balance">Отмена</button>':'')+
            '<button type="submit" class="btn primary">'+(editing?'Сохранить':'Добавить')+'</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderTransactionModal(){
    var t = state.transactionTarget;
    if(!t) return '';
    var ab = activeBoard();
    var list = t.kind==='income' ? ab.income : ab.expenses;
    var item = list.find(function(x){ return x.id===t.id; });
    if(!item) return '';
    var verb = t.kind==='income' ? 'доходу' : 'расходу';
    var effect = t.kind==='income' ? 'прибавится к выбранному счёту' : 'спишется с выбранного счёта';
    var matching = ab.balances.filter(function(x){ return x.currency===item.currency; });
    var accountField;
    if(matching.length){
      accountField = ''+
        '<div class="field"><label>Счёт</label><select name="balanceId">'+
          matching.map(function(x){
            var label = (x.label ? x.label+' · ' : '') + fmtMoney(x.amount, x.currency);
            return '<option value="'+x.id+'">'+escapeHtml(label)+'</option>';
          }).join('')+
          '<option value="">Не изменять баланс</option>'+
        '</select></div>';
    } else {
      accountField = '<div class="field-hint" style="margin-bottom:14px;">Нет счёта в валюте '+item.currency+' — сумма добавится к карточке, но баланс не изменится. Можно добавить счёт через «Баланс» в меню.</div>';
    }
    return ''+
    '<div class="overlay">'+
      '<div class="modal narrow" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">Добавить сумму</h3>'+
        '<div class="sub">К «'+escapeHtml(item.name)+'» ('+verb+'), сейчас '+fmtMoney(item.amount, item.currency)+'. Сумма '+effect+'.</div>'+
        '<form id="transaction-form">'+
          '<div class="field"><label>Сумма ('+(CURRENCIES[item.currency]||item.currency)+')</label><input type="number" name="amount" min="0.01" step="0.01" placeholder="0" required></div>'+
          accountField+
          '<div class="field"><label>Дата траты</label><input type="date" name="date" value="'+fmt(todayD())+'" required></div>'+
          '<div class="modal-actions">'+
            '<button type="button" class="btn" data-act="close-modal">Отмена</button>'+
            '<button type="submit" class="btn primary">Добавить</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderRatesModal(){
    var ab = activeBoard();
    var keys = Object.keys(ab.rates);
    var rows = keys.map(function(k){
      var parts = k.split('_');
      var from = parts[0], to = parts[1];
      return ''+
        '<div class="day-item">'+
          '<div class="day-item-head"><span class="nm mono">1 '+from+' = '+ab.rates[k]+' '+to+'</span></div>'+
          '<div class="row-actions">'+
            '<button class="btn small" data-act="edit-rate" data-key="'+k+'">Изменить</button>'+
            '<button class="btn small danger" data-act="delete-rate" data-key="'+k+'">Удалить</button>'+
          '</div>'+
        '</div>';
    }).join('');
    if(!rows){
      rows = '<div class="empty" style="padding:16px 6px;">Пока нет сохранённых курсов.</div>';
    }
    var editingKey = (state.editing && state.editing.kind==='rate') ? state.editing.key : null;
    var editParts = editingKey ? editingKey.split('_') : null;
    return ''+
    '<div class="overlay">'+
      '<div class="modal narrow" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">Курсы валют</h3>'+
        '<div class="sub">Сохранённые курсы конвертации для колеса расходов</div>'+
        rows+
        '<div class="drawer-hr"></div>'+
        '<form id="rate-form">'+
          (editingKey?'<input type="hidden" name="oldKey" value="'+editingKey+'">':'')+
          '<div class="field-row">'+
            '<div class="field" style="flex:1;"><label>Из</label><select name="from">'+currencyOptionsHtml(editParts?editParts[0]:CURRENCY_KEYS[0])+'</select></div>'+
            '<div class="field" style="flex:1;"><label>В</label><select name="to">'+currencyOptionsHtml(editParts?editParts[1]:CURRENCY_KEYS[1])+'</select></div>'+
          '</div>'+
          '<div class="field"><label>Курс (1 «Из» = ? «В»)</label><input type="number" step="0.0001" min="0" name="value" value="'+(editingKey?ab.rates[editingKey]:'')+'" required></div>'+
          '<div class="modal-actions">'+
            (editingKey?'<button type="button" class="btn" data-act="cancel-edit-rate">Отмена</button>':'')+
            '<button type="submit" class="btn primary">'+(editingKey?'Сохранить':'Добавить курс')+'</button>'+
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderTransactionHistoryModal(){
    var ab = activeBoard();
    var all = [];
    ab.income.forEach(function(inc){
      (inc.history||[]).forEach(function(h){
        all.push({kind:'income', itemId:inc.id, name:inc.name, color:inc.color, currency:inc.currency, h:h});
      });
    });
    ab.expenses.forEach(function(exp){
      (exp.history||[]).forEach(function(h){
        all.push({kind:'expense', itemId:exp.id, name:exp.name, color:exp.color, currency:exp.currency, h:h});
      });
    });
    all.sort(function(a,b){ return a.h.date < b.h.date ? 1 : (a.h.date > b.h.date ? -1 : 0); });
    var rows = all.map(function(t){
      var color = COLORS[t.color] || COLORS.amber;
      var sign = t.kind==='income' ? '+' : '-';
      var signColor = t.kind==='income' ? 'var(--sage)' : 'var(--rose)';
      return ''+
        '<div class="day-item">'+
          '<div class="day-item-head">'+
            '<span class="dot" style="background:'+color+'"></span>'+
            '<span class="nm">'+escapeHtml(t.name)+'</span>'+
            '<span class="mono" style="font-size:11px;color:'+signColor+';">'+sign+fmtMoney(t.h.amount, t.currency)+'</span>'+
          '</div>'+
          '<div class="status">'+fmtHuman(t.h.date)+'</div>'+
          '<div class="row-actions"><button class="btn small danger" data-act="delete-transaction" data-kind="'+t.kind+'" data-item="'+t.itemId+'" data-hist="'+t.h.id+'">Удалить</button></div>'+
        '</div>';
    }).join('');
    if(!rows){
      rows = '<div class="empty" style="padding:16px 6px;">Пока нет ни одной транзакции.</div>';
    }
    return ''+
    '<div class="overlay">'+
      '<div class="modal" data-stop="1">'+
        '<button class="close-x" data-act="close-modal">✕</button>'+
        '<h3 class="display">История транзакций</h3>'+
        '<div class="sub">Все пополнения и траты по карточкам этой доски, от новых к старым</div>'+
        rows+
      '</div>'+
    '</div>';
  }

  function renderMenuDrawer(){
    var boardsHtml = state.boards.map(function(b){
      var active = b.id===state.activeBoardId;
      var tagText = b.type==='events' ? 'события' : (b.type==='finance' ? 'финансы' : 'занятия');
      var tag = '<span class="mono dim" style="font-size:10px;">'+tagText+'</span>';
      return '<div class="board-row'+(active?' active':'')+'">'+
        '<button class="board-name" data-act="switch-board" data-id="'+b.id+'">'+escapeHtml(b.name)+' '+tag+'</button>'+
        (state.boards.length>1 ? '<button class="icon-btn tiny" data-act="delete-board" data-id="'+b.id+'" title="Удалить доску">✕</button>' : '')+
      '</div>';
    }).join('');

    var ab = activeBoard();
    var code = encodeBoard(ab) || '';
    var link = '';
    try{ link = window.location.origin + window.location.pathname + '#board=' + encodeURIComponent(code); }
    catch(e){ link = ''; }

    return ''+
    '<div class="overlay">'+
      '<div class="modal narrow" data-stop="1">'+
        '<button class="close-x" data-act="close-menu">✕</button>'+
        '<h3 class="display">Доски</h3>'+
        '<div class="sub">Переключайтесь между календарями или создайте новый</div>'+
        '<div class="board-list">'+boardsHtml+'</div>'+
        '<div class="drawer-hr"></div>'+
        '<div class="field">'+
          '<label>Тема</label>'+
          '<div class="toggle-row">'+
            '<button type="button" class="toggle-btn'+(state.theme==='dark'?' active':'')+'" data-act="set-theme" data-theme="dark">Тёмная</button>'+
            '<button type="button" class="toggle-btn'+(state.theme==='light'?' active':'')+'" data-act="set-theme" data-theme="light">Светлая</button>'+
          '</div>'+
        '</div>'+
        '<div class="field" style="margin-top:14px;">'+
          '<label>Новая доска</label>'+
          '<div class="toggle-row">'+
            '<button type="button" class="toggle-btn'+(state.newBoardType==='lessons'?' active':'')+'" data-boardtype="lessons">Занятия</button>'+
            '<button type="button" class="toggle-btn'+(state.newBoardType==='events'?' active':'')+'" data-boardtype="events">События</button>'+
            '<button type="button" class="toggle-btn'+(state.newBoardType==='finance'?' active':'')+'" data-boardtype="finance">Финансы</button>'+
          '</div>'+
          '<div class="field-row"><input type="text" id="new-board-name" placeholder="Название доски"><button class="btn primary" data-act="create-board">+</button></div>'+
        '</div>'+
        '<div class="drawer-hr"></div>'+
        '<div class="field">'+
          '<label>Поделиться этой доской</label>'+
          '<textarea class="mono" readonly onclick="this.select()">'+code+'</textarea>'+
          '<div class="field-row" style="margin-top:6px;">'+
            '<button class="btn small" data-act="copy-code" data-code="'+escapeHtml(code)+'">Копировать код</button>'+
            '<button class="btn small" data-act="copy-link" data-link="'+escapeHtml(link)+'">Копировать ссылку</button>'+
          '</div>'+
          '<div class="sub" style="margin:8px 0 0;">Это не живая ссылка, а снимок текущих данных доски. Передайте код или ссылку — открывший её человек сможет добавить себе копию. После изменений откройте это меню снова, чтобы получить обновлённый код.</div>'+
        '</div>'+
        '<div class="drawer-hr"></div>'+
        '<div class="field">'+
          '<label>Вставить код</label>'+
          '<textarea id="import-code" class="mono" placeholder="Вставьте код сюда"></textarea>'+
          '<button class="btn block" style="margin-top:6px;" data-act="import-board">Загрузить</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  // ---------- event handling ----------
  function attachHandlers(){
    app.querySelectorAll('[data-act]').forEach(function(el){
      el.addEventListener('click', function(ev){ handleAction(el, ev); });
    });
    app.querySelectorAll('[data-stop]').forEach(function(el){
      el.addEventListener('click', function(ev){ ev.stopPropagation(); });
    });
    app.querySelectorAll('.overlay').forEach(function(overlay){
      overlay.addEventListener('click', function(ev){
        if(ev.target===overlay){ state.modal=null; state.menuOpen=false; state.editing=null; state.transactionTarget=null; render(); }
      });
    });

    var addForm = document.getElementById('add-form');
    if(addForm){
      var selectedDays = [];
      var colorInput = addForm.querySelector('input[name=color]');
      var planInput = addForm.querySelector('input[name=planType]');
      addForm.querySelectorAll('.swatch').forEach(function(sw){
        sw.addEventListener('click', function(){
          addForm.querySelectorAll('.swatch').forEach(function(x){ x.classList.remove('active'); });
          sw.classList.add('active');
          colorInput.value = sw.dataset.color;
        });
      });
      addForm.querySelectorAll('.day-toggle').forEach(function(btn){
        btn.addEventListener('click', function(){
          var v = Number(btn.dataset.day);
          var idx = selectedDays.indexOf(v);
          if(idx===-1){ selectedDays.push(v); btn.classList.add('active'); }
          else { selectedDays.splice(idx,1); btn.classList.remove('active'); }
        });
      });
      addForm.querySelectorAll('[data-plan]').forEach(function(btn){
        btn.addEventListener('click', function(){
          addForm.querySelectorAll('[data-plan]').forEach(function(x){ x.classList.remove('active'); });
          btn.classList.add('active');
          planInput.value = btn.dataset.plan;
          addForm.querySelectorAll('[data-plan-field]').forEach(function(f){
            f.style.display = (f.dataset.planField===btn.dataset.plan) ? '' : 'none';
          });
        });
      });
      addForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        if(selectedDays.length===0){ showToast('Выберите хотя бы один день недели'); return; }
        var fd = new FormData(addForm);
        var planType = fd.get('planType') || 'dynamic';
        var payload = {
          name: (fd.get('name')||'').toString().trim() || 'Без названия',
          color: fd.get('color'),
          days: selectedDays.slice(),
          startDate: fd.get('startDate'),
          planType: planType,
          timeStart: fd.get('timeStart') || '',
          timeEnd: fd.get('timeEnd') || ''
        };
        if(planType==='static'){
          var paidUntil = fd.get('paidUntil');
          if(!paidUntil){ showToast('Укажите дату, до которой оплачено'); return; }
          payload.paidUntil = paidUntil;
        } else {
          payload.total = Math.max(1, parseInt(fd.get('total'),10) || 1);
        }
        state.modal = null;
        addSubject(payload);
      });
    }

    var addEventForm = document.getElementById('add-event-form');
    if(addEventForm){
      var colorInput2 = addEventForm.querySelector('input[name=color]');
      addEventForm.querySelectorAll('.swatch').forEach(function(sw){
        sw.addEventListener('click', function(){
          addEventForm.querySelectorAll('.swatch').forEach(function(x){ x.classList.remove('active'); });
          sw.classList.add('active');
          colorInput2.value = sw.dataset.color;
        });
      });
      addEventForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(addEventForm);
        var payload = {
          name: (fd.get('name')||'').toString().trim() || 'Без названия',
          color: fd.get('color'),
          date: fd.get('date'),
          yearly: !!fd.get('yearly')
        };
        var editId = fd.get('editId');
        state.modal = null;
        state.editing = null;
        if(editId){ updateEvent(editId, payload); } else { addEvent(payload); }
      });
    }

    var addIncomeForm = document.getElementById('add-income-form');
    if(addIncomeForm){
      var colorInput3 = addIncomeForm.querySelector('input[name=color]');
      var scheduleInput = addIncomeForm.querySelector('input[name=scheduleType]');
      addIncomeForm.querySelectorAll('.swatch').forEach(function(sw){
        sw.addEventListener('click', function(){
          addIncomeForm.querySelectorAll('.swatch').forEach(function(x){ x.classList.remove('active'); });
          sw.classList.add('active');
          colorInput3.value = sw.dataset.color;
        });
      });
      addIncomeForm.querySelectorAll('[data-schedule]').forEach(function(btn){
        btn.addEventListener('click', function(){
          addIncomeForm.querySelectorAll('[data-schedule]').forEach(function(x){ x.classList.remove('active'); });
          btn.classList.add('active');
          scheduleInput.value = btn.dataset.schedule;
          addIncomeForm.querySelectorAll('[data-schedule-field]').forEach(function(f){
            f.style.display = (f.dataset.scheduleField===btn.dataset.schedule) ? '' : 'none';
          });
        });
      });
      addIncomeForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(addIncomeForm);
        var amount = parseFloat(fd.get('amount'));
        if(isNaN(amount) || amount<0){ showToast('Укажите сумму'); return; }
        var scheduleType = fd.get('scheduleType') || 'once';
        var payload = {
          name: (fd.get('name')||'').toString().trim() || 'Без названия',
          color: fd.get('color'),
          amount: amount,
          currency: fd.get('currency') || DEFAULT_CURRENCY,
          scheduleType: scheduleType
        };
        if(scheduleType==='monthly'){
          payload.dayOfMonth = Math.min(28, Math.max(1, parseInt(fd.get('dayOfMonth'),10) || 1));
        } else {
          if(!fd.get('date')){ showToast('Укажите дату'); return; }
          payload.date = fd.get('date');
        }
        var editId = fd.get('editId');
        state.modal = null;
        state.editing = null;
        if(editId){ updateIncome(editId, payload); } else { addIncome(payload); }
      });
    }

    var addExpenseForm = document.getElementById('add-expense-form');
    if(addExpenseForm){
      var colorInput4 = addExpenseForm.querySelector('input[name=color]');
      addExpenseForm.querySelectorAll('.swatch').forEach(function(sw){
        sw.addEventListener('click', function(){
          addExpenseForm.querySelectorAll('.swatch').forEach(function(x){ x.classList.remove('active'); });
          sw.classList.add('active');
          colorInput4.value = sw.dataset.color;
        });
      });
      addExpenseForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(addExpenseForm);
        var amount = parseFloat(fd.get('amount'));
        if(isNaN(amount) || amount<0){ showToast('Укажите сумму'); return; }
        var payload = {
          name: (fd.get('name')||'').toString().trim() || 'Без названия',
          color: fd.get('color'),
          amount: amount,
          currency: fd.get('currency') || DEFAULT_CURRENCY
        };
        var editId = fd.get('editId');
        state.modal = null;
        state.editing = null;
        if(editId){ updateExpense(editId, payload); } else { addExpense(payload); }
      });
    }

    var balanceForm = document.getElementById('balance-form');
    if(balanceForm){
      balanceForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(balanceForm);
        var amount = parseFloat(fd.get('amount'));
        if(!(amount>0)){ showToast('Укажите сумму'); return; }
        var payload = {
          label: (fd.get('label')||'').toString().trim(),
          amount: amount,
          currency: fd.get('currency') || DEFAULT_CURRENCY
        };
        var editId = fd.get('editId');
        state.editing = null;
        if(editId){ updateBalance(editId, payload); } else { addBalance(payload); }
      });
    }

    var transactionForm = document.getElementById('transaction-form');
    if(transactionForm){
      transactionForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(transactionForm);
        var amount = parseFloat(fd.get('amount'));
        if(!(amount>0)){ showToast('Укажите сумму'); return; }
        var balanceId = fd.get('balanceId') || null;
        var date = fd.get('date') || fmt(todayD());
        var t = state.transactionTarget;
        state.modal = null;
        state.transactionTarget = null;
        var balanceFound = addTransaction(t.kind, t.id, amount, balanceId, date);
        if(balanceId && balanceFound===false){ showToast('Добавлено, но счёт не найден — баланс не изменён.'); }
      });
    }

    var rateForm = document.getElementById('rate-form');
    if(rateForm){
      rateForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var fd = new FormData(rateForm);
        var from = fd.get('from'), to = fd.get('to');
        var val = parseFloat(fd.get('value'));
        if(!(val>0)){ showToast('Укажите курс'); return; }
        if(from===to){ showToast('Валюты должны различаться'); return; }
        var oldKey = fd.get('oldKey');
        var b = activeBoard();
        if(oldKey && oldKey!==(from+'_'+to)) delete b.rates[oldKey];
        b.rates[from+'_'+to] = val;
        state.editing = null;
        saveData();
      });
    }

    app.querySelectorAll('[data-boardtype]').forEach(function(btn){
      btn.addEventListener('click', function(){
        app.querySelectorAll('[data-boardtype]').forEach(function(x){ x.classList.remove('active'); });
        btn.classList.add('active');
        state.newBoardType = btn.dataset.boardtype;
      });
    });
  }

  var toastTimer = null;
  function showToast(msg){
    var t = document.getElementById('app-toast');
    if(!t){
      t = document.createElement('div');
      t.id = 'app-toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){
      if(t && t.parentNode) t.parentNode.removeChild(t);
    }, 2400);
  }

  function copyText(text, okMsg){
    if(!text){ showToast('Нечего копировать'); return; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ showToast(okMsg); })
        .catch(function(){ showToast('Не удалось скопировать автоматически'); });
    } else {
      showToast('Скопируйте текст вручную из поля');
    }
  }

  function handleAction(el, ev){
    var act = el.dataset.act;
    switch(act){
      case 'prev-month':
        state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth()-1, 1);
        render(); break;
      case 'next-month':
        state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth()+1, 1);
        render(); break;
      case 'today':
        state.viewDate = startOfMonth(todayD());
        render(); break;
      case 'finance-view':
        state.financeView = el.dataset.view === 'expenses' ? 'expenses' : 'income';
        render(); break;
      case 'set-theme':
        setTheme(el.dataset.theme);
        break;
      case 'refresh-rates':
        refreshRatesFromApi(el.dataset.to);
        break;
      case 'open-add':
        state.modal = 'add'; state.menuOpen = false; state.editing = null; render(); break;
      case 'close-modal':
        state.modal = null; state.editing = null; state.transactionTarget = null; render(); break;
      case 'open-menu':
        state.menuOpen = true; state.modal = null; state.newBoardType = 'lessons'; render(); break;
      case 'close-menu':
        state.menuOpen = false; render(); break;
      case 'open-day':
        state.selectedDate = el.dataset.date; state.modal = 'day'; state.menuOpen = false; render(); break;
      case 'delete-subject':
        ev.stopPropagation();
        deleteSubject(el.dataset.id);
        break;
      case 'delete-event':
        ev.stopPropagation();
        deleteEvent(el.dataset.id);
        break;
      case 'edit-event':
        ev.stopPropagation();
        state.editing = {kind:'event', id: el.dataset.id};
        state.modal = 'add';
        render();
        break;
      case 'delete-income':
        ev.stopPropagation();
        deleteIncome(el.dataset.id);
        break;
      case 'delete-expense':
        ev.stopPropagation();
        deleteExpense(el.dataset.id);
        break;
      case 'delete-transaction':
        ev.stopPropagation();
        deleteTransaction(el.dataset.kind, el.dataset.item, el.dataset.hist);
        break;
      case 'edit-income':
        ev.stopPropagation();
        state.editing = {kind:'income', id: el.dataset.id};
        state.modal = 'add';
        render();
        break;
      case 'edit-expense':
        ev.stopPropagation();
        state.editing = {kind:'expense', id: el.dataset.id};
        state.modal = 'add';
        render();
        break;
      case 'add-transaction':
        ev.stopPropagation();
        state.transactionTarget = {kind: el.dataset.kind, id: el.dataset.id};
        state.modal = 'transaction';
        render();
        break;
      case 'open-balance':
        state.modal = 'balance'; state.menuOpen = false; state.editing = null; render(); break;
      case 'edit-balance':
        state.editing = {kind:'balance', id: el.dataset.id};
        render();
        break;
      case 'cancel-edit-balance':
        state.editing = null;
        render();
        break;
      case 'delete-balance':
        ev.stopPropagation();
        if(state.editing && state.editing.kind==='balance' && state.editing.id===el.dataset.id) state.editing = null;
        deleteBalance(el.dataset.id);
        break;
      case 'open-rates':
        state.modal = 'rates'; state.menuOpen = false; state.editing = null; render(); break;
      case 'edit-rate':
        state.editing = {kind:'rate', key: el.dataset.key};
        render();
        break;
      case 'cancel-edit-rate':
        state.editing = null;
        render();
        break;
      case 'delete-rate':
        ev.stopPropagation();
        if(state.editing && state.editing.kind==='rate' && state.editing.key===el.dataset.key) state.editing = null;
        (function(){
          var b = activeBoard();
          delete b.rates[el.dataset.key];
          saveData();
        })();
        break;
      case 'open-history':
        state.modal = 'history'; state.menuOpen = false; state.editing = null; render(); break;
      case 'cancel':
        cancelOccurrence(el.dataset.subj, el.dataset.date);
        break;
      case 'restore':
        restoreOccurrence(el.dataset.subj, el.dataset.date);
        break;
      case 'show-resched':
        var box = app.querySelector('.resched-box[data-subj-box="'+el.dataset.subj+'"][data-date-box="'+el.dataset.date+'"]');
        if(box) box.style.display = 'block';
        break;
      case 'confirm-resched':
        var box2 = el.closest('.resched-box');
        var inp = box2.querySelector('input[type=date]');
        if(inp && inp.value){
          rescheduleOccurrence(el.dataset.subj, el.dataset.date, inp.value);
        }
        break;
      case 'switch-board':
        switchBoard(el.dataset.id);
        break;
      case 'delete-board':
        ev.stopPropagation();
        deleteBoard(el.dataset.id);
        break;
      case 'create-board':
        var nameInput = document.getElementById('new-board-name');
        createBoard(nameInput ? nameInput.value : '', state.newBoardType);
        break;
      case 'copy-code':
        copyText(el.dataset.code, 'Код скопирован');
        break;
      case 'copy-link':
        copyText(el.dataset.link, 'Ссылка скопирована');
        break;
      case 'import-board':
        var codeInput = document.getElementById('import-code');
        var raw = codeInput ? codeInput.value.trim() : '';
        if(!raw){ showToast('Вставьте код'); break; }
        try{
          var decoded = decodeBoard(raw);
          var nb = newBoard(decoded.name, decoded.type);
          nb.subjects = decoded.subjects;
          nb.events = decoded.events;
          nb.income = decoded.income;
          nb.expenses = decoded.expenses;
          nb.balances = decoded.balances;
          nb.rates = decoded.rates;
          nb.wheelCurrency = decoded.wheelCurrency;
          normalizeBoard(nb);
          state.boards.push(nb);
          state.activeBoardId = nb.id;
          state.menuOpen = false;
          showToast('Доска добавлена');
          saveData();
        }catch(e){
          showToast('Не удалось прочитать код');
        }
        break;
      case 'accept-import':
        acceptImport();
        break;
      case 'dismiss-import':
        dismissImport();
        break;
    }
  }

  app.addEventListener('change', function(ev){
    var t = ev.target;
    if(t && t.dataset && t.dataset.act==='edit-total'){
      var v = Math.max(0, parseInt(t.value,10) || 0);
      updateTotal(t.dataset.id, v);
    }
    if(t && t.dataset && t.dataset.act==='edit-paiduntil'){
      updatePaidUntil(t.dataset.id, t.value);
    }
    if(t && t.dataset && t.dataset.act==='set-wheel-currency'){
      var b = activeBoard();
      b.wheelCurrency = t.value;
      saveData();
    }
    if(t && t.dataset && t.dataset.act==='set-rate'){
      var rateVal = parseFloat(t.value);
      if(rateVal>0){
        var b2 = activeBoard();
        b2.rates[t.dataset.from+'_'+t.dataset.to] = rateVal;
        saveData();
      }
    }
  });

  loadData();
})();