import fs from "node:fs/promises"
import path from "node:path"
import { exec } from "child_process"
import { Path, Config, common } from "#components"
import { logger } from "#lib"

/**
 * 动态保存各平台仓库路径（key -> Array<string>)
 * 使用 registerHost 可以添加新的平台支持，PluginPath 会自动创建对应键
 */
export const PluginPath = Object.create(null)

/** 是否为载入中 */
export let Loading = false

// 默认忽略目录（可通过 setIgnore 扩展/覆盖）
const DEFAULT_IGNORE = [ "data", "node_modules", "temp", "logs", "cache", "dist" ]
let IGNORE = new Set(DEFAULT_IGNORE)

const hosts = []

/**
 * 注册一个新的 host
 * @param {string} key - 存储在 PluginPath 的 key 名称（例如 'GitHub' 或 'cnb'）
 * @param {RegExp} pattern - 用于从远程 URL 提取 repo slug 的正则（请使用命名捕获组 `repo`）
 */
export function registerHost(key, pattern) {
  const normalizedKey = String(key)
  hosts.push({ key: normalizedKey, pattern })
  if (!PluginPath[normalizedKey]) PluginPath[normalizedKey] = []
}

// 注册常见平台（可按需删除/修改）
registerHost("GitHub", /github\.com[:/](?<repo>[^/]+\/[^^/.]+)(?:\.git)?/i)
registerHost("Gitee", /gitee\.com[:/](?<repo>[^/]+\/[^^/.]+)(?:\.git)?/i)
registerHost("Gitcode", /gitcode\.com[:/](?<repo>[^/]+\/[^^/.]+)(?:\.git)?/i)
registerHost("CNB", /cnb\.cool[:/](?<repo>[^/]+\/[^^/.]+)(?:\.git)?/i)

/**
 * 设置/覆盖忽略目录集合
 * @param {string[]} list
 */
export function setIgnore(list) {
  IGNORE = new Set(list)
}

/**
 * 添加额外的忽略目录到现有集合
 * @param {string[]} list
 */
export function addIgnore(list) {
  for (const i of list) IGNORE.add(i)
}

/**
 * 加载本地 Git 仓库并填充 PluginPath
 * @param root
 */
export async function loadLocalPlugins(root = Path) {
  Loading = true
  const timer = common.createTimer()
  logger.mark("正在载入本地Git仓库列表")
  timer.start()

  for (const k of Object.keys(PluginPath)) PluginPath[k].length = 0

  try {
    const found = await findRepos(root)
    for (const { key } of hosts) {
      const arr = found[key.toLowerCase()] || []
      PluginPath[key].push(...arr)
    }
  } catch (err) {
    logger.error("加载本地Git仓库时出错:", err)
  } finally {
    Loading = false
    logger.mark(`本地Git仓库载入完成, 耗时: ${timer.end()}`)
  }
}

/**
 * 遍历目录并收集 Git 仓库信息
 * 返回的对象键为小写 host key（方便内部处理）
 * @param rootDir
 */
async function findRepos(rootDir) {
  const result = {}
  for (const { key } of hosts) result[key.toLowerCase()] = []
  await traverse(rootDir, result)
  return result
}

/**
 * 判断是否为 Git 仓库（检查 .git 是否存在）
 * @param dir
 */
async function isGitRepo(dir) {
  try {
    await fs.access(path.join(dir, ".git"))
    return true
  } catch {
    return false
  }
}

/**
 * 在指定目录执行 shell 命令并返回输出
 * @param cwd
 * @param cmd
 */
function execCmd(cwd, cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, out) => (err ? reject(err) : resolve(String(out).trim())))
  })
}

/**
 * 递归遍历目录以查找 Git 仓库（对错误有容错）
 * @param dir
 * @param result
 */
async function traverse(dir, result) {
  try {
    if (await isGitRepo(dir)) {
      await collectRepoInfo(dir, result)
    }

    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      if (IGNORE.has(dirent.name)) continue
      const sub = path.join(dir, dirent.name)
      await traverse(sub, result)
    }
  } catch (err) {
    logger.warn(`无法扫描文件夹: ${dir} -> ${err && err.message ? err.message : err}`)
  }
}

/**
 * 收集单个仓库的远程信息并按注册 host 分类
 * @param repoDir
 * @param result
 */
async function collectRepoInfo(repoDir, result) {
  try {
    let branch = ""
    try {
      branch = await execCmd(repoDir, "git rev-parse --abbrev-ref HEAD")
    } catch {
      try {
        branch = await execCmd(repoDir, "git branch --show-current")
      } catch {
        branch = "HEAD"
      }
    }

    // 优先使用 origin，如果没有配置分支对应的 remote，则退到 origin
    let remoteName = "origin"
    try {
      const configured = await execCmd(repoDir, `git config branch.${branch}.remote`)
      if (configured) remoteName = configured
    } catch {
      // ignore
    }

    // 获取远程 URL（fetch first available）
    let url = ""
    try {
      url = await execCmd(repoDir, `git remote get-url ${remoteName}`)
    } catch {
      // fallback: 列出 remotes 并挑第一个能解析出的 url
      try {
        const remotes = await execCmd(repoDir, "git remote -v")
        const lines = remotes.split(/\r?\n/)
        for (const l of lines) {
          const m = l.match(/\s*(\S+)\s+(\S+)\s+\(fetch\)/)
          if (m) { url = m[2]; break }
        }
      } catch {
        // 无法读取远程信息
      }
    }

    if (!url) {
      logger.warn(`仓库未发现远程地址: ${repoDir}`)
      return
    }

    classify(url.trim(), branch, result)
  } catch (err) {
    logger.warn(`Git仓库信息收集失败: ${repoDir} -> ${err && err.message ? err.message : err}`)
  }
}

/**
 * 将远程 url 与已注册的 hosts 匹配，并把 repo:branch 保存到对应结果
 * @param url
 * @param branch
 * @param result
 */
function classify(url, branch, result) {
  for (const { key, pattern } of hosts) {
    const m = url.match(pattern)
    if (m?.groups?.repo) {
      const lower = key.toLowerCase()
      if (!result[lower]) result[lower] = []
      result[lower].push(`${m.groups.repo}:${branch}`)
      return
    }
  }
}

// 如果配置开启则自动启动
if (Config.AutoPath) loadLocalPlugins()

export default {
  registerHost,
  loadLocalPlugins,
  setIgnore,
  addIgnore,
  PluginPath,
  hosts
}
