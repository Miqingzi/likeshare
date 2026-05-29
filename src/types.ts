export interface EncryptedMetadata {
  name: string;
  type: string;
  size: number;
  hasPassword?: boolean;
}

export interface DecryptedFile {
  blob: Blob;
  name: string;
  type: string;
  size: number;
}
