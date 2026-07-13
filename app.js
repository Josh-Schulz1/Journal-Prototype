/* ---------- State ---------- */
const STORAGE_KEY = 'eveningPagesData';

const defaultPages = () => ([
  { type:'text', date:'Apr 3', text:"Woke up before the alarm for once. Walked down to the river while the fog was still sitting on the water. Didn't take a single photo — just stood there." },
  { type:'photo', date:'Apr 6', photo:null, caption:'The market on Grant St.' },
  { type:'empty', date:'Apr 9' },
  { type:'ai', date:'Apr 11', prompt:'a quiet lighthouse at dusk, one window lit' },
  { type:'empty', date:'Apr 14' }
]);

let state = {
  screen: 'cover',        // 'cover' | 'book'
  pageIndex: 0,
  pages: loadPages(),
  editor: null,           // null | 'menu' | 'text' | 'ai' | 'voice'
  enlarge: false,
  print: false,
  recording: false,
  recSeconds: 0,
  recTimer: null,
  mediaRecorder: null,
  audioChunks: [],
  recognition: null,
  liveTranscript: '',
  recError: null
};

function loadPages(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ /* ignore corrupt storage */ }
  return defaultPages();
}

function savePages(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pages)); }
  catch(e){ console.warn('Could not save — storage may be full', e); }
}

function esc(s){
  const d = document.createElement('div');
  d.innerText = s || '';
  return d.innerHTML;
}

/* ---------- Procedural "AI" art ----------
   Stand-in for a real image-generation call. Swap generateArt() for a
   fetch() to your own image endpoint — see README for the wiring. */
