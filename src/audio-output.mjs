export const outputBoostDb = 14;

export function createOutputGraph(context, destination = context.destination) {
  const input = context.createGain();
  input.gain.value = 10 ** (outputBoostDb / 20);
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 2;
  compressor.ratio.value = 20;
  compressor.attack.value = .002;
  compressor.release.value = .1;
  // Compensate the browser compressor's automatic makeup gain.
  const trim = context.createGain();
  trim.gain.value = 10 ** (-1.5 / 20);
  // A smooth, oversampled ceiling catches rare peaks after the bus compressor.
  const ceiling = context.createWaveShaper();
  const curve = new Float32Array(65537);
  for (let i = 0; i < curve.length; i++) {
    const x = i * 2 / (curve.length - 1) - 1, magnitude = Math.abs(x);
    curve[i] = Math.sign(x) * (magnitude <= .7 ? magnitude : .7 + .07 * Math.tanh((magnitude - .7) / .07));
  }
  ceiling.curve = curve;
  ceiling.oversample = '4x';
  input.connect(compressor);
  compressor.connect(trim);
  trim.connect(ceiling);
  ceiling.connect(destination);
  return {input, compressor, ceiling};
}

export function createBrowserOutput(media) {
  if (typeof AudioContext === 'undefined') return null;
  const context = new AudioContext({latencyHint: 'interactive'});
  const graph = createOutputGraph(context);
  const sources = media.map(element => context.createMediaElementSource(element));
  for (const source of sources) source.connect(graph.input);
  return {
    resume: () => context.resume().catch(() => {}),
    close: () => context.close().catch(() => {}),
  };
}
