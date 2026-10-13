const $ = id => document.getElementById(id);
let current;
function render(state) {
  current = state;
  const notice=state.notices||{};
  $('updates').textContent=`Updates${notice.unread?` · ${notice.unread>50?'50+':notice.unread}`:''}`;
  $('notifications').disabled=!!notice.enabling;
  $('notifications').setAttribute('aria-pressed',String(!!notice.enabled));
  $('notifications').textContent=notice.error?'Notify !':notice.enabled?'Notify on':'Notify';
  $('notifications').title=notice.error||notice.quiet||'Notify quietly when Preston has updates. Disabled during replay playback.';
  if(notice.error)$('connection').title=notice.error;else $('connection').removeAttribute('title');

  $('stop-control').hidden=!state.replayControl?.grant;
  document.body.classList.toggle('mac', state.platform === 'darwin');
  $('workspace').setAttribute('aria-pressed', String(state.active === 'workspace'));
  const recording = state.recordings.find(item => item.id === state.recording);
  $('recording').hidden = !recording;
  $('recording').textContent = recording?.name || 'Recording';
  $('recording').title = recording?.name || 'Recording';
  $('recording').setAttribute('aria-pressed', String(state.active === 'replay'));
  $('back').disabled = !state.canGoBack || state.active !== 'workspace';
  $('connection').textContent = state.active === 'replay' ? 'Local recording' : state.status === 'ready' ? 'Connected' : state.status === 'error' ? 'Workspace offline' : 'Connecting';
  $('origin').textContent = state.origin;
  $('heading').textContent = state.status === 'error' ? 'Your workspace is unavailable' : 'Opening your workspace';
  $('message').textContent = state.status === 'error' ? 'Start the harness server, then reconnect. You can review local recordings while it’s offline.' : 'Connecting to Preston and your hosted research.';
  $('message').title = state.failure;
  $('retry').hidden = state.status !== 'error';
  $('recent').hidden = !state.recordings.length;
  $('recent-list').replaceChildren(...state.recordings.map(record => {
    const button = document.createElement('button');
    button.className = 'recent-recording'; button.textContent = record.name;
    button.onclick = () => act('recording', record.id);
    return button;
  }));
}
async function act(action, id) {
  $('error').textContent = '';
  try { render(await window.desktop.action(action, id)); }
  catch (error) { $('error').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
}
for (const name of ['workspace', 'updates', 'notifications', 'back', 'reload', 'snapshot', 'fullscreen', 'new']) $(name).onclick = () => act(name);
$('recording').onclick = () => act('recording', current.recording);
$('stop-control').onclick=()=>act('stop-control');
$('retry').onclick = () => act('reload');
$('offline-open').onclick = () => act('open');
window.desktop.onState(render);
window.desktop.state().then(render);
