/**
 * AudioWorklet recorder — captures mic input as 16kHz PCM and posts it
 * back to the main thread in 4096-sample frames.
 *
 * Replaces the deprecated, main-thread-blocking ScriptProcessorNode. This runs
 * on a dedicated audio thread, so mic capture can't jank the call UI.
 *
 * Loaded via audioWorklet.addModule('/worklets/audio-recorder.js').
 */

const TARGET_RATE = 16000;

class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options && options.processorOptions ? options.processorOptions : {};
    this.targetRate = opts.targetRate || TARGET_RATE;
    // Rolling buffer for leftover samples between blocks when downsampling.
    this._resampled = new Float32Array(0);
  }

  /**
   * Downsample from the context rate to targetRate by averaging blocks.
   * Pure offline math — safe inside the audio thread.
   */
  _downsample(input) {
    const fromRate = sampleRate; // global AudioWorkletGlobalScope
    const toRate = this.targetRate;
    if (toRate === fromRate) return input;

    const ratio = fromRate / toRate;
    const newLength = Math.round(input.length / ratio);
    const out = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < out.length) {
      const next = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < next && i < input.length; i++) {
        accum += input[i];
        count++;
      }
      out[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = next;
    }
    return out;
  }

  _float32ToPCM16(float32) {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) return true;

    const downsampled = this._downsample(channel);
    const pcm16 = this._float32ToPCM16(downsampled);

    // Transfer the underlying buffer (zero-copy) — the main thread owns it
    // after posting. `port.postMessage` with a Transferable is the fast path.
    const buf = pcm16.buffer;
    this.port.postMessage(buf, [buf]);
    return true;
  }
}

registerProcessor("audio-recorder", AudioRecorderProcessor);
