/**
 * アニメーションループ管理
 * requestAnimationFrame ベースで正確なフレーム進行を実現
 */
export class AnimationLoop {
  private animId: number | null = null;
  private lastTimestamp: number = 0;
  private frameDuration: number;
  private accumulator: number = 0;
  private onFrame: (frame: number) => void;
  private getFrame: () => number;
  private setFrame: (frame: number) => void;
  private getTotalFrames: () => number;

  constructor(
    fps: number,
    onFrame: (frame: number) => void,
    getFrame: () => number,
    setFrame: (frame: number) => void,
    getTotalFrames: () => number
  ) {
    this.frameDuration = 1000 / fps;
    this.onFrame = onFrame;
    this.getFrame = getFrame;
    this.setFrame = setFrame;
    this.getTotalFrames = getTotalFrames;
  }

  /** FPS変更 */
  setFPS(fps: number) {
    this.frameDuration = 1000 / fps;
  }

  /** ループ開始 */
  start() {
    if (this.animId !== null) return;
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    this.tick(this.lastTimestamp);
  }

  /** ループ停止 */
  stop() {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  /** 動作中かどうか */
  get isRunning(): boolean {
    return this.animId !== null;
  }

  private tick = (timestamp: number) => {
    this.animId = requestAnimationFrame(this.tick);

    const delta = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.accumulator += delta;

    // フレーム進行
    if (this.accumulator >= this.frameDuration) {
      const framesToAdvance = Math.floor(this.accumulator / this.frameDuration);
      this.accumulator -= framesToAdvance * this.frameDuration;

      let currentFrame = this.getFrame();
      currentFrame += framesToAdvance;

      const totalFrames = this.getTotalFrames();
      if (currentFrame >= totalFrames) {
        currentFrame = 0; // ループ再生
      }

      this.setFrame(currentFrame);
      this.onFrame(currentFrame);
    }
  };
}