function hashSeed(str){
  let h = 0;
  for(let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function generateArt(prompt){
  const h = hashSeed(prompt);
  const hues = [152, 28, 45, 205, 340, 265];
  const h1 = hues[h % hues.length];
  const h2 = hues[(h >> 3) % hues.length];
  const h3 = hues[(h >> 6) % hues.length];
  const cx1 = 40 + (h % 120);
  const cy1 = 100 + ((h >> 2) % 80);
  const cx2 = 180 + ((h >> 4) % 100);
  const cy2 = 40 + ((h >> 5) % 60);
  return `<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" class="ai-art">
    <rect width="300" height="200" fill="hsl(${h1},30%,84%)"/>
    <circle cx="${cx1}" cy="${cy1}" r="72" fill="hsl(${h2},35%,55%)"/>
    <circle cx="${cx2}" cy="${cy2}" r="90" fill="hsl(${h3},28%,68%)"/>
    <rect x="0" y="152" width="300" height="48" fill="hsl(${h1},25%,30%)"/>
  </svg>`;
}

/* ---------- Rendering ---------- */
function render(){
  const app = document.getElementById('app');

  if(state.screen === 'cover'){
    app.innerHTML = `
      <div class="device">
        <div class="cover">
          <div class="title">Evening Pages</div>
          <div class="subtitle">A JOURNAL, KEPT BY VOICE</div>
          <button class="btn-open" onclick="openBook()">Open journal</button>
        </div>
      </div>`;
    return;
  }

  const p = state.pages[state.pageIndex];
  let body = '';

  if(p.type === 'empty'){
    body = `<div class="empty-tap" onclick="openEditor('menu')">
      <span class="plus">+</span><p>Tap to start this page</p>
    </div>`;
  } else if(p.type === 'text'){
    body = `<div class="entry-text">${esc(p.text)}</div>`;
  } else if(p.type === 'photo'){
    body = `<button class="asset-btn" onclick="openEnlarge()" aria-label="Enlarge photo">
      ${p.photo ? `<img class="photo-thumb" src="${p.photo}">` : `<div class="photo-placeholder">No photo attached yet</div>`}
    </button><div class="hint">${esc(p.caption||'')}</div>`;
  } else if(p.type === 'ai'){
    body = `<button class="asset-btn" onclick="openEnlarge()" aria-label="Enlarge generated image">${generateArt(p.prompt)}</button>
      <div class="hint">AI sketch — "${esc(p.prompt)}"</div>`;
  } else if(p.type === 'voice'){
    body = `<div class="voice-block">
      <button class="play-circle" onclick="playVoice()" aria-label="Play voice memo">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <span class="voice-meta">Voice memo · ${p.duration}</span>
      ${p.transcript ? `<div class="transcript">${esc(p.transcript)}</div>` : ''}
      <audio id="voice-audio" src="${p.audio || ''}" style="display:none"></audio>
    </div>`;
  }

  app.innerHTML = `
    <div class="device">
      <div class="topbar"><span class="title">Evening Pages</span><span class="brass-dot"></span></div>
      <div class="page-frame"><div class="page">
        <div class="ribbon"></div>
        <div class="page-date">
          <span>${p.date}</span>
          <button class="icon-btn" onclick="deletePage()" title="Remove this page" aria-label="Remove page">✕</button>
        </div>
        ${body}
      </div></div>
      <div class="controls">
        <button class="nav" onclick="flip(-1)" ${state.pageIndex===0?'disabled':''} aria-label="Previous page">‹</button>
        <span class="pageno">page ${state.pageIndex+1} of ${state.pages.length}</span>
        <button class="nav" onclick="flip(1)" ${state.pageIndex===state.pages.length-1?'disabled':''} aria-label="Next page">›</button>
      </div>
      <div class="footer">
        <button class="btn-secondary" onclick="addPage()">Add page</button>
        <button class="btn-primary" onclick="togglePrint(true)">Order the print</button>
      </div>
    </div>`;

  if(state.editor) renderEditor();
  if(state.enlarge) renderEnlarge();
  if(state.print) renderPrint();
}

function renderEditor(){
  const mode = state.editor;
  let inner = '';

  if(mode === 'menu'){
    inner = `
      <div class="sheet-close"><button onclick="closeEditor()" aria-label="Close">✕</button></div>
      <div class="sheet-title">Fill this page</div>
      <div class="opt-list">
        <div class="opt" onclick="openEditor('voice')"><span class="ic">●</span>Record a voice memo</div>
        <div class="opt" onclick="openEditor('text')"><span class="ic">✎</span>Write it out</div>
        <div class="opt" onclick="document.getElementById('photo-input').click()"><span class="ic">▣</span>Add a photo</div>
        <div class="opt" onclick="openEditor('ai')"><span class="ic">✦</span>Describe a scene</div>
      </div>`;
  } else if(mode === 'text'){
    inner = `
      <div class="sheet-close"><button onclick="closeEditor()" aria-label="Close">✕</button></div>
      <textarea class="field" id="text-input" placeholder="What happened today?"></textarea>
      <div class="savebar">
        <button class="btn-secondary" onclick="closeEditor()">Cancel</button>
        <button class="btn-primary" onclick="saveText()">Save to page</button>
      </div>`;
  } else if(mode === 'ai'){
    inner = `
      <div class="sheet-close"><button onclick="closeEditor()" aria-label="Close">✕</button></div>
      <textarea class="field short" id="ai-input" placeholder="a quiet lighthouse at dusk..."></textarea>
      <div class="savebar">
        <button class="btn-secondary" onclick="closeEditor()">Cancel</button>
        <button class="btn-primary" onclick="saveAi()">Generate</button>
      </div>`;
  } else if(mode === 'voice'){
    const bars = Array.from({length:18}, (_,i) => {
      const h = state.recording ? (10 + ((i*37 + state.recSeconds*13) % 38)) : 6;
      return `<div class="wave-bar" style="height:${h}px;"></div>`;
    }).join('');
    inner = `
      <div class="sheet-close"><button onclick="closeEditor()" aria-label="Close">✕</button></div>
      <div class="rec-status">${state.recording ? 'Recording' : 'Ready to record'}</div>
      <div class="waveform">${bars}</div>
      <div class="rec-timer">0:${String(state.recSeconds).padStart(2,'0')}</div>
      ${state.liveTranscript ? `<div class="transcript">${esc(state.liveTranscript)}</div>` : ''}
      ${state.recError ? `<div class="error-msg">${esc(state.recError)}</div>` : ''}
      <div class="savebar">
        ${state.recording
          ? `<button class="btn-primary" onclick="stopRecording()">Stop and save</button>`
          : `<button class="btn-primary" onclick="startRecording()">Start recording</button>`}
      </div>`;
  }

  document.getElementById('app').insertAdjacentHTML('beforeend', `<div class="modal"><div class="sheet">${inner}</div></div>`);
}

function renderEnlarge(){
  const p = state.pages[state.pageIndex];
  let inner = `<div class="sheet-close"><button onclick="closeEnlarge()" aria-label="Close">✕</button></div>`;
  if(p.type === 'photo'){
    inner += p.photo
      ? `<img class="enlarge-photo" src="${p.photo}">`
      : `<div class="photo-placeholder">No photo attached yet</div>`;
  } else if(p.type === 'ai'){
    inner += generateArt(p.prompt) + `<div class="hint">"${esc(p.prompt)}"</div>`;
  }
  document.getElementById('app').insertAdjacentHTML('beforeend', `<div class="modal"><div class="sheet">${inner}</div></div>`);
}

function renderPrint(){
  const inner = `
    <div class="sheet-close"><button onclick="togglePrint(false)" aria-label="Close">✕</button></div>
    <div class="sheet-title">Order the printed journal</div>
    <div class="hint">Your ${state.pages.length} pages, bound as a real book.</div>
    <div class="tier"><span>Softcover</span><span class="price">$24</span></div>
    <div class="tier featured"><span>Hardcover<span class="badge">Most chosen</span></span><span class="price">$42</span></div>
    <div class="tier"><span>Leather-bound</span><span class="price">$68</span></div>
    <div class="savebar"><button class="btn-primary" style="width:100%" onclick="alert('This is a demo — wire this button up to your print-fulfillment API.')">Start my order</button></div>`;
  document.getElementById('app').insertAdjacentHTML('beforeend', `<div class="modal"><div class="sheet">${inner}</div></div>`);
}

/* ---------- Actions ---------- */
function openBook(){ state.screen = 'book'; render(); }
function flip(d){
  state.pageIndex = Math.max(0, Math.min(state.pages.length-1, state.pageIndex+d));
  render();
}
function addPage(){
  state.pages.push({ type:'empty', date: new Date().toLocaleDateString(undefined,{month:'short', day:'numeric'}) });
  state.pageIndex = state.pages.length - 1;
  savePages();
  render();
}
function deletePage(){
  if(state.pages.length <= 1) return;
  state.pages.splice(state.pageIndex, 1);
  state.pageIndex = Math.max(0, state.pageIndex - 1);
  savePages();
  render();
}

function openEditor(mode){ state.editor = mode; state.recError = null; render(); }
function closeEditor(){
  stopRecordingInternals();
  state.editor = null;
  state.recording = false;
  state.recSeconds = 0;
  state.liveTranscript = '';
  state.recError = null;
  render();
}

function saveText(){
  const v = document.getElementById('text-input').value.trim();
  if(v){
    const d = state.pages[state.pageIndex].date;
    state.pages[state.pageIndex] = { type:'text', date:d, text:v };
    savePages();
  }
  state.editor = null;
  render();
}

function saveAi(){
  const v = document.getElementById('ai-input').value.trim();
  if(v){
    const d = state.pages[state.pageIndex].date;
    state.pages[state.pageIndex] = { type:'ai', date:d, prompt:v };
    savePages();
  }
  state.editor = null;
  render();
}

document.addEventListener('change', (e) => {
  if(e.target && e.target.id === 'photo-input'){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const d = state.pages[state.pageIndex].date;
      state.pages[state.pageIndex] = { type:'photo', date:d, photo:reader.result, caption:'Added just now' };
      savePages();
      state.editor = null;
      render();
    };
    reader.readAsDataURL(file);
  }
});

/* ---------- Real voice recording + live transcription ---------- */
async function startRecording(){
  state.recError = null;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable = (e) => { if(e.data.size > 0) state.audioChunks.push(e.data); };
    state.mediaRecorder.start();

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(SR){
      state.recognition = new SR();
      state.recognition.continuous = true;
      state.recognition.interimResults = true;
      state.recognition.onresult = (e) => {
        let finalText = '';
        for(let i=0;i<e.results.length;i++) finalText += e.results[i][0].transcript;
        state.liveTranscript = finalText;
        render();
      };
      state.recognition.onerror = () => {};
      state.recognition.start();
    }

    state.recording = true;
    state.recSeconds = 0;
    state.recTimer = setInterval(() => { state.recSeconds++; render(); }, 1000);
    render();
  }catch(err){
    state.recError = 'Microphone access was denied or unavailable. Check your browser permissions.';
    render();
  }
}

