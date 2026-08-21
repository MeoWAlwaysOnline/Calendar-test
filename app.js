(function(){
  "use strict";

  var COLORS = {
    amber:'#e8b84b', rose:'#e08a92', sky:'#7ca8d9', sage:'#7fc29a',
    lilac:'#c793d9', clay:'#e0925c', aqua:'#6fc8c0', olive:'#b7c77a'
  };
  var COLOR_KEYS = Object.keys(COLORS);
  var DOW_LABELS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  var DOW_VALUES = [1,2,3,4,5,6,0];
  var STORAGE_KEY = 'lessoncal_boards_v1';

  var state = {
    boards: [],
    activeBoardId: null,
    viewDate: startOfMonth(todayD()),
    selectedDate: null,
    modal: null,
    menuOpen: false,
    storageOk: true,
    pendingImport: null,
    toast: null
  };

  // ---------- date helpers ----------
  function pad(n){ return String(n).padStart(2,'0'); }
  function fmt(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseD(s){ var p=s.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
  function todayD(){ var n=new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }
  function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function fmtHuman(ds){
    var d = parseD(ds);
    var months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
  }
  var MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function uid(){ return 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function newBoard(name){ return {id: uid(), name: name, subjects: []}; }
  function activeBoard(){
    var b = state.boards.find(function(x){ return x.id===state.activeBoardId; });
    return b || state.boards[0];
  }

  // ---------- scheduling logic ----------
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
    if(!state.boards || state.boards.length===0){
      var b = newBoard('Мой календарь');
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
  // There's no server here, so a short lookup code isn't possible — the code/link
  // simply carries the data. Re-share after changes to hand out an updated code.
  function encodeBoard(board){
    try{ return btoa(encodeURIComponent(JSON.stringify({n: board.name, s: board.subjects}))); }
    catch(e){ return null; }
  }
  function decodeBoard(code){
    var json = decodeURIComponent(atob(code));
    var obj = JSON.parse(json);
    if(!obj || typeof obj.n!=='string' || !Array.isArray(obj.s)) throw new Error('bad payload');
    return {name: obj.n, subjects: obj.s};
  }
  function checkHashImport(){
    var h = window.location.hash;
    if(h && h.indexOf('#board=')===0){
      var raw = h.slice('#board='.length);
      try{
        var code = decodeURIComponent(raw);
        var decoded = decodeBoard(code);
        state.pendingImport = {code: code, name: decoded.name, subjects: decoded.subjects};
      }catch(e){ /* ignore malformed hash */ }
    }
  }
  function clearHash(){
    try{ history.replaceState(null, '', window.location.pathname + window.location.search); }
    catch(e){ window.location.hash=''; }
  }

  // ---------- board mutations ----------
  function createBoard(name){
    var b = newBoard(name && name.trim() ? name.trim() : 'Новая доска');
    state.boards.push(b);
    state.activeBoardId = b.id;
    state.menuOpen = false;
    saveData();
  }
  function switchBoard(id){
    state.activeBoardId = id;
    state.menuOpen = false;
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
    var b = newBoard(state.pendingImport.name);
    b.subjects = state.pendingImport.subjects;
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
      startDate: data.startDate, total: data.total,
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
    if(state.menuOpen) html += renderMenuDrawer();
    if(state.toast) html += '<div class="toast">'+escapeHtml(state.toast)+'</div>';
    app.innerHTML = html;
    attachHandlers();
    if(state.toast){ setTimeout(function(){ state.toast=null; render(); }, 2400); }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function renderImportBanner(){
    return ''+
    '<div class="import-banner">'+
      '<div class="txt">Ссылка содержит доску «<b>'+escapeHtml(state.pendingImport.name)+'</b>». Добавить её к своим?</div>'+
      '<div class="import-actions">'+
        '<button class="btn primary small" data-act="accept-import">Добавить</button>'+
        '<button class="btn small" data-act="dismiss-import">Скрыть</button>'+
      '</div>'+
    '</div>';
  }

  function renderHeader(){
    var vd = state.viewDate;
    var ab = activeBoard();
    var storageWarn = state.storageOk ? '' :
      '<div class="storage-warn">Локальное хранилище браузера недоступно (например, приватный режим) — изменения не сохранятся.</div>';
    return ''+
      '<header class="top">'+
        '<div class="top-left">'+
          '<button class="icon-btn" data-act="open-menu" title="Доски">☰</button>'+
          '<div><h1 class="display">Календарь<span>Доска: <b>'+escapeHtml(ab.name)+'</b></span></h1></div>'+
        '</div>'+
        '<div class="month-nav">'+
          '<button class="icon-btn" data-act="prev-month">‹</button>'+
          '<div class="label mono">'+MONTH_NAMES[vd.getMonth()]+' '+vd.getFullYear()+'</div>'+
          '<button class="icon-btn" data-act="next-month">›</button>'+
          '<button class="btn small" data-act="today">Сегодня</button>'+
        '</div>'+
      '</header>'+
      storageWarn;
  }

  function renderSidebar(){
    var ab = activeBoard();
    var html = '<div class="sidebar"><h2>Курсы</h2><div class="cards">';
    if(ab.subjects.length===0){
      html += '<div class="empty" style="padding:20px 6px;"><div class="display">Пока пусто</div>Добавьте первый курс, чтобы начать отсчёт уроков.</div>';
    }
    ab.subjects.forEach(function(s){
      var used = usedCount(s);
      var rem = remaining(s);
      var fc = forecast(s);
      var color = COLORS[s.color] || COLORS.amber;
      var maxDots = 60;
      var dotsHtml = '';
      var dotCount = Math.min(s.total, maxDots);
      for(var i=0;i<dotCount;i++){
        dotsHtml += '<i class="'+(i<used?'filled':'')+'" style="--dotcolor:'+color+'"></i>';
      }
      var overflowNote = s.total>maxDots ? ' <span class="mono" style="font-size:10px;">+'+(s.total-maxDots)+'</span>' : '';
      var daysStr = s.days.slice().sort(function(a,b){ return DOW_VALUES.indexOf(a)-DOW_VALUES.indexOf(b); })
        .map(function(v){ return DOW_LABELS[DOW_VALUES.indexOf(v)]; }).join(', ');
      var statLine;
      if(rem<0){
        statLine = '<span class="warn">Превышение на '+Math.abs(rem)+' — увеличьте количество уроков</span>';
      } else if(rem===0){
        statLine = '<span class="warn">Уроки закончились</span>';
      } else if(fc.date){
        statLine = 'Хватит до <b>'+fmtHuman(fc.date)+'</b>';
      } else if(fc.unknown){
        statLine = '<span style="color:var(--ink-faint)">хватит более чем на 3 года вперёд</span>';
      } else {
        statLine = '';
      }
      html += ''+
        '<div class="punch-card" data-subj="'+s.id+'">'+
          '<div class="notch left"></div><div class="notch right"></div><div class="perf"></div>'+
          '<div class="pc-head">'+
            '<div class="pc-name"><span class="dot" style="background:'+color+'"></span><span class="txt">'+escapeHtml(s.name)+'</span></div>'+
            '<button class="icon-btn" data-act="delete-subject" data-id="'+s.id+'" title="Удалить" style="width:26px;height:26px;font-size:13px;">✕</button>'+
          '</div>'+
          '<div class="pc-days mono">'+daysStr+' · с '+fmtHuman(s.startDate)+'</div>'+
          '<div class="pc-body">'+
            '<div class="dots">'+dotsHtml+overflowNote+'</div>'+
            '<div class="pc-stats">'+
              'Осталось <b>'+rem+'</b> из '+
              '<span class="pc-total-edit"><input type="number" min="0" class="mono" data-act="edit-total" data-id="'+s.id+'" value="'+s.total+'"></span>'+
              '<br>'+statLine+
            '</div>'+
          '</div>'+
        '</div>';
    });
    html += '</div>';
    html += '<button class="add-card" data-act="open-add">+ Добавить курс</button>';
    html += '</div>';
    return html;
  }

  function renderCalendar(){
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
      ab.subjects.forEach(function(s){
        var info = dayInfo(s, ds);
        if(!info) return;
        var color = COLORS[s.color] || COLORS.amber;
        var cls = 'marker';
        if(info.kind==='cancelled'){ cls += ' cancelled'; }
        else if(info.kind==='upcoming'){ cls += ' outline'; }
        else if(info.kind==='moved-upcoming'){ cls += ' outline moved'; }
        else if(info.kind==='moved-done'){ cls += ' moved'; }
        markers += '<span class="'+cls+'" style="--mc:'+color+'"></span>';
      });
      cells += ''+
        '<div class="cal-cell'+(outside?' outside':'')+(isToday?' today':'')+'" data-act="open-day" data-date="'+ds+'">'+
          '<div class="num">'+d.getDate()+'</div>'+
          '<div class="cal-markers">'+markers+'</div>'+
        '</div>';
    }
    return '<div class="cal-wrap">'+dowRow+'<div class="cal-grid">'+cells+'</div></div>';
  }

  function renderAddModal(){
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
          '<div class="field"><label>Дата начала</label><input type="date" name="startDate" value="'+fmt(todayD())+'" required></div>'+
          '<div class="field"><label>Количество уроков</label><input type="number" name="total" min="1" value="8" required></div>'+
          '<div class="modal-actions">'+
            '<button type="button" class="btn" data-act="close-modal">Отмена</button>'+
            '<button type="submit" class="btn primary">Создать курс</button>'+ // =========
          '</div>'+
        '</form>'+
      '</div>'+
    '</div>';
  }

  function renderDayModal(){
    var ds = state.selectedDate;
    var ab = activeBoard();
    var items = '';
    var any = false;
    ab.subjects.forEach(function(s){
      var info = dayInfo(s, ds);
      if(!info) return;
      any = true;
      var color = COLORS[s.color] || COLORS.amber;
      var head = '<div class="day-item-head"><span class="dot" style="background:'+color+'"></span><span class="nm">'+escapeHtml(s.name)+'</span></div>';
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

  function renderMenuDrawer(){
    var boardsHtml = state.boards.map(function(b){
      var active = b.id===state.activeBoardId;
      return '<div class="board-row'+(active?' active':'')+'">'+
        '<button class="board-name" data-act="switch-board" data-id="'+b.id+'">'+escapeHtml(b.name)+'</button>'+
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
        '<div class="field" style="margin-top:14px;">'+
          '<label>Новая доска</label>'+
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
        if(ev.target===overlay){ state.modal=null; state.menuOpen=false; render(); }
      });
    });
    var addForm = document.getElementById('add-form');
    if(addForm){
      var selectedDays = [];
      var colorInput = addForm.querySelector('input[name=color]');
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
      addForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        if(selectedDays.length===0){ showToast('Выберите хотя бы один день недели'); return; }
        var fd = new FormData(addForm);
        addSubject({
          name: (fd.get('name')||'').toString().trim() || 'Без названия',
          color: fd.get('color'),
          days: selectedDays.slice(),
          startDate: fd.get('startDate'),
          total: Math.max(1, parseInt(fd.get('total'),10) || 1)
        });
        state.modal = null;
      });
    }
  }

  function showToast(msg){ state.toast = msg; render(); }

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
      case 'open-add':
        state.modal = 'add'; state.menuOpen = false; render(); break;
      case 'close-modal':
        state.modal = null; render(); break;
      case 'open-menu':
        state.menuOpen = true; state.modal = null; render(); break;
      case 'close-menu':
        state.menuOpen = false; render(); break;
      case 'open-day':
        state.selectedDate = el.dataset.date; state.modal = 'day'; state.menuOpen = false; render(); break;
      case 'delete-subject':
        ev.stopPropagation();
        deleteSubject(el.dataset.id);
        break;
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
        createBoard(nameInput ? nameInput.value : '');
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
          var nb = newBoard(decoded.name);
          nb.subjects = decoded.subjects;
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
  });

  loadData();
})();