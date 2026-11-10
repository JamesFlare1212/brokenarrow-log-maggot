export function runInstaller(installer?: string): Promise<void>;

export function installElectron(options?: {
  run?: () => Promise<void>;
  wait?: (milliseconds: number) => Promise<unknown>;
  warn?: (message: string) => void;
}): Promise<void>;
