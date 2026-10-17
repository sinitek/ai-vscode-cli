declare module "yauzl" {
  import { Readable } from "stream";

  export interface Entry {
    fileName: string;
    uncompressedSize: number;
    externalFileAttributes: number;
    versionMadeBy: number;
    isEncrypted(): boolean;
    canDecodeFileData(): boolean;
  }

  export interface ZipFile {
    readEntry(): void;
    openReadStreamPromise(entry: Entry): Promise<Readable>;
    close(): void;
    on(event: "entry", listener: (entry: Entry) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  export function fromBufferPromise(
    buffer: Buffer,
    options?: {
      lazyEntries?: boolean;
      decodeStrings?: boolean;
      validateEntrySizes?: boolean;
      strictFileNames?: boolean;
    },
  ): Promise<ZipFile>;

  export function validateFileName(fileName: string): string | null;
}
