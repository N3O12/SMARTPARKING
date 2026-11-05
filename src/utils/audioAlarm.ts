/**
 * Generador de Alarma Sonora y Beeps Operativos utilizando Web Audio API
 * No requiere archivos externos de audio y funciona 100% en el navegador.
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private alarmInterval: number | null = null;
  private isAlarmPlaying = false;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Reproduce una sirena bitonal de alta intensidad para Alerta de Fraude / Robo
   */
  public startSecurityAlarm(durationSeconds = 6): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    this.stopAlarm();
    this.isAlarmPlaying = true;

    let highTone = true;
    const playTone = () => {
      if (!this.isAlarmPlaying) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        // Frecuencia alternada entre 950Hz y 650Hz (sirena policial/seguridad)
        osc.frequency.setValueAtTime(highTone ? 960 : 640, ctx.currentTime);
        highTone = !highTone;

        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.24);
      } catch {
        // Ignorar si el audio está bloqueado por el navegador
      }
    };

    playTone();
    this.alarmInterval = window.setInterval(playTone, 250);

    // Auto-apagar después de durationSeconds si no se detuvo antes
    window.setTimeout(() => {
      this.stopAlarm();
    }, durationSeconds * 1000);
  }

  public stopAlarm(): void {
    this.isAlarmPlaying = false;
    if (this.alarmInterval !== null) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }

  /**
   * Beep suave de confirmación para apertura de barrera o emisión de ticket
   */
  public playSuccessBeep(): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // no-op
    }
  }

  public playSuccessChime(): void {
    this.playSuccessBeep();
  }

  /**
   * Beep de escaneo o captura de OCR
   */
  public playScanBeep(): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      // no-op
    }
  }
}

export const soundManager = new SoundManager();
