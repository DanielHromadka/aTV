import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'

const XVFB = '/usr/bin/Xvfb'
const PULSE = '/usr/bin/pulseaudio'
export const AV_DISPLAY = ':99'
const SINK = 'atv'
const IDLE_MS = 30_000

/** Xvfb and PulseAudio exist (the Docker image), so the browser can run with a real screen and sound. */
export function avSupported(): boolean {
  return process.platform === 'linux' && existsSync(XVFB) && existsSync(PULSE) && existsSync('/usr/bin/ffmpeg')
}

/** Environment for a Chrome that draws on the virtual screen and plays into the virtual sound card. */
export function avEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DISPLAY: AV_DISPLAY, PULSE_SINK: SINK, XDG_RUNTIME_DIR: runtimeDir() }
}

const runtimeDir = () => join(process.env.TMPDIR || '/tmp', 'atv-xdg')

/**
 * The browser as video with sound: a virtual screen (Xvfb) and sound card (PulseAudio null sink)
 * that Chrome draws and plays into, captured by ffmpeg as a short-segment live HLS stream the TV's
 * player can show. Started when the first TV asks for the stream, stopped 30 s after the last request.
 */
export class BrowserAv {
  private xvfb?: ChildProcess
  private pulseReady?: Promise<void>
  private ffmpeg?: ChildProcess
  private starting?: Promise<void>
  private idle?: NodeJS.Timeout
  private readonly dir: string
  private readonly width: number
  private readonly height: number

  constructor(width: number, height: number, tmpDir = join(process.env.TMPDIR || '/tmp', 'atv-browser-av')) {
    this.dir = tmpDir
    this.width = width
    this.height = height
  }

  /** Starts the virtual screen and sound card (once), before Chrome launches onto them. */
  async ensureDisplay(): Promise<void> {
    mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 })
    if (!this.xvfb || this.xvfb.exitCode !== null) {
      this.xvfb = spawn(XVFB, [AV_DISPLAY, '-screen', '0', `${this.width}x${this.height}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' })
      this.xvfb.on('exit', () => (this.xvfb = undefined))
    }
    this.pulseReady ??= new Promise<void>((resolve) => {
      const p = spawn(PULSE, ['--daemonize=yes', '--exit-idle-time=-1', '-n', `--load=module-null-sink sink_name=${SINK}`, '--load=module-native-protocol-unix'], {
        stdio: 'ignore',
        env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir(), HOME: process.env.HOME || '/tmp' },
      })
      p.on('exit', () => resolve())
      p.on('error', () => resolve())
    })
    await this.pulseReady
    // Xvfb needs a moment before clients can connect.
    await new Promise((r) => setTimeout(r, 500))
  }

  private touch(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stopStream(), IDLE_MS)
    this.idle.unref()
  }

  private async startStream(): Promise<void> {
    if (this.ffmpeg && this.ffmpeg.exitCode === null) return
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(this.dir, { recursive: true })
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'x11grab', '-draw_mouse', '0', '-video_size', `${this.width}x${this.height}`, '-framerate', '25', '-i', AV_DISPLAY,
      '-f', 'pulse', '-i', `${SINK}.monitor`,
      // TVs decode 4:2:0 H.264 Main; one keyframe a second keeps segments short.
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', '25', '-b:v', '3500k',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
      '-f', 'hls', '-hls_time', '1', '-hls_list_size', '6', '-hls_flags', 'delete_segments+omit_endlist',
      '-hls_segment_filename', join(this.dir, 'seg%05d.ts'), join(this.dir, 'live.m3u8'),
    ]
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir() } })
    this.ffmpeg = ff
    ff.stderr?.on('data', (d: Buffer) => console.warn('[browser-av]', String(d).trim()))
    ff.on('exit', () => {
      if (this.ffmpeg === ff) this.ffmpeg = undefined
    })
    console.log('[browser-av] stream started')
    // The player needs a playlist with a few segments before it starts.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200))
      if (readdirSync(this.dir).filter((f) => f.endsWith('.ts')).length >= 2 && existsSync(join(this.dir, 'live.m3u8'))) return
      if (ff.exitCode !== null) break
    }
    throw new Error('Zachytávání obrazu se nespustilo')
  }

  stopStream(): void {
    if (!this.ffmpeg) return
    this.ffmpeg.kill('SIGTERM')
    this.ffmpeg = undefined
    console.log('[browser-av] stream stopped')
  }

  stopAll(): void {
    this.stopStream()
    this.xvfb?.kill()
    this.xvfb = undefined
  }

  /** Serves /api/browser/av/<file>: the playlist (starting the capture) or a segment. */
  async serve(file: string, res: ServerResponse, beforeStart: () => Promise<void>): Promise<void> {
    if (file !== 'live.m3u8' && !/^seg\d{5}\.ts$/.test(file)) {
      res.writeHead(404).end()
      return
    }
    this.touch()
    if (file === 'live.m3u8') {
      this.starting ??= beforeStart().then(() => this.startStream()).finally(() => (this.starting = undefined))
      await this.starting
    }
    try {
      const body = await readFile(join(this.dir, file))
      res.writeHead(200, {
        'content-type': file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  }
}
