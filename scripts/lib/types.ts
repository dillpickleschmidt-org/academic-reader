export type BackendMode = "local" | "runpod" | "datalab";

export type Env = Record<string, string | undefined>;

export interface Command {
  name: string;
  description: string;
  execute(env: Env, options: CommandOptions): Promise<void>;
}

export interface CommandOptions {
  dashboardEnabled?: boolean;
}
