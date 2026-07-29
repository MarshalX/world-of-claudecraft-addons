import type { Unsubscribe } from './addon.js';

export interface FrameOpts {
  id: string;
  title?: string;
  width?: number;
  height?: number;
  movable?: boolean;
  resizable?: boolean;
  /** Persist position and visibility per character. */
  save?: boolean;
}

export interface Frame {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setTitle: (title: string) => void;
  destroy: () => void;
}

export interface ToastOpts {
  level?: 'info' | 'warn' | 'error';
  ttl?: number;
}

export interface AlertOpts {
  title: string;
  body: string;
  buttons?: string[];
}

export interface MicroButtonOpts {
  icon: string;
  tooltip: string;
  onClick: () => void;
}

export interface UiApi {
  frame: (opts: FrameOpts) => Frame;
  window: (opts: FrameOpts) => Frame;
  toast: (text: string, opts?: ToastOpts) => void;
  alert: (opts: AlertOpts) => Promise<string>;
  microButton: (opts: MicroButtonOpts) => Unsubscribe;
  menuEntry: (opts: { label: string; onClick: () => void }) => Unsubscribe;
  tooltip: (el: HTMLElement, text: string) => Unsubscribe;
}
