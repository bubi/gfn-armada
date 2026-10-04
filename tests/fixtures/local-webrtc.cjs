// Synthetic canvas video; local ICE only, no microphone or camera.
function loopback(options={}) {
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const ctx=canvas.getContext('2d');let frame=0;
  setInterval(()=>{ctx.fillStyle=frame++%2?'#123456':'#abcdef';ctx.fillRect(0,0,640,360)},33);
  const sender=new RTCPeerConnection(),receiver=new RTCPeerConnection();
  sender.onicecandidate=e=>{if(e.candidate) receiver.addIceCandidate(e.candidate)};
  receiver.onicecandidate=e=>{if(e.candidate) sender.addIceCandidate(e.candidate)};
  receiver.ontrack=e=>{options.onVideoReceiver?.(e.receiver);const v=document.createElement('video');v.autoplay=true;v.muted=true;v.srcObject=e.streams[0];document.body.appendChild(v)};
  const track=canvas.captureStream(30).getVideoTracks()[0];
  sender.addTrack(track,new MediaStream([track]));
  const codecs=RTCRtpSender.getCapabilities('video').codecs.filter(c=>c.mimeType==='video/H264');
  if(!codecs.length) throw new Error('H264 unavailable');
  sender.getTransceivers()[0].setCodecPreferences(codecs);
  return (async()=>{
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(receiver.localDescription);
  })();
}
module.exports={loopback};
