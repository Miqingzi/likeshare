export interface EncryptedMetadata {
  name: string;
  type: string;
  size: number;
  hasPassword?: boolean;
  fps?: number;
  isImageSequenceToVideo?: boolean;
  audioAttached?: boolean;
  originalAudioName?: string;
  comfyNodeMode?: boolean;
}

export interface DecryptedFile {
  blob: Blob;
  name: string;
  type: string;
  size: number;
  fps?: number;
  isImageSequenceToVideo?: boolean;
  audioAttached?: boolean;
  originalAudioName?: string;
  comfyNodeMode?: boolean;
}
