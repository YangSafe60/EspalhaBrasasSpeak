import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioConstraintsFromSettings,
  ensureMediaPermissions,
  listMediaDevices,
  loadMediaSettings,
  saveMediaSettings,
  type MediaSettings,
} from "../lib/mediaSettings";
import {
  playVoiceJoinSound,
  setVoiceSoundsEnabled,
  voiceSoundsEnabled,
} from "../lib/voiceSounds";
import { useAppStore } from "../store/appStore";

function MicMeter({
  deviceId,
  sensitivity,
  inputVolume,
}: {
  deviceId: string;
  sensitivity: number;
  inputVolume: number;
}) {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let alive = true;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraintsFromSettings({
            ...loadMediaSettings(),
            inputDeviceId: deviceId,
            inputVolume,
          }),
        });
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0.01, inputVolume / 100);
        source.connect(gain);
        gain.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!alive) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length / 255;
          const boosted = Math.min(1, avg * (inputVolume / 100) * 1.8);
          setLevel(boosted);
          // sensitivity 0 = very sensitive, 100 = needs loud input
          const threshold = sensitivity / 100;
          setSpeaking(boosted > threshold * 0.55 + 0.05);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
        setSpeaking(false);
      }
    }

    void start();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [deviceId, sensitivity, inputVolume]);

  const thresholdPct = Math.min(100, Math.max(0, sensitivity));

  return (
    <div className="mic-meter">
      <div className="mic-meter-track">
        <div
          className={`mic-meter-fill ${speaking ? "hot" : ""}`}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
        <div className="mic-meter-threshold" style={{ left: `${thresholdPct}%` }} />
      </div>
      <p className="muted tiny">
        {speaking ? "Mic open" : "Below sensitivity"} — drag sensitivity so the bar crosses the
        marker when you speak.
      </p>
    </div>
  );
}

