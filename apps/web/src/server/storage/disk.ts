import { mkdir, writeFile, readFile, unlink, access } from "fs/promises"
import { join, dirname } from "path"

const DEFAULT_STORAGE_DIR = "./data"

/**
 * Disk-based filesystem storage for persistent documents.
 * Used in development (NODE_ENV !== 'production').
 */
export class DiskStorage {
  readonly name = "disk"
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.LOCAL_STORAGE_DIR || DEFAULT_STORAGE_DIR
  }

  private getFullPath(relativePath: string): string {
    return join(this.baseDir, relativePath)
  }

  /**
   * Save a file to local storage.
   * Creates parent directories if they don't exist.
   */
  async saveFile(relativePath: string, data: Buffer | string): Promise<void> {
    const fullPath = this.getFullPath(relativePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, data)
  }

  /**
   * Read a file from local storage.
   */
  async readFile(relativePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(relativePath)
    return readFile(fullPath)
  }

  /**
   * Read a file as string from local storage.
   */
  async readFileAsString(relativePath: string): Promise<string> {
    const fullPath = this.getFullPath(relativePath)
    return readFile(fullPath, "utf-8")
  }

  /**
   * Check if a file exists.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await access(this.getFullPath(relativePath))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false
      }
      throw error
    }
  }

  /**
   * Delete a file from local storage.
   * @returns true if deleted or doesn't exist, false on error
   */
  async deleteFile(relativePath: string): Promise<boolean> {
    try {
      await unlink(this.getFullPath(relativePath))
      return true
    } catch (error) {
      // File doesn't exist = success
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true
      }
      console.warn(`[DiskStorage] Failed to delete ${relativePath}:`, error)
      return false
    }
  }

  /**
   * Get the full filesystem path for a relative path.
   * Useful for serving files directly.
   */
  getFilePath(relativePath: string): string {
    return this.getFullPath(relativePath)
  }
}
