/* embedded-postgres ships dist/index.d.ts but its package.json declares
 * no "types"/"typings" field and an "exports" map that TypeScript's
 * module resolution here doesn't follow for type lookup — a loose
 * ambient declaration is the pragmatic fix, not fighting resolver
 * config for a test-only dependency. */
declare module 'embedded-postgres' {
  export interface EmbeddedPostgresOptions {
    databaseDir: string;
    user: string;
    password: string;
    port: number;
    persistent?: boolean;
  }

  export default class EmbeddedPostgres {
    constructor(options: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
    getPgClient(): unknown;
  }
}
