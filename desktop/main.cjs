const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, session, protocol, net, shell, screen, desktopCapturer, systemPreferences, safeStorage, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { workspaceURL, sameOrigin, externalURL, restoredWorkspace, normalizeMoments } = require('./security.cjs');
const {ReplaySync,atomicJSON,fingerprint}=require('./replay-sync.cjs');
const {ReplayControl}=require('./replay-control.cjs');
const {defaultLeagueId,leagueId:checkedLeagueId,recordingScope,selectRecordingLeague,lockRecordingLeague,desktopEndpoint}=require('./recording-scope.cjs');
const {CompanionNotices}=require('./companion-notices.cjs');
let notices,noticeFailure='',localReplayPlaying=false;
let control,controlFailure='',replayPresence={positionMs:0,paused:true},pendingReplayCommand;
function stopControl(reason=''){control?.stop(reason);}
function publishControl(value){
 if(replay&&!replay.webContents.isDestroyed())replay.webContents.send('desktop:control-state',value);
 publish();
}
function controlPresence(){return {...replayPresence,foreground:!!win&&!win.isDestroyed()&&win.isFocused()&&!win.isMinimized()&&active==='replay'};}
function executeReplay(command){return new Promise((resolve,reject)=>{
 const record=saved.recordings.find(r=>r.id===currentRecording),stat=record&&fs.statSync(record.path);
 if(!record||stat.size!==record.size||stat.mtimeMs!==record.modified||record.changed!=null&&stat.ctimeMs!==record.changed||!controlPresence().foreground)throw Error('Recording or foreground changed.');
 const timer=setTimeout(()=>{pendingReplayCommand=null;reject(Error('Replay acknowledgement timed out'));},5000);
 pendingReplayCommand={id:command.id,resolve:value=>{clearTimeout(timer);pendingReplayCommand=null;resolve(value);}};
 replay.webContents.send('desktop:replay-command',command);
});}

app.setName('Softmax IDE');
const appIcon = path.join(__dirname, 'build', 'icon.png');
/** User data moved from the prototype folder to "Softmax IDE". A first launch
 * after the rename carries the old folder over once; nothing is deleted. */