function CameraPreview({
  deviceId,
  mirror,
}: {
  deviceId: string;
  mirror: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;

    async function start() {
      setError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        setError("Camera unavailable. Check permissions.");
      }
    }

    void start();
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [deviceId]);

  return (
    <div className="camera-preview-wrap">
      <video
        ref={videoRef}
        className={`camera-preview ${mirror ? "mirror" : ""}`}
        muted
        playsInline
      />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

export function VoiceVideoSettingsPanel() {
  const muted = useAppStore((s) => s.muted);
  const deafened = useAppStore((s) => s.deafened);
  const setVoiceLocal = useAppStore((s) => s.setVoiceLocal);

  const [settings, setSettings] = useState<MediaSettings>(() => loadMediaSettings());
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [permError, setPermError] = useState<string | null>(null);
  const [testingOutput, setTestingOutput] = useState(false);
  const [joinSounds, setJoinSounds] = useState(() => voiceSoundsEnabled());

  const refreshDevices = useCallback(async () => {
    const ok = await ensureMediaPermissions();
    if (!ok) {
      setPermError("Allow microphone (and camera) access to list devices.");
    } else {
      setPermError(null);
    }
    const list = await listMediaDevices();
    setAudioInputs(list.audioInputs);
    setAudioOutputs(list.audioOutputs);
    setVideoInputs(list.videoInputs);
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, [refreshDevices]);

  function patch(partial: Partial<MediaSettings>) {
    const next = saveMediaSettings(partial);
    setSettings(next);
  }

  async function testSpeakers() {
    setTestingOutput(true);
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      // Prefer selected output when supported
      const dest = ctx.destination as AudioDestinationNode & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (settings.outputDeviceId && dest.setSinkId) {
        await dest.setSinkId(settings.outputDeviceId).catch(() => undefined);
      }
      osc.start();
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.12 * (settings.outputVolume / 100), now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      await new Promise((r) => setTimeout(r, 400));
      osc.stop();
      await ctx.close();
    } finally {
      setTestingOutput(false);
    }
  }

  return (
    <div className="stack voice-video-settings">
      {permError && <p className="form-error">{permError}</p>}

      <div className="settings-section">
        <h4>Input Device</h4>
        <label>
          Microphone
          <select
            value={settings.inputDeviceId}
            onChange={(e) => patch({ inputDeviceId: e.target.value })}
          >
            <option value="">Default</option>
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Input Volume ({settings.inputVolume}%)
          <input
            type="range"
            min={0}
            max={200}
            value={settings.inputVolume}
            onChange={(e) => patch({ inputVolume: Number(e.target.value) })}
          />
        </label>
        <label>
          Input Sensitivity ({settings.micSensitivity})
          <input
            type="range"
            min={0}
            max={100}
            value={settings.micSensitivity}
            onChange={(e) => patch({ micSensitivity: Number(e.target.value) })}
          />
        </label>
        <MicMeter
          deviceId={settings.inputDeviceId}
          sensitivity={settings.micSensitivity}
          inputVolume={settings.inputVolume}
        />
      </div>

      <div className="settings-section">
        <h4>Output Device</h4>
        <label>
          Speakers / Headphones
          <select
            value={settings.outputDeviceId}
            onChange={(e) => patch({ outputDeviceId: e.target.value })}
          >
            <option value="">Default</option>
            {audioOutputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Output Volume ({settings.outputVolume}%)
          <input
            type="range"
            min={0}
            max={200}
            value={settings.outputVolume}
            onChange={(e) => patch({ outputVolume: Number(e.target.value) })}
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="btn ghost sm"
            disabled={testingOutput}
            onClick={() => void testSpeakers()}
          >
            {testingOutput ? "Playing…" : "Test speakers"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h4>Voice Processing</h4>
        <label className="toggle-row">
          <span>Echo Cancellation</span>
          <input
            type="checkbox"
            checked={settings.echoCancellation}
            onChange={(e) => patch({ echoCancellation: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>Noise Suppression</span>
          <input
            type="checkbox"
            checked={settings.noiseSuppression}
            onChange={(e) => patch({ noiseSuppression: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>Automatic Gain Control</span>
          <input
            type="checkbox"
            checked={settings.autoGainControl}
            onChange={(e) => patch({ autoGainControl: e.target.checked })}
          />
        </label>
      </div>

      <div className="settings-section">
        <h4>Camera</h4>
        <label>
          Camera
          <select
            value={settings.cameraDeviceId}
            onChange={(e) => patch({ cameraDeviceId: e.target.value })}
          >
            <option value="">Default</option>
            {videoInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle-row">
          <span>Mirror my camera</span>
          <input
            type="checkbox"
            checked={settings.mirrorCamera}
            onChange={(e) => patch({ mirrorCamera: e.target.checked })}
          />
        </label>
        <CameraPreview deviceId={settings.cameraDeviceId} mirror={settings.mirrorCamera} />
      </div>

      <div className="settings-section">
        <h4>Quick controls</h4>
        <label className="toggle-row">
          <span>Mute microphone</span>
          <input
            type="checkbox"
            checked={muted}
            onChange={(e) => setVoiceLocal({ muted: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>Deafen (mute output + mic)</span>
          <input
            type="checkbox"
            checked={deafened}
            onChange={(e) =>
              setVoiceLocal({
                deafened: e.target.checked,
                muted: e.target.checked,
              })
            }
          />
        </label>
        <label className="toggle-row">
          <span>Join / leave / share sounds</span>
          <input
            type="checkbox"
            checked={joinSounds}
            onChange={(e) => {
              const on = e.target.checked;
              setJoinSounds(on);
              setVoiceSoundsEnabled(on);
              if (on) playVoiceJoinSound();
            }}
          />
        </label>
        <button type="button" className="btn ghost sm" onClick={() => void refreshDevices()}>
          Refresh devices
        </button>
        <p className="muted tiny">
          Device changes apply immediately in voice channels. LiveKit must be running for calls.
        </p>
      </div>
    </div>
  );
}
