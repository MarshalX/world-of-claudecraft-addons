export interface PlayOpts {
  volume?: number;
  rate?: number;
  cooldown?: number;
}

export interface SoundApi {
  /** A cue name from cues(), e.g. 'ui_click'. */
  play: (cue: string, opts?: PlayOpts) => void;
  alert: () => void;
  cues: () => readonly string[];
  preload: (cues: readonly string[]) => Promise<void>;
}