const dataDir = process.env.SOFTMAX_DESKTOP_DATA || path.join(app.getPath('appData'), 'Softmax IDE');
if (!process.env.SOFTMAX_DESKTOP_DATA) {
  const legacyDir = path.join(app.getPath('appData'), 'Softmax Prototype');
  try { if (!fs.existsSync(dataDir) && fs.existsSync(legacyDir)) fs.renameSync(legacyDir, dataDir); } catch {}
}
app.setPath('userData', dataDir);
protocol.registerSchemesAsPrivileged([
  { scheme: 'softmax-desktop', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'softmax-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let initial;
/** Packaged builds talk to the hosted Vercel server; development keeps the
 * local harness default. SOFTMAX_DESKTOP_URL overrides either. */
const HOSTED_ORIGIN = 'https://student-harness-seven.vercel.app';
try { initial = workspaceURL(process.env.SOFTMAX_DESKTOP_URL || (app.isPackaged ? HOSTED_ORIGIN : undefined)); }
catch (error) { console.error(error.message); app.exit(1); }
const profile = createHash('sha256').update(initial?.origin || '').digest('hex').slice(0, 16);
const stateFile = path.join(app.getPath('userData'), `workspace-${profile}.json`);
const credentialFile=path.join(app.getPath('userData'),`device-${profile}.json`);
let sync,credentialCache,syncFailure='';
function requireSync(){if(!sync)throw Error(syncFailure||'Replay sync is unavailable.');return sync;}
async function saveCredentials(value){
  if(!await safeStorage.isAsyncEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error('Secure credential storage is unavailable. Local notes still work.');
  const encrypted=await safeStorage.encryptStringAsync(JSON.stringify(value));
  atomicJSON(credentialFile,{encrypted:encrypted.toString('base64')});credentialCache=value;
}
async function credentials(){
  if(credentialCache)return credentialCache;
  let stored;try{stored=JSON.parse(fs.readFileSync(credentialFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('Device pairing could not be read.');}
  const decoded=await safeStorage.decryptStringAsync(Buffer.from(stored.encrypted,'base64'));
  const value=JSON.parse(decoded.result);
  if(!/^[a-f0-9]{64}$/.test(value.secret)||typeof value.studentId!=='string'||!/^[a-f0-9-]{36}$/.test(value.deviceId))throw Error('Device pairing is invalid.');
  credentialCache=value;if(decoded.shouldReEncrypt)await saveCredentials(value);return value;
}
async function desktopRequest(endpoint,body,secret){
  if(endpoint==='/api/leagues'){if(body||secret)throw Error('Catalog access is read-only.');}else endpoint=desktopEndpoint(endpoint);
  const response=await session.fromPartition(`persist:workspace-${profile}`).fetch(new URL(endpoint,initial.origin).href,{
    method:body?'POST':'GET',credentials:'include',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{Origin:initial.origin,...body?{'Content-Type':'application/json'}:{},...secret?{'x-softmax-device-key':secret}:{}},
    ...body?{body:JSON.stringify(body)}:{},
  });
  const value=await response.json();
  if(!response.ok&&!(response.status===409&&value.code==='conflict'))throw Object.assign(Error(response.status===401?'Sign in to the workspace first.':value.error||`Sync unavailable (${response.status})`),{status:response.status});
  return value;
}
function publishSync(){if(replay&&!replay.webContents.isDestroyed())replay.webContents.send('desktop:sync-state',sync?.status());}
let saved = {};
try { saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* First launch or invalid state. */ }
if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
saved.recordings = (Array.isArray(saved.recordings) ? saved.recordings : []).filter(r =>
  r && typeof r.id === 'string' && /^[a-f0-9-]{36}$/.test(r.id) && typeof r.path === 'string' && typeof r.name === 'string'
).slice(0, 12).map(r => { try { return { ...r, moments: normalizeMoments(r.moments || []) }; } catch { return { ...r, moments: [] }; } });

let win, workspace, replay, picker, pendingCapture;
let active = 'workspace';
let status = 'loading';
let failure = '';
let loaded = false;
let currentRecording = null;
let mediaGrants = new Set();
const headerHeight = 44;
const shellURL = 'softmax-desktop://app/shell.html';
const replayURL = 'softmax-desktop://app/replay.html';
const pickerURL = 'softmax-desktop://app/picker.html';
const files = new Set(['shell.html', 'shell.js', 'styles.css', 'replay.html', 'replay.js', 'replay-transport.mjs', 'picker.html', 'picker.js']);
const preload = path.join(__dirname, 'preload.cjs');

function persist() {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(saved), { mode: 0o600 });
    fs.renameSync(`${stateFile}.tmp`, stateFile);
    return true;
  } catch (error) { console.error('Could not save desktop state:', error.message); return false; }
}

function uiState() {
  return {
    active, status, failure, origin: initial.origin,
    platform: process.platform,
    canGoBack: !!workspace && !workspace.webContents.isDestroyed() && workspace.webContents.navigationHistory.canGoBack(),
    recordings: saved.recordings.map(({ id, name }) => ({ id, name })),
    recording: currentRecording,
    replayControl:control?.state()??null,
    notices:notices?.status()??{enabled:false,unread:0,error:noticeFailure},
  };
}
function publish() {
  if (win && !win.isDestroyed()) win.webContents.send('desktop:state', uiState());
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  for (const view of [workspace, replay]) view?.setBounds({ x: 0, y: headerHeight, width, height: Math.max(0, height - headerHeight) });
  workspace?.setVisible(active === 'workspace' && loaded && status !== 'error');
  replay?.setVisible(active === 'replay');
}
function activate(target) {
  if (target === 'replay' && !currentRecording) return;
  if (target !== 'replay' && replay && !replay.webContents.isDestroyed()) replay.webContents.send('desktop:pause');
  active = target;
  layout(); publish();
}
function localSender(event, role) {
  const target = role === 'shell' ? win?.webContents : role === 'replay' ? replay?.webContents : picker?.webContents;
  const url = role === 'shell' ? shellURL : role === 'replay' ? replayURL : pickerURL;
  return target && !target.isDestroyed() && event.sender === target && event.senderFrame === target.mainFrame && event.senderFrame.url === url;
}
function handle(channel, role, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!localSender(event, role)) throw new Error('This action is not available to this page.');
    return handler(...args);
  });
}
async function openExternal(url) {
  if (!externalURL(url)) return;
  // External navigation is a user action and never inherits the desktop bridge.
  const { response } = await dialog.showMessageBox(win, { type: 'question', message: 'Open this link in your browser?', detail: url, buttons: ['Open browser', 'Cancel'], defaultId: 0, cancelId: 1 });
  if (response === 0) await shell.openExternal(url);
}
function restrictNavigation(contents, allowed, external = false) {
  contents.on('before-input-event',(_event,input)=>{if(input.key==='Escape')stopControl('Stopped on this device.');});
  contents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    if (external) void openExternal(url);
  });
  contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    if (external) {
      if (sameOrigin(url, initial.origin)) void contents.loadURL(url).catch(() => {});
      else void openExternal(url);
    }
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', event => event.preventDefault());
}