function stopRecording(){
  if(!state.mediaRecorder) return;
  const secs = state.recSeconds;
  const transcript = state.liveTranscript;

  state.mediaRecorder.onstop = () => {
    const blob = new Blob(state.audioChunks, { type:'audio/webm' });
    const reader = new FileReader();
    reader.onload = () => {
      const d = state.pages[state.pageIndex].date;
      state.pages[state.pageIndex] = {
        type:'voice', date:d,
        duration: `0:${String(secs).padStart(2,'0')}`,
        audio: reader.result,
        transcript
      };
      savePages();
      stopRecordingInternals();
      state.editor = null;
      state.recording = false;
      state.recSeconds = 0;
      state.liveTranscript = '';
      render();
    };
    reader.readAsDataURL(blob);
  };
  state.mediaRecorder.stop();
  if(state.recognition) state.recognition.stop();
  if(state.recTimer){ clearInterval(state.recTimer); state.recTimer = null; }
}

function stopRecordingInternals(){
  if(state.recTimer){ clearInterval(state.recTimer); state.recTimer = null; }
  if(state.mediaRecorder && state.mediaRecorder.state !== 'inactive'){
    try{ state.mediaRecorder.stop(); }catch(e){}
  }
  if(state.recognition){ try{ state.recognition.stop(); }catch(e){} }
}

function playVoice(){
  const el = document.getElementById('voice-audio');
  if(el && el.src) el.play();
}

/* ---------- Enlarge / print modals ---------- */
function openEnlarge(){ state.enlarge = true; render(); }
function closeEnlarge(){ state.enlarge = false; render(); }
function togglePrint(v){ state.print = v; render(); }

/* ---------- Boot ---------- */
render();
