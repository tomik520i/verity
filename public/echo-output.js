// Lokální WebRTC smyčka pouze pro hlas Verity. Mikrofon touto cestou neposíláme.
// Princip: https://github.com/nguyenvulebinh/browser-aec
// Vlastní implementace bez externích balíčků, STUN/TURN serverů a sdílení obrazovky.
export async function createEchoOutput(context, { signal, onFailure = () => {} } = {}) {
  if (!globalThis.RTCPeerConnection) throw Error('Prohlížeč nepodporuje WebRTC pro AEC.');
  const input = context.createMediaStreamDestination();
  const sender = new RTCPeerConnection({ iceServers: [] });
  const receiver = new RTCPeerConnection({ iceServers: [] });
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.hidden = true;
  document.body.append(audio);
  let closed = false, connected = false, remote = null, timer, flushTimer;
  let rejectReady, resolveReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Catch handler exists immediately, even if signalling fails before awaiting ready.
  ready.catch(() => {});
  const fail = error => { if (closed) return; rejectReady(error); if (connected) onFailure(error); };
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); clearTimeout(flushTimer);
    rejectReady(new DOMException('AEC ukončeno', 'AbortError'));
    signal?.removeEventListener('abort', abort);
    audio.pause(); audio.srcObject = null; audio.remove();
    sender.close(); receiver.close();
    input.stream.getTracks().forEach(t => t.stop()); remote?.getTracks().forEach(t => t.stop());
    input.disconnect();
  };
  const abort = () => close();
  signal?.addEventListener('abort', abort, { once: true });
  const toSender = [], toReceiver = [];
  const ice = async (peer, queue, event) => {
    if (!event.candidate || closed) return;
    if (!peer.remoteDescription) { queue.push(event.candidate); return; }
    try { await peer.addIceCandidate(event.candidate); } catch (error) { fail(error); }
  };
  sender.onicecandidate = e => ice(receiver, toReceiver, e);
  receiver.onicecandidate = e => ice(sender, toSender, e);
  const state = () => {
    if (closed) return;
    if ([sender.connectionState, receiver.connectionState].includes('failed')) fail(Error('Zvuková smyčka AEC se odpojila.'));
    if (sender.connectionState === 'connected' && receiver.connectionState === 'connected' && remote) resolveReady();
  };
  sender.onconnectionstatechange = receiver.onconnectionstatechange = state;
  receiver.ontrack = event => { remote = event.streams[0] || new MediaStream([event.track]); audio.srcObject = remote; state(); };
  try {
    if (signal?.aborted) throw new DOMException('AEC ukončeno', 'AbortError');
    timer = setTimeout(() => fail(Error('AEC se nepodařilo spojit. Zvol režim Reproduktory – střídání.')), 8000);
    for (const track of input.stream.getTracks()) sender.addTrack(track, input.stream);
    const offer = await sender.createOffer(); await sender.setLocalDescription(offer); await receiver.setRemoteDescription(offer);
    for (const candidate of toReceiver.splice(0)) await receiver.addIceCandidate(candidate);
    const answer = await receiver.createAnswer(); await receiver.setLocalDescription(answer); await sender.setRemoteDescription(answer);
    for (const candidate of toSender.splice(0)) await sender.addIceCandidate(candidate);
    await ready;
    await Promise.race([audio.play(), new Promise((_,reject)=>{clearTimeout(timer);timer=setTimeout(()=>reject(Error('Prohlížeč nepovolil přehrávání AEC.')),4000);})]);
    if (closed || signal?.aborted) throw new DOMException('AEC ukončeno', 'AbortError');
    connected = true; clearTimeout(timer);
    return {
      input, close,
      // Při přerušení ztiš i několik už přenesených paketů, aby nedohrála stará věta.
      flush() { audio.muted = true; clearTimeout(flushTimer); flushTimer = setTimeout(() => { if (!closed) audio.muted = false; }, 250); },
    };
  } catch (error) { close(); throw error; }
}
