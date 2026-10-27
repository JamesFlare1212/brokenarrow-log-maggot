import { developmentPreview } from './data';

/** Generates synthetic footage without requesting a display, microphone or camera. */
export async function createDevelopmentVideo(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context || typeof MediaRecorder === 'undefined')
    throw new Error('Synthetic video is unavailable in this browser.');
  const image = new Image();
  image.src = developmentPreview;
  await image.decode();
  const stream = canvas.captureStream(12);
  const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  let tick = 0;
  const draw = () => {
    context.drawImage(image, 0, 0);
    context.fillStyle = '#fbbf24';
    context.beginPath();
    context.arc(160 + (tick++ % 120) * 2, 190, 8, 0, Math.PI * 2);
    context.fill();
  };
  draw();
  return new Promise((resolve, reject) => {
    const timer = setInterval(draw, 80);
    const stop = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 2400);
    const cleanup = () => {
      clearInterval(timer);
      clearTimeout(stop);
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      cleanup();
      resolve(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'video/webm' })));
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error('Could not generate the development video.'));
    };
    recorder.start();
  });
}
