// ScreenLink — vários espectadores e transferência da transmissão na mesma sala.
// Configure as credenciais públicas do Supabase abaixo.
// NUNCA coloque uma chave service_role ou sb_secret no frontend.
const SUPABASE_URL = "https://otipqykhxpqkwbspbnme.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hnibWDwIpz_gSsXsQTi8Pg_CaVxDXV_";

// Identificador fixo da sala GVG - Epic Seven. Não altere se quiser manter o mesmo link.
const FIXED_ROOM_ID = "GVGEP7";

const $ = (id) => document.getElementById(id);
const supabaseConfigured = SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("COLE_AQUI") &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes("COLE_AQUI");
const sb = supabaseConfigured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let mode = "host";
let channel = null;
let localStream = null;
let roomId = null;
let isHost = false;
let currentHostId = null;
let roomReady = false;
let toastTimer = null;
const peers = new Map(); // remote session ID -> { pc, remoteDescriptionSet, pendingCandidates }
const sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3400);
}
function setStatus(message, connected = false) {
  $("status").textContent = "";
  const dot = document.createElement("span");
  dot.className = "dot";
  $("status").append(dot, document.createTextNode(" " + message));
  $("status").classList.toggle("connected", connected);
}
function setMode(next) {
  mode = next;
  $("hostTab").classList.toggle("active", next === "host");
  $("watchTab").classList.toggle("active", next === "watch");
  $("hostPane").classList.toggle("hidden", next !== "host");
  $("watchPane").classList.toggle("hidden", next !== "watch");
}
function randomRoom() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}
function roomUrl(id) {
  const url = new URL(location.href);
  url.searchParams.set("room", id);
  return url.toString();
}
function showRoom(id, host) {
  $("setup").classList.add("hidden");
  $("room").classList.remove("hidden");
  $("roomCode").textContent = id;
  const isFixedRoom = id === FIXED_ROOM_ID;
  $("roomTitle").textContent = isFixedRoom ? "GVG - Epic Seven" : (host ? "Sua transmissão" : "Sala de transmissão");
  $("roomEyebrow").textContent = isFixedRoom ? "SALA PERMANENTE" : "SALA DE TRANSMISSÃO";
  $("roomHelp").textContent = isFixedRoom
    ? "Esta sala usa sempre o mesmo link. Se não houver transmissão, qualquer participante pode clicar em Assumir transmissão."
    : "Compartilhe o link com vários espectadores. Para trocar quem transmite, libere a transmissão e deixe outra pessoa assumir.";
  updateRoleUI();
}
function showVideo(stream) {
  const video = $("screenVideo");
  video.srcObject = stream;
  video.classList.add("visible");
  $("videoPlaceholder").classList.add("hidden");
  video.play().catch(() => {});
}
function showPlaceholder(message = "A transmissão aparecerá aqui") {
  const video = $("screenVideo");
  video.srcObject = null;
  video.classList.remove("visible");
  $("videoPlaceholder").classList.remove("hidden");
  const strong = $("videoPlaceholder").querySelector("strong");
  if (strong) strong.textContent = message;
}
function updateRoleUI() {
  if (!$("releaseBtn")) return;
  $("releaseBtn").classList.toggle("hidden", !roomReady || !isHost);
  $("takeoverBtn").classList.toggle("hidden", !roomReady || isHost || !!currentHostId);
  $("stopBtn").textContent = isHost ? "Encerrar sala" : "Sair da sala";
  if (isHost && localStream) {
    $("audioBtn").disabled = !localStream.getAudioTracks().length;
    $("audioBtn").textContent = localStream.getAudioTracks().length ? "♫ Áudio incluído" : "♫ Sem áudio do sistema";
  } else {
    $("audioBtn").disabled = true;
    $("audioBtn").textContent = "♫ Áudio do sistema";
  }
}
function closePeer(remoteId) {
  const state = peers.get(remoteId);
  if (!state) return;
  try { state.pc.onicecandidate = null; state.pc.ontrack = null; state.pc.close(); } catch (_) {}
  peers.delete(remoteId);
}
function closeAllPeers() {
  for (const id of [...peers.keys()]) closePeer(id);
}
function createPeer(remoteId) {
  closePeer(remoteId);
  const pc = new RTCPeerConnection(rtcConfig);
  const state = { pc, remoteDescriptionSet: false, pendingCandidates: [] };
  peers.set(remoteId, state);
  pc.onicecandidate = event => {
    if (event.candidate) sendSignal("ice", event.candidate.toJSON(), remoteId);
  };
  pc.onconnectionstatechange = () => {
    if (peers.get(remoteId) !== state) return;
    if (isHost) {
      const connected = [...peers.values()].filter(p => p.pc.connectionState === "connected").length;
      setStatus(connected ? `${connected} espectador(es) conectado(s)` : "Aguardando espectadores", connected > 0);
    } else if (remoteId === currentHostId) {
      const s = pc.connectionState;
      if (s === "connected") setStatus("Conectado à transmissão", true);
      else if (s === "failed") setStatus("Falha na conexão");
      else if (s === "disconnected") setStatus("Conexão interrompida");
      else if (s === "connecting") setStatus("Conectando…");
    }
  };
  pc.ontrack = event => {
    if (!isHost && remoteId === currentHostId) {
      const stream = event.streams[0] || new MediaStream([event.track]);
      showVideo(stream);
    }
  };
  return state;
}
async function subscribeRoom(id) {
  if (!sb) throw new Error("Configure o Supabase em app.js antes de iniciar.");
  roomId = id;
  channel = sb.channel("screenlink-" + id, {
    config: { broadcast: { self: false, ack: true } }
  });
  channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
    if (!payload || payload.sender === sessionId) return;
    if (payload.target && payload.target !== sessionId) return;
    await handleSignal(payload);
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Tempo esgotado ao conectar ao serviço de sinalização.")), 12000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error("Não foi possível entrar na sala. Verifique a configuração do Supabase Realtime."));
      }
    });
  });
}
async function sendSignal(type, data = {}, target = null) {
  if (!channel) return;
  const result = await channel.send({
    type: "broadcast",
    event: "signal",
    payload: { type, data, sender: sessionId, target, sentAt: Date.now() }
  });
  if (result !== "ok") console.warn("Sinalização:", result);
}
async function flushCandidates(state) {
  if (!state || !state.remoteDescriptionSet) return;
  const queued = state.pendingCandidates;
  state.pendingCandidates = [];
  for (const candidate of queued) {
    try { await state.pc.addIceCandidate(candidate); }
    catch (err) { console.warn("ICE candidate ignorado:", err); }
  }
}
function stopLocalCapture() {
  if (localStream) localStream.getTracks().forEach(track => { track.onended = null; track.stop(); });
  localStream = null;
}
function becomeViewer(hostId = null) {
  isHost = false;
  currentHostId = hostId;
  stopLocalCapture();
  closeAllPeers();
  showPlaceholder(hostId ? "Conectando à nova transmissão…" : "A transmissão está livre. Você pode assumi-la.");
  updateRoleUI();
}
async function handleSignal(message) {
  const sender = message.sender;
  try {
    switch (message.type) {
      case "who-is-host":
        if (isHost && localStream) await sendSignal("host-started", {}, sender);
        break;
      case "host-started":
        if (sender === sessionId) break;
        if (isHost) becomeViewer(sender); // resolve accidental simultaneous takeover by yielding to the latest announcement
        currentHostId = sender;
        updateRoleUI();
        showPlaceholder("Conectando à transmissão…");
        await sendSignal("viewer-ready", {}, sender);
        setStatus("Conectando à transmissão…");
        break;
      case "viewer-ready":
        if (!isHost || !localStream) break;
        {
          const state = createPeer(sender);
          localStream.getTracks().forEach(track => state.pc.addTrack(track, localStream));
          const offer = await state.pc.createOffer();
          await state.pc.setLocalDescription(offer);
          await sendSignal("offer", state.pc.localDescription, sender);
          setStatus("Conectando espectadores…");
        }
        break;
      case "offer":
        if (isHost) break;
        if (currentHostId && sender !== currentHostId) break;
        currentHostId = sender;
        {
          let state = peers.get(sender);
          if (!state) state = createPeer(sender);
          await state.pc.setRemoteDescription(message.data);
          state.remoteDescriptionSet = true;
          await flushCandidates(state);
          const answer = await state.pc.createAnswer();
          await state.pc.setLocalDescription(answer);
          await sendSignal("answer", state.pc.localDescription, sender);
          setStatus("Conectando…");
          updateRoleUI();
        }
        break;
      case "answer":
        if (!isHost) break;
        {
          const state = peers.get(sender);
          if (!state) break;
          await state.pc.setRemoteDescription(message.data);
          state.remoteDescriptionSet = true;
          await flushCandidates(state);
        }
        break;
      case "ice":
        if (!message.data) break;
        {
          let state = peers.get(sender);
          if (!state) state = createPeer(sender);
          if (state.remoteDescriptionSet && state.pc.remoteDescription) {
            try { await state.pc.addIceCandidate(message.data); }
            catch (err) { console.warn("ICE candidate ignorado:", err); }
          } else state.pendingCandidates.push(message.data);
        }
        break;
      case "host-released":
        if (sender === currentHostId) {
          closePeer(sender);
          currentHostId = null;
          if (!isHost) showPlaceholder("A transmissão está livre. Você pode assumi-la.");
          updateRoleUI();
          setStatus("Transmissão liberada");
        }
        break;
      case "host-ended":
        await stopRoom("A sala foi encerrada por quem transmitia.", false);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "Não foi possível negociar a conexão.");
    setStatus("Erro na conexão");
  }
}
async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Seu navegador não suporta captura de tela. Use uma versão atual do Chrome, Edge ou Firefox.");
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
  } catch (err) {
    if (err.name === "NotAllowedError") throw err;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    toast("Seu navegador não disponibilizou áudio do sistema; a tela será transmitida sem áudio.");
    return stream;
  }
}
async function createRoom() {
  if (!supabaseConfigured) {
    $("configWarning").classList.remove("hidden");
    toast("Configure o Supabase em app.js para ativar as salas.");
    return;
  }
  try {
    // A captura precisa ser iniciada diretamente pelo clique do usuário.
    localStream = await captureScreen();
    const id = randomRoom();
    isHost = true;
    currentHostId = sessionId;
    showRoom(id, true);
    showVideo(localStream);
    setStatus("Criando sala…");
    await subscribeRoom(id);
    roomReady = true;
    localStream.getTracks().forEach(track => {
      track.onended = () => releaseTransmission("O compartilhamento terminou. A sala continua aberta para outra pessoa transmitir.");
    });
    history.replaceState({}, "", roomUrl(id));
    await sendSignal("host-started");
    setStatus("Aguardando espectadores");
    updateRoleUI();
    await navigator.clipboard?.writeText(roomUrl(id)).catch(() => {});
    toast("Sala criada. Envie o link para os espectadores.");
  } catch (err) {
    console.error(err);
    stopLocalCapture();
    closeAllPeers();
    if (channel && sb) { try { await sb.removeChannel(channel); } catch (_) {} channel = null; }
    isHost = false;
    currentHostId = null;
    roomReady = false;
    showPlaceholder();
    $("room").classList.add("hidden");
    $("setup").classList.remove("hidden");
    toast(err.message || "Não foi possível criar a sala.");
  }
}
async function joinRoom(id) {
  if (!supabaseConfigured) {
    $("configWarning").classList.remove("hidden");
    toast("Configure o Supabase em app.js para ativar as salas.");
    return;
  }
  const cleanId = (id || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (cleanId.length !== 6) { toast("Digite um código de sala válido com 6 caracteres."); return; }
  try {
    isHost = false;
    currentHostId = null;
    showRoom(cleanId, false);
    showPlaceholder("Procurando uma transmissão ativa…");
    setStatus("Entrando na sala…");
    await subscribeRoom(cleanId);
    history.replaceState({}, "", roomUrl(cleanId));
    await sendSignal("who-is-host");
    // Broadcast is not a stored room state; if nobody answers, expose the takeover option.
    await new Promise(resolve => setTimeout(resolve, 1300));
    roomReady = true;
    if (!currentHostId) {
      showPlaceholder("Não há transmissão ativa. Você pode assumir a transmissão.");
      setStatus("Sala aberta — sem transmissão");
      updateRoleUI();
    } else {
      updateRoleUI();
      setStatus("Conectando à transmissão…");
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "Não foi possível entrar na sala.");
    setStatus("Erro ao entrar");
  }
}
async function takeOverTransmission() {
  if (!channel || !roomId || !roomReady) { toast("Entre em uma sala antes de assumir a transmissão."); return; }
  if (currentHostId) { toast("Já existe uma transmissão ativa nesta sala."); return; }
  try {
    // Capture must be requested from this click, not from a Realtime callback.
    const stream = await captureScreen();
    if (currentHostId) {
      stream.getTracks().forEach(track => track.stop());
      toast("Outra pessoa iniciou uma transmissão primeiro.");
      return;
    }
    localStream = stream;
    isHost = true;
    currentHostId = sessionId;
    closeAllPeers();
    showVideo(localStream);
    localStream.getTracks().forEach(track => {
      track.onended = () => releaseTransmission("O compartilhamento terminou. A sala continua aberta para outra pessoa transmitir.");
    });
    await sendSignal("host-started");
    updateRoleUI();
    setStatus("Aguardando espectadores");
    toast("Você assumiu a transmissão nesta sala.");
  } catch (err) {
    console.error(err);
    if (err.name === "NotAllowedError") toast("A captura foi cancelada.");
    else toast(err.message || "Não foi possível assumir a transmissão.");
  }
}
async function releaseTransmission(message = "Transmissão liberada. Outra pessoa pode assumir nesta mesma sala.") {
  if (!isHost) return;
  await sendSignal("host-released");
  becomeViewer(null);
  updateRoleUI();
  setStatus("Transmissão liberada");
  toast(message);
}
async function stopRoom(message = "Sala encerrada.", notifyOthers = true) {
  if (notifyOthers && isHost && channel) await sendSignal("host-ended");
  stopLocalCapture();
  closeAllPeers();
  if (channel && sb) { try { await sb.removeChannel(channel); } catch (_) {} channel = null; }
  isHost = false;
  currentHostId = null;
  roomReady = false;
  roomId = null;
  $("screenVideo").srcObject = null;
  $("screenVideo").classList.remove("visible");
  $("videoPlaceholder").classList.remove("hidden");
  $("audioBtn").disabled = true;
  $("setup").classList.remove("hidden");
  $("room").classList.add("hidden");
  history.replaceState({}, "", location.pathname);
  toast(message);
}

$("hostTab").addEventListener("click", () => setMode("host"));
$("watchTab").addEventListener("click", () => setMode("watch"));
$("createBtn").addEventListener("click", createRoom);
$("fixedRoomBtn").addEventListener("click", () => joinRoom(FIXED_ROOM_ID));
$("joinBtn").addEventListener("click", () => joinRoom($("roomInput").value));
$("roomInput").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom($("roomInput").value); });
$("copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(roomUrl(roomId)); toast("Link copiado!"); }
  catch (_) { prompt("Copie o link da sala:", roomUrl(roomId)); }
});
$("stopBtn").addEventListener("click", () => stopRoom(isHost ? "Sala encerrada." : "Você saiu da sala."));
$("releaseBtn").addEventListener("click", () => releaseTransmission());
$("takeoverBtn").addEventListener("click", takeOverTransmission);
$("audioBtn").addEventListener("click", () => toast("O áudio é capturado quando o navegador permite e você seleciona essa opção ao compartilhar."));
const initialRoom = new URLSearchParams(location.search).get("room");
if (initialRoom) {
  setMode("watch");
  $("roomInput").value = initialRoom;
  // Links com ?room=GVGEP7 entram diretamente na sala fixa.
  if (initialRoom.toUpperCase() === FIXED_ROOM_ID) joinRoom(FIXED_ROOM_ID);
}
if (!supabaseConfigured) $("configWarning").classList.remove("hidden");
