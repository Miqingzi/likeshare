import React, { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { Play, Pause, Volume2, VolumeX, Film, Music, RefreshCw } from "lucide-react";

interface ImageSequencePlayerProps {
  zipBlob: Blob;
  fps: number;
  hasAudio?: boolean;
  audioName?: string;
  shouldBlur: boolean;
  onFrameChange?: (index: number, total: number) => void;
}

export default function ImageSequencePlayer({
  zipBlob,
  fps = 30,
  hasAudio = false,
  audioName = "",
  shouldBlur = false,
  onFrameChange
}: ImageSequencePlayerProps) {
  const [frames, setFrames] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<any>(null);
  const framesRef = useRef<string[]>([]);
  const currentFrameIdxRef = useRef(currentFrameIdx);

  // Maintain reference to avoid stale closures in play loop
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    currentFrameIdxRef.current = currentFrameIdx;
    if (onFrameChange && frames.length > 0) {
      onFrameChange(currentFrameIdx, frames.length);
    }
  }, [currentFrameIdx, frames.length, onFrameChange]);

  // Load and unzip content
  useEffect(() => {
    let active = true;
    const generatedUrls: string[] = [];
    let audioBlobUrl: string | null = null;

    async function extractZip() {
      try {
        setIsLoading(true);
        setErrorMsg(null);
        
        const zip = await JSZip.loadAsync(zipBlob);
        
        // Find and extract image frames
        const frameFiles: { path: string; index: number }[] = [];
        const audioFiles: string[] = [];

        zip.forEach((relativePath, file) => {
          if (relativePath.startsWith("frames/") && !file.dir) {
            // Parse numeric index if available, else fallback
            const match = relativePath.match(/frame_(\d+)/);
            const index = match ? parseInt(match[1], 10) : 0;
            frameFiles.push({ path: relativePath, index });
          } else if (relativePath.startsWith("audio/") && !file.dir) {
            audioFiles.push(relativePath);
          }
        });

        if (frameFiles.length === 0) {
          throw new Error("无损视频容器中未检测到任何图片帧文件");
        }

        // Sort by parsed index or path string alphabetically as sorting alignment
        frameFiles.sort((a, b) => {
          if (a.index !== b.index) {
            return a.index - b.index;
          }
          return a.path.localeCompare(b.path, undefined, { numeric: true });
        });

        // Extract images frame by frame
        const frameUrls: string[] = [];
        for (const fileItem of frameFiles) {
          if (!active) return;
          const fileObj = zip.file(fileItem.path);
          if (fileObj) {
            const blob = await fileObj.async("blob");
            const objectUrl = URL.createObjectURL(blob);
            generatedUrls.push(objectUrl);
            frameUrls.push(objectUrl);
          }
        }

        // Extract audio if exists
        let finalAudioUrl: string | null = null;
        if (audioFiles.length > 0) {
          const audioFileObj = zip.file(audioFiles[0]);
          if (audioFileObj) {
            const blob = await audioFileObj.async("blob");
            audioBlobUrl = URL.createObjectURL(blob);
            finalAudioUrl = audioBlobUrl;
          }
        }

        if (active) {
          setFrames(frameUrls);
          if (finalAudioUrl) {
            setAudioUrl(finalAudioUrl);
          }
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error("Unzipping error:", err);
        if (active) {
          setErrorMsg(err.message || "解包视频或序列帧数据包出错");
          setIsLoading(false);
        }
      }
    }

    extractZip();

    return () => {
      active = false;
      // Cleanup URLs
      generatedUrls.forEach(url => URL.revokeObjectURL(url));
      if (audioBlobUrl) {
        URL.revokeObjectURL(audioBlobUrl);
      }
    };
  }, [zipBlob]);

  // Frame transition loop timer
  useEffect(() => {
    if (isPlaying && frames.length > 0) {
      const intervalMs = 1000 / fps;
      
      // Keep audio synced if available
      if (audioRef.current && audioUrl) {
        audioRef.current.playbackRate = 1.0;
        // Sync time occasionally or play from start if loop restarts
        if (audioRef.current.paused) {
          audioRef.current.play().catch(e => console.log("Audio play deferred", e));
        }
      }

      timerRef.current = setInterval(() => {
        let nextIdx = currentFrameIdxRef.current + 1;
        if (nextIdx >= framesRef.current.length) {
          nextIdx = 0;
          if (audioRef.current && audioUrl) {
            audioRef.current.currentTime = 0; // restart audio loop to mirror frames
          }
        }
        setCurrentFrameIdx(nextIdx);
      }, intervalMs);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isPlaying, frames.length, fps, audioUrl]);

  // Sync mute state and volume settings
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
      audioRef.current.volume = volume;
    }
  }, [isMuted, volume]);

  const handleTogglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frameIndex = parseInt(e.target.value, 10);
    setCurrentFrameIdx(frameIndex);
    
    // Sync audio position approximately based on frame index ratio
    if (audioRef.current && frames.length > 0) {
      const duration = audioRef.current.duration;
      if (duration && !isNaN(duration)) {
        audioRef.current.currentTime = (frameIndex / frames.length) * duration;
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-2xl min-h-[220px]">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
        <span className="text-xs font-semibold text-slate-300">正在重构无损视频帧，恢复 ComfyUI 流程...</span>
        <span className="text-[10px] text-slate-500 mt-1">提取序列图像与音频管道</span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center p-6 bg-slate-900 border border-red-900/30 rounded-2xl min-h-[220px]">
        <span className="p-2.5 bg-red-900/20 text-red-400 rounded-xl mb-2.5">⚠️</span>
        <span className="text-xs font-bold text-slate-200">解密帧合成失败</span>
        <p className="text-[10px] text-slate-500 mt-1 max-w-xs text-center">{errorMsg}</p>
      </div>
    );
  }

  const currentFrameUrl = frames[currentFrameIdx] || "";

  return (
    <div className="w-full flex flex-col gap-3 p-3 bg-slate-950 border border-slate-900 shadow-xl rounded-2xl">
      {/* Viewport Frame Rendering */}
      <div className="relative overflow-hidden rounded-xl bg-black flex items-center justify-center min-h-[220px] max-h-[300px] border border-slate-900">
        <div className="absolute top-2 left-2 text-[8.5px] text-indigo-400 font-mono tracking-wide bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1.5 z-10">
          <Film className="w-3 h-3 text-indigo-400" />
          <span>ComfyUI Sequence • {frames.length} 帧</span>
        </div>

        {audioUrl && (
          <div className="absolute top-2 right-2 text-[8.5px] text-emerald-400 font-mono tracking-wide bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1.5 z-10">
            <Music className="w-3 h-3 text-emerald-400" />
            <span className="max-w-[80px] truncate">{audioName || "已对齐音频"}</span>
          </div>
        )}

        {currentFrameUrl && (
          <img
            src={currentFrameUrl}
            alt={`Frame ${currentFrameIdx}`}
            className={`max-h-[220px] sm:max-h-[280px] w-auto object-contain transition-all duration-100 ${
              shouldBlur ? "blur-xl" : "filter-none"
            }`}
          />
        )}

        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            loop
            preload="auto"
            className="hidden"
          />
        )}
      </div>

      {/* Control console HUD */}
      <div className="flex flex-col gap-2 p-2 bg-slate-900/60 rounded-xl border border-slate-800/40">
        {/* Timeline Slider */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-slate-500">0</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, frames.length - 1)}
            value={currentFrameIdx}
            onChange={handleProgressChange}
            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
          />
          <span className="text-[9px] font-mono text-slate-500">{frames.length - 1}</span>
        </div>

        {/* Buttons Panel */}
        <div className="flex items-center justify-between gap-4 mt-0.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors cursor-pointer text-xs flex items-center justify-center"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>

            {/* Frame metadata ticker info */}
            <div className="flex flex-col text-[10px] font-mono text-slate-400 leading-tight">
              <span className="text-slate-200 font-bold">帧：{currentFrameIdx + 1} / {frames.length}</span>
              <span className="text-slate-500">速率：{fps} FPS</span>
            </div>
          </div>

          {/* Audio Slider Controls */}
          {audioUrl && (
            <div className="flex items-center gap-2 font-mono">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer transition-colors"
                title={isMuted ? "解静音" : "静音"}
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1.0}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  setIsMuted(false);
                }}
                className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-slate-400 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