function validWorkspace(contents, url, isMainFrame) {
  return contents === workspace?.webContents && !contents.isDestroyed() && sameOrigin(contents.getURL(), initial.origin) && sameOrigin(url, initial.origin) && isMainFrame === true;
}
function setupPermissions(ses) {
  const safeFramePermissions = new Set(['fullscreen', 'pointerLock']);
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (contents !== workspace?.webContents || !sameOrigin(contents.getURL(), initial.origin) || !sameOrigin(origin, initial.origin)) return false;
    if (safeFramePermissions.has(permission)) return true;
    if (!details.isMainFrame) return false;
    if (permission === 'display-capture') return true; // The source picker still requires an explicit choice.
    if (permission === 'media') return mediaGrants.has(details.mediaType);
    return false;
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (safeFramePermissions.has(permission) && contents === workspace?.webContents && sameOrigin(details.requestingUrl, initial.origin)) { callback(true); return; }
    if (!validWorkspace(contents, details.requestingUrl, details.isMainFrame)) { callback(false); return; }
    if (permission === 'display-capture') { callback(true); return; }
    if (permission !== 'media') { callback(false); return; }
    const types = details.mediaTypes || [];
    // Chromium first gates display capture as a media request with no device types.
    // The display-media handler below still requires the user to select a source.
    if (!types.length) { callback(true); return; }
    if (types.some(type => !['audio', 'video'].includes(type))) { callback(false); return; }
    const requestedURL = contents.getURL();
    void (async () => {
      const missing = types.filter(type => !mediaGrants.has(type));
      if (missing.length) {
        const names = missing.map(type => type === 'audio' ? 'microphone' : 'camera').join(' and ');
        const { response } = await dialog.showMessageBox(win, { type: 'question', message: `Allow the workspace to use your ${names}?`, detail: initial.origin, buttons: ['Allow', 'Cancel'], defaultId: 0, cancelId: 1 });
        if (response !== 0) return false;
        if (process.platform === 'darwin') {
          for (const type of missing) if (!await systemPreferences.askForMediaAccess(type === 'audio' ? 'microphone' : 'camera')) return false;
        }
      }
      if (contents.isDestroyed() || contents.getURL() !== requestedURL) return false;
      types.forEach(type => mediaGrants.add(type));
      return true;
    })().then(callback, () => callback(false));
  });
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const frame = request.frame;
    if (!frame || frame !== workspace?.webContents.mainFrame || !sameOrigin(request.securityOrigin, initial.origin) || !request.userGesture || pendingCapture) { callback(null); return; }
    const originalURL = frame.url;
    pendingCapture = { request, callback, originalURL, sources: new Map(), timer: setTimeout(() => finishCapture(null), 60_000) };
    picker = new BrowserWindow({ parent: win, modal: true, width: 640, height: 470, resizable: false, title: 'Share with Preston', show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    restrictNavigation(picker.webContents, url => url === pickerURL);
    picker.once('ready-to-show', () => picker?.show());
    picker.on('closed', () => { picker = null; finishCapture(null); });
    void picker.loadURL(pickerURL);
  });
}
function finishCapture(source) {
  const pending = pendingCapture;
  if (!pending) return;
  pendingCapture = null;
  clearTimeout(pending.timer);
  const frame = pending.request.frame;
  try {
    if (!frame || frame.detached || frame.url !== pending.originalURL) pending.callback(null);
    else pending.callback(source ? { video: source } : null);
  } catch { /* The requesting page may have closed. */ }
  if (picker && !picker.isDestroyed()) picker.close();
}

