import { existsSync, mkdirSync } from "fs"
import { resolve, basename } from "path"
import { spawn } from "bun"
import { MUSIC_TRACKS } from "../../apps/web/src/audio/constants"
import { ROOT_DIR, colors } from "./utils"

const MUSIC_DIR = resolve(ROOT_DIR, "apps/web/public/audio/music")
const PREVIEWS_DIR = resolve(MUSIC_DIR, "previews")

export async function generateMusicPreviews(): Promise<void> {
  if (!existsSync(PREVIEWS_DIR)) {
    mkdirSync(PREVIEWS_DIR, { recursive: true })
  }

  for (const track of MUSIC_TRACKS) {
    if (!track.src) continue

    const filename = basename(track.src)
    const srcPath = resolve(MUSIC_DIR, filename)
    const previewPath = resolve(PREVIEWS_DIR, filename)

    if (existsSync(previewPath)) continue
    if (!existsSync(srcPath)) {
      console.log(colors.yellow(`Skipping ${filename}: source not found`))
      continue
    }

    console.log(colors.cyan(`Generating preview: ${filename}`))
    const startTime = track.previewStart ?? 0

    // 15s clip with 0.2s fade in/out
    const proc = spawn({
      cmd: [
        "ffmpeg",
        "-y",
        "-ss",
        String(startTime),
        "-i",
        srcPath,
        "-t",
        "15",
        "-af",
        "afade=t=in:st=0:d=0.2,afade=t=out:st=14.8:d=0.2",
        previewPath,
      ],
      stdout: "ignore",
      stderr: "pipe",
    })

    await proc.exited
    if (proc.exitCode === 0) {
      console.log(colors.green(`Created: previews/${filename}`))
    } else {
      console.log(colors.red(`Failed: ${filename}`))
    }
  }
}
