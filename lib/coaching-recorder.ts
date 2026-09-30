/**
 * Browser capture for replay coaching (spec 0096): the microphone plus this tab cropped to the
 * replay, recorded into one WebM.
 *
 * The bitrate is capped so a 30-minute session stays well under the analysis upload limit
 * (256 MiB): 600 kbps video + 64 kbps Opus is about 150 MB per 30 minutes. That cap is why the
 * server never needs to re-encode.
 */

import fixWebmDuration from "fix-webm-duration";

const VIDEO_BITS_PER_SECOND = 600_000;
const AUDIO_BITS_PER_SECOND = 64_000;
const LEVEL_SAMPLE_MS = 80;
// The meter's bars, low to high: eight bands from ~90 Hz to ~4.7 kHz, where speech lives.
const MIC_BANDS = 8;
const FFT_SIZE = 512;
const FIRST_BIN = 1;
const LAST_BIN = 56;
const WEBM_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

// Region Capture (Chromium) is not in the DOM typings yet.
type CropTargetStatic = { fromElement(element: Element): Promise<unknown> };
type CroppableTrack = MediaStreamTrack & {
  cropTo(target: unknown): Promise<void>;
};

export type CoachingRecording = {
  /** The MediaRecorder type actually used, reported to the backend at finish. */
  mimeType: string;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  /**
   * Stops capture and resolves with the complete recording. MediaRecorder streams WebM without a
   * duration, which leaves players unable to seek; `durationMs` is written into the file.
   */
  stop(durationMs: number): Promise<Blob>;
  /** Stops capture and discards the recording. */
  abort(): void;
};

export function coachingCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof MediaRecorder !== "undefined" &&
    WEBM_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
  );
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

/** Asks for the microphone and this tab, then starts recording. Rejects when permission is denied. */
export async function startCoachingRecording({
  cropTo,
  onLevels,
  onCaptureEnded,
}: {
  cropTo: HTMLElement;
  /** Called every LEVEL_SAMPLE_MS with MIC_BANDS loudness values, each 0–1, low to high pitch. */
  onLevels: (levels: number[]) => void;
  onCaptureEnded: () => void;
}): Promise<CoachingRecording> {
  // Checked before asking for any device, so a failure here leaves nothing running.
  const mimeType = WEBM_TYPES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (mimeType === undefined) {
    throw new Error("No supported WebM MediaRecorder type");
  }
  const microphone = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const screen = await navigator.mediaDevices
    .getDisplayMedia({
      video: { displaySurface: "browser", frameRate: 15 },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions)
    .catch((error: unknown) => {
      stopTracks(microphone);
      throw error;
    });

  const [videoTrack] = screen.getVideoTracks();
  const cropTarget = (window as unknown as { CropTarget?: CropTargetStatic })
    .CropTarget;
  if (cropTarget) {
    // Cropping rejects when the coach shared a different tab than this one.
    await cropTarget
      .fromElement(cropTo)
      .then((target) => (videoTrack as CroppableTrack).cropTo(target))
      .catch((error: unknown) => {
        stopTracks(screen);
        stopTracks(microphone);
        throw error;
      });
  }
  // The person pressed the browser's own "Stop sharing": finish instead of recording black.
  videoTrack.addEventListener("ended", onCaptureEnded);

  const recorder = new MediaRecorder(
    new MediaStream([videoTrack, ...microphone.getAudioTracks()]),
    {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    },
  );
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start(1000);

  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  audio.createMediaStreamSource(microphone).connect(analyser);
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  // Log-spaced band edges so the low bars do not swallow every voiced sound.
  const edges = Array.from({ length: MIC_BANDS + 1 }, (_, index) =>
    Math.round(FIRST_BIN * (LAST_BIN / FIRST_BIN) ** (index / MIC_BANDS)),
  );
  const levelTimer = window.setInterval(() => {
    analyser.getByteFrequencyData(spectrum);
    onLevels(
      edges.slice(1).map((end, index) => {
        const start = edges[index]!;
        let peak = 0;
        for (let bin = start; bin < Math.max(end, start + 1); bin += 1)
          peak = Math.max(peak, spectrum[bin]!);
        return Math.min(1, (peak / 255) * 1.4);
      }),
    );
  }, LEVEL_SAMPLE_MS);

  const release = () => {
    window.clearInterval(levelTimer);
    void audio.close();
    videoTrack.removeEventListener("ended", onCaptureEnded);
    stopTracks(screen);
    stopTracks(microphone);
  };

  return {
    mimeType,
    pause: () => recorder.pause(),
    resume: () => recorder.resume(),
    setMuted: (muted) => {
      for (const track of microphone.getAudioTracks()) track.enabled = !muted;
    },
    stop: async (durationMs) => {
      const stopped = new Promise<void>((resolve) =>
        recorder.addEventListener("stop", () => resolve(), { once: true }),
      );
      recorder.stop();
      await stopped;
      release();
      return fixWebmDuration(
        new Blob(chunks, { type: "video/webm" }),
        durationMs,
        {
          logger: false,
        },
      );
    },
    abort: () => {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