async function openRecording(file) {
  stopControl('Recording changed.');
  const stat = fs.statSync(file);
  if (!stat.isFile() || !/\.(mp4|webm|mov|m4v)$/i.test(file)) throw new Error('Choose an MP4, WebM, MOV, or M4V recording.');
  const found = saved.recordings.find(record => record.path === file);
  if (found && found.id === currentRecording && found.size === stat.size && found.modified === stat.mtimeMs && (found.changed==null||found.changed===stat.ctimeMs)) { activate('replay'); return; }
  const record = found || { id: randomUUID(), path: file, name: path.basename(file), moments: [], size: stat.size, modified: stat.mtimeMs, changed:stat.ctimeMs };
  // A replaced file is a new recording: do not attach old coaching notes to it.
  if (record.size !== stat.size || record.modified !== stat.mtimeMs || record.changed!=null&&record.changed!==stat.ctimeMs) Object.assign(record, { id: randomUUID(), moments: [], size: stat.size, modified: stat.mtimeMs, changed:stat.ctimeMs, fingerprint:null,leagueId:null,leagueLocked:false });
  saved.recordings = [record, ...saved.recordings.filter(item => item.path !== file)].slice(0, 12);
  currentRecording = record.id;
  persist();
  if (!replay) {
    replay = new WebContentsView({ webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.contentView.addChildView(replay);
    restrictNavigation(replay.webContents, url => url === replayURL);
  }
  await replay.webContents.loadURL(replayURL);
  activate('replay');
}
async function chooseRecording() {
  const result = await dialog.showOpenDialog(win, { title: 'Open a recording', properties: ['openFile'], filters: [{ name: 'Game recordings', extensions: ['mp4', 'webm', 'mov', 'm4v'] }] });
  if (!result.canceled && result.filePaths[0]) await openRecording(result.filePaths[0]);
}
async function exportFrame() {
  const target = active === 'replay' ? replay : workspace;
  if (!target || target.webContents.isDestroyed() || (active === 'workspace' && !loaded)) return;
  const image = await target.webContents.capturePage();
  const result = await dialog.showSaveDialog(win, { title: 'Save workspace image', defaultPath: `softmax-${Date.now()}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (!result.canceled && result.filePath) await fs.promises.writeFile(result.filePath, image.toPNG());
}
function report(error) { if (win && !win.isDestroyed()) void dialog.showMessageBox(win, { type: 'error', message: error.message || 'The desktop action could not finish.' }); }

function createWindow() {
  loaded = false; status = 'loading'; active = 'workspace'; currentRecording = null; mediaGrants = new Set();
  const bounds = saved.bounds;
  const usable = bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && bounds.width >= 800 && bounds.height >= 560 && screen.getAllDisplays().some(({ workArea: a }) => bounds.x < a.x + a.width - 100 && bounds.x + bounds.width > a.x + 100 && bounds.y < a.y + a.height - 100 && bounds.y + bounds.height > a.y + 100);
  win = new BrowserWindow({ width: 1440, height: 960, ...(usable ? bounds : {}), minWidth: 800, minHeight: 560, show: false, backgroundColor: '#fafaf8', title: 'Softmax IDE', icon: appIcon, ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 15 } } : {}), webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) app.dock.setIcon(appIcon);
  restrictNavigation(win.webContents, url => url === shellURL);
  const ses = session.fromPartition(`persist:workspace-${profile}`);
  workspace = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  workspace.setBackgroundColor('#ffffff');
  win.contentView.addChildView(workspace);
  setupPermissions(ses);
  restrictNavigation(workspace.webContents, url => sameOrigin(url, initial.origin), true);
  const wc = workspace.webContents;
  wc.on('did-start-loading', () => { status = 'loading'; failure = ''; publish(); });
  wc.on('did-finish-load', () => {
    // Chromium also finishes loading its internal error document after did-fail-load.
    if (status === 'error') return;
    loaded = true; status = 'ready'; layout(); publish();
  });
  wc.on('did-stop-loading', () => { if (loaded && status === 'loading') { status = 'ready'; publish(); } });
  wc.on('did-fail-load', (_event, code, description, _url, main) => {
    if (!main || code === -3) return;
    status = 'error'; failure = description; loaded = false; layout(); publish();
  });
  wc.on('render-process-gone', () => { status = 'error'; failure = 'The workspace renderer stopped. Reload to reconnect.'; loaded = false; layout(); publish(); });
  const navigated = () => {
    saved.url = restoredWorkspace(wc.getURL(), initial);
    persist(); publish();
  };
  wc.on('did-navigate', navigated); wc.on('did-navigate-in-page', navigated);
  wc.on('did-start-navigation', (_event, _url, inPlace, isMain) => { if (isMain && !inPlace) finishCapture(null); });
  win.on('resize', layout);
  win.on('minimize', () => {if(pendingReplayCommand)stopControl('Replay window minimized during a command.');replay?.webContents.send('desktop:pause');});
  // On macOS a WebContents can retain DOM focus after its native window blurs.
  // Revoke in-flight authority here as well as in the renderer.
  win.on('blur',()=>{if(pendingReplayCommand)stopControl('Replay window lost focus during a command.');});
  win.on('close', () => {
    stopControl('Window closed.');replayPresence.paused=true;localReplayPlaying=false;
    saved.bounds = win.getNormalBounds(); persist(); finishCapture(null);
    for (const view of [workspace, replay]) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    workspace = replay = null;
  });
  win.on('closed', () => { win = null; });
  win.once('ready-to-show', () => { win.show(); layout(); });
  void win.loadURL(shellURL);
  void wc.loadURL(restoredWorkspace(saved.url, initial)).catch(() => {});
  layout();
}

/** A fresh workspace for the current game: the league route with no request
 * selected. Without a known league it opens the game chooser. Earlier
 * workspaces stay reachable through the app's own History control. */
async function newWorkspace() {
  if (!workspace) return;
  activate('workspace');
  let league = null;
  try { league = new URL(restoredWorkspace(workspace.webContents.getURL(), initial)).searchParams.get('league'); } catch {}
  const target = new URL('/', initial.origin);
  if (league) target.searchParams.set('league', league);
  await workspace.webContents.loadURL(target.href);
}

async function openUpdates(destination){
 if(!win||win.isDestroyed())createWindow();
 if(win.isMinimized())win.restore();win.show();win.focus();activate('workspace');
 const id=destination?.kind==='finding'&&typeof destination.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(destination.id)?destination.id:null;
 await workspace.webContents.loadURL(new URL(id?`/updates/${id}`:'/updates',initial.origin).href);
}
handle('desktop:state', 'shell', uiState);
handle('desktop:action', 'shell', async (action, id) => {
  if (action === 'stop-control') stopControl('Stopped on this device.');
  else if (action === 'updates') await openUpdates();
  else if (action === 'notifications') {
    if(!notices)throw Error(noticeFailure||'Notifications unavailable');
    if(notices.status().enabled)notices.disable();
    else {if(!Notification.isSupported())throw Error('Native notifications are not supported on this device.');await notices.enable();}
  }
  else if (action === 'workspace') activate('workspace');
  else if (action === 'reload') { activate('workspace'); await workspace.webContents.loadURL(restoredWorkspace(saved.url, initial)); }
  else if (action === 'back' && workspace.webContents.navigationHistory.canGoBack()) workspace.webContents.navigationHistory.goBack();
  else if (action === 'open') await chooseRecording();
  else if (action === 'new') await newWorkspace();
  else if (action === 'recording') {
    const record = saved.recordings.find(item => item.id === id);
    if (record) await openRecording(record.path);
  } else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (action === 'snapshot') await exportFrame();
  return uiState();
});
handle('desktop:control-state','replay',()=>control?.state()??{grant:null,error:controlFailure});
handle('desktop:clear-frames','replay',async()=>{
 stopControl('Frame sharing stopped.');
 const credential=await credentials();if(!credential)throw Error('Connect this device first.');
 return desktopRequest('/api/desktop/control',{deviceId:credential.deviceId,input:{action:'clear_frames'}},credential.secret);
});
handle('desktop:control-stop','replay',()=>stopControl('Stopped on this device.'));
handle('desktop:playback-paused','replay',paused=>{
 if(typeof paused!=='boolean')throw Error('Invalid playback state');localReplayPlaying=!paused;
});
handle('desktop:control-presence','replay',value=>{
 if(!Number.isSafeInteger(value?.positionMs)||value.positionMs<0||value.positionMs>604800000||typeof value.paused!=='boolean')throw Error('Invalid replay state');
 replayPresence={positionMs:value.positionMs,paused:value.paused};
});
handle('desktop:control-start','replay',async(id,durationMs,allowFrames=false,leagueId)=>{
 if(!control)throw Error(controlFailure||'Replay control unavailable');
 if(id!==currentRecording)throw Error('Recording changed.');
 const record=saved.recordings.find(r=>r.id===id),epoch=control.epoch;
 Object.assign(record,lockRecordingLeague(record,sync?.state,leagueId));if(!persist())throw Error('Could not save the recording league.');
 const f=await fingerprint(record.path);
 if(id!==currentRecording||epoch!==control.epoch||f.sizeBytes!==record.size||f.modified!==record.modified||record.changed!=null&&f.changed!==record.changed)throw Error('Recording changed; reopen it.');
 return control.start({sha256:f.sha256,name:record.name,sizeBytes:f.sizeBytes},durationMs,allowFrames===true,record.leagueId);
});
handle('desktop:control-result','replay',(id,value)=>{
 if(!pendingReplayCommand||pendingReplayCommand.id!==id)return;
 if(!value||!['completed','rejected','unknown'].includes(value.status))throw Error('Invalid command receipt');
 pendingReplayCommand.resolve(value);
});
handle('desktop:recording', 'replay', () => {
  const record = saved.recordings.find(item => item.id === currentRecording);
  return record ? { id: record.id, name: record.name, url: `softmax-desktop://app/media/${record.id}`, moments: record.moments,...recordingScope(record,sync?.state) } : null;
});
handle('desktop:sync-state','replay',async()=>({...(requireSync().status()),studentId:(await credentials())?.studentId??null}));
handle('desktop:sync-options','replay',leagueId=>requireSync().options(leagueId==null?undefined:checkedLeagueId(leagueId)));
handle('desktop:league-catalog','replay',()=>desktopRequest('/api/leagues'));
handle('desktop:recording-league','replay',async(id,leagueId)=>{
 if(id!==currentRecording)throw Error('Recording changed.');const record=saved.recordings.find(r=>r.id===id);
 const scope=selectRecordingLeague(record,sync?.state,leagueId);
 const catalog=await desktopRequest('/api/leagues');
 if(id!==currentRecording||!Array.isArray(catalog.leagues)||!catalog.leagues.some(l=>l.id===scope.leagueId))throw Error('Choose an available league from this account’s catalog.');
 const checked=selectRecordingLeague(record,sync?.state,leagueId);Object.assign(record,checked);if(!persist())throw Error('Could not save the recording league.');return checked;
});
handle('desktop:sync-pair','replay',()=>{stopControl('Pairing changed.');return requireSync().pair('Softmax desktop');});
handle('desktop:sync-retry','replay',()=>requireSync().flush({retry:true}));
handle('desktop:sync-import','replay',async(id,leagueId)=>{
  if(id!==currentRecording)throw Error('The recording has changed.');
  const record=saved.recordings.find(r=>r.id===id);Object.assign(record,lockRecordingLeague(record,sync?.state,leagueId));if(!persist())throw Error('Could not save the recording league.');const fingerprinted=await fingerprint(record.path);
  if(record.size!==fingerprinted.sizeBytes||record.modified!==fingerprinted.modified||record.changed!=null&&record.changed!==fingerprinted.changed)throw Error('Reopen the changed recording first.');
  const credential=await credentials(),account=await requireSync().options(record.leagueId);
  if(!credential||credential.studentId!==account.studentId||account.leagueId!==record.leagueId)throw Error('Connect this device to the current account and league first.');
  const shared=await desktopRequest(`/api/desktop/moments?sha256=${fingerprinted.sha256}&leagueId=${encodeURIComponent(record.leagueId)}`);
  if(id!==currentRecording||!Array.isArray(shared.moments)||shared.moments.some(m=>m.league_id!==record.leagueId||m.student_id!==credential.studentId||m.recording_hash!==fingerprinted.sha256))throw Error('Shared notes do not match this recording, account and league.');
  let imported=0;
  for(const moment of shared.moments){
    if(moment.withdrawn_at||record.moments.some(m=>m.id===moment.id))continue;
    if(record.moments.length>=500)throw Error('This recording already has 500 local notes.');
    const input={action:'upsert',leagueId:record.leagueId,momentId:moment.id,baseRevision:moment.revision-1,recording:{sha256:fingerprinted.sha256,sizeBytes:fingerprinted.sizeBytes,name:record.name},
      positionMs:moment.position_ms,durationMs:moment.duration_ms,note:moment.note,observedAt:moment.observed_at,policyVersionId:moment.policy_version_id,episodeId:moment.episode_id,cycleId:moment.cycle_id};
    requireSync().commit(state=>{state.known[`${credential.studentId}:${moment.id}`]={revision:moment.revision,input,eventId:moment.event_id};});
    record.moments.push({id:moment.id,time:moment.position_ms/1000,note:moment.note});imported++;
  }
  record.fingerprint=fingerprinted;if(!persist())throw Error('Could not save imported notes.');
  return {moments:record.moments,imported,...recordingScope(record,sync?.state)};
});
handle('desktop:open-moment','replay',async(momentId,leagueId)=>{
  if(!/^[a-f0-9-]{36}$/.test(momentId))throw Error('Invalid moment');
  const record=saved.recordings.find(r=>r.id===currentRecording);if(!record?.moments.some(m=>m.id===momentId)||recordingScope(record,sync?.state).leagueId!==checkedLeagueId(leagueId))throw Error('Moment does not match this recording league.');
  await workspace.webContents.loadURL(new URL(`/moments/${momentId}?leagueId=${encodeURIComponent(leagueId)}`,initial.origin).href);activate('workspace');
});
handle('desktop:sync-revoke','replay',async()=>{
  stopControl('Device disconnected.');
  const credential=await credentials();if(!credential)return;
  const result=await desktopRequest('/api/desktop/devices',{action:'revoke',deviceId:credential.deviceId});
  sync.error='Device disconnected. Pending notes stay local until you connect again.';publishSync();return result;
});
handle('desktop:share-moment','replay',async(id,momentId,options={})=>{
  if(id!==currentRecording)throw Error('The recording has changed.');
  const record=saved.recordings.find(r=>r.id===id),moment=record?.moments.find(m=>m.id===momentId);
  if(!moment||options.action==='upsert'&&!moment.note.trim())throw Error('Write an observation before sharing.');
  if(!['upsert','withdraw'].includes(options.action)||!Number.isSafeInteger(options.durationMs)||options.durationMs<=0||options.durationMs>604800000||Math.round(moment.time*1000)>options.durationMs)throw Error('Recording timing is unavailable.');
  if(options.policyVersionId!=null&&!/^[a-f0-9-]{36}$/.test(options.policyVersionId))throw Error('Choose a saved policy version.');
  Object.assign(record,lockRecordingLeague(record,sync?.state,options.leagueId));if(!persist())throw Error('Could not save the recording league.');
  if(record.leagueId!==defaultLeagueId&&options.policyVersionId!=null)throw Error('This league does not support a BASIC policy association.');
  const stat=await fs.promises.stat(record.path);
  if(!record.fingerprint||record.fingerprint.sizeBytes!==stat.size||record.fingerprint.modified!==stat.mtimeMs||record.fingerprint.changed!==stat.ctimeMs){
    if(record.size!==stat.size||record.modified!==stat.mtimeMs||record.changed!=null&&record.changed!==stat.ctimeMs)throw Error('Recording changed; reopen it before sharing.');
    record.fingerprint=await fingerprint(record.path);if(!persist())throw Error('Could not save the recording fingerprint.');
  }
  const {sha256,sizeBytes}=record.fingerprint;
  const credential=await credentials();
  const known=credential?requireSync().state.known[`${credential.studentId}:${momentId}`]:null;
  const policyVersionId=options.policyVersionId===undefined?known?.input?.policyVersionId??null:options.policyVersionId;
  return requireSync().queue({action:options.action,leagueId:record.leagueId,momentId:moment.id,recording:{sha256,sizeBytes,name:record.name},
    positionMs:Math.round(moment.time*1000),durationMs:options.durationMs,note:moment.note,
    observedAt:new Date().toISOString(),policyVersionId:record.leagueId===defaultLeagueId?policyVersionId:null,episodeId:known?.input?.episodeId??null,cycleId:record.leagueId===defaultLeagueId?known?.input?.cycleId??null:null},{replace:options.replace===true});
});
handle('desktop:moments', 'replay', (id, moments) => {
  if (id !== currentRecording) throw new Error('The recording has changed.');
  const record = saved.recordings.find(item => item.id === id);
  record.moments = normalizeMoments(moments);
  if (!persist()) throw new Error('Could not save notes to disk.');
  return true;
});
handle('desktop:export-notes', 'replay', async () => {
  const record = saved.recordings.find(item => item.id === currentRecording);
  if (!record) return;
  const { filePath, canceled } = await dialog.showSaveDialog(win, { defaultPath: `${record.name}.notes.json`, filters: [{ name: 'Coaching notes', extensions: ['json'] }] });
  if (!canceled && filePath) await fs.promises.writeFile(filePath, JSON.stringify({ recording: record.name, moments: record.moments }, null, 2));
});
handle('desktop:capture-sources', 'picker', async () => {
  const pending = pendingCapture;
  if (!pending) return [];
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 240, height: 150 } });
  if (pending !== pendingCapture) return [];
  pending.sources = new Map(sources.map(source => [source.id, source]));
  return sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
});
handle('desktop:capture-select', 'picker', id => {
  if (id === 'workspace') finishCapture(pendingCapture?.request.frame);
  else finishCapture(pendingCapture?.sources.get(id) || null);
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    try{sync=new ReplaySync({file:path.join(app.getPath('userData'),`replay-outbox-${profile}.json`),request:desktopRequest,credentials,saveCredentials,onChange:publishSync});}
    catch(error){syncFailure=error.message;}
    try{control=new ReplayControl({file:path.join(app.getPath('userData'),`replay-control-${profile}.json`),request:desktopRequest,credentials,account:()=>requireSync().options(),presence:controlPresence,execute:executeReplay,onChange:publishControl});}
    catch(error){controlFailure=error.message;}
    try{notices=new CompanionNotices({file:path.join(app.getPath('userData'),`notices-${profile}.json`),request:desktopRequest,credentials,
      pair:()=>requireSync().pair('Softmax desktop'),playing:()=>localReplayPlaying,open:openUpdates,onChange:publish,
      show:(count,onClick,onFailure)=>{
        const notice=new Notification({title:'Preston',body:`${count} update${count===1?' is':'s are'} ready to review.`,silent:true});
        notice.on('click',()=>void onClick());notice.on('failed',onFailure);notice.show();return ()=>notice.close();
      }});}
    catch(error){noticeFailure=error.message;}
    session.fromPartition(`persist:workspace-${profile}`).cookies.on('changed',()=>notices?.invalidate());
    const noticeTimer=setInterval(()=>{if(notices)void notices.tick();},60000);noticeTimer.unref();
    if(notices)void notices.tick();
    const controlTimer=setInterval(()=>{if(control)void control.tick();},2000);controlTimer.unref();
    app.on('before-quit',()=>{stopControl('Desktop closed.');notices?.invalidate();});
    const syncTimer=setInterval(()=>{if(sync)void sync.flush();},60000);syncTimer.unref();
    protocol.handle('softmax-desktop', request => {
      const url = new URL(request.url);
      if(url.host==='app'&&url.pathname.startsWith('/media/')){
       const record=saved.recordings.find(item=>item.id===currentRecording&&item.id===url.pathname.slice(7));
       return record?net.fetch(pathToFileURL(record.path).href,{headers:request.headers}):new Response('Not found',{status:404});
      }
      const file = url.pathname.slice(1);
      if (url.host !== 'app' || !files.has(file)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, 'app', file)).href);
    });
    protocol.handle('softmax-media', request => {
      const url = new URL(request.url);
      const record = saved.recordings.find(item => item.id === currentRecording && item.id === url.pathname.slice(1));
      if (url.host !== 'recording' || !record) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(record.path).href, { headers: request.headers });
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => contents === replay?.webContents && permission === 'fullscreen' && origin === 'softmax-desktop://app');
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === replay?.webContents && permission === 'fullscreen'));
    const run = fn => () => { Promise.resolve().then(fn).catch(report); };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Softmax', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'File', submenu: [
        { label: 'New Workspace', accelerator: 'CmdOrCtrl+N', click: run(newWorkspace) },
        { label: 'Open Recording…', accelerator: 'CmdOrCtrl+O', click: run(chooseRecording) },
        { label: 'Save Workspace Image…', accelerator: 'CmdOrCtrl+Shift+S', click: run(exportFrame) },
        { type: 'separator' }, { role: 'close' },
      ] },
      { role: 'editMenu' },
      { label: 'View', submenu: [
        { label: 'Workspace', accelerator: 'CmdOrCtrl+1', click: () => activate('workspace') },
        { label: 'Recording', accelerator: 'CmdOrCtrl+2', click: () => activate('replay') },
        { label: 'Reload Workspace', accelerator: 'CmdOrCtrl+R', click: run(() => workspace?.webContents.reload()) },
        { type: 'separator' }, { role: 'togglefullscreen' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => { const wc = (active === 'replay' ? replay : workspace)?.webContents; if (wc) wc.setZoomLevel(Math.min(3, wc.getZoomLevel() + 0.5)); } },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => { const wc = (active === 'replay' ? replay : workspace)?.webContents; if (wc) wc.setZoomLevel(Math.max(-2, wc.getZoomLevel() - 0.5)); } },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => (active === 'replay' ? replay : workspace)?.webContents.setZoomLevel(0) },
        ...(!app.isPackaged ? [{ label: 'Workspace Developer Tools', accelerator: 'CmdOrCtrl+Alt+I', click: () => workspace?.webContents.openDevTools({ mode: 'detach' }) }] : []),
      ] },
      { role: 'windowMenu' },
    ]));
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
