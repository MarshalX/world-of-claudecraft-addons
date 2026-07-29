export type Unsubscribe = () => void;

export interface AddonInfo {
  readonly id: string;
  readonly fqid: string;
  readonly name: string;
  readonly version: string;
  readonly marketplace: string;
}

export interface GameInfo {
  readonly host: string;
  readonly channel: 'live' | 'pbe' | 'pbe2';
  readonly version: string;
  readonly build: string;
}
