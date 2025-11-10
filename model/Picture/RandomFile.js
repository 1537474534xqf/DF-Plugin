import fs from "node:fs"
import lodash from "lodash"
import path from "node:path"
import { logger } from "#lib"
import { Poke_Path, Poke_List, Config } from "#components"
import { pathToFileURL } from "node:url"

/**
 * 随机获取一个文件
 * @param {string} dirPath - 文件夹路径
 * @returns {string|null} path - 文件路径或空
 */
function randomFile(dirPath) {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(dirent => dirent.isFile())
      .map(dirent => dirent.name)

    if (files.length === 0) {
      logger.error(` 获取文件失败: ${dirPath}`)
      return null
    }
    const fileName = lodash.sample(files)
    return pathToFileURL(path.join(dirPath, fileName))
  } catch (err) {
    logger.error(`获取文件错误: ${dirPath}\n${err}`)
    return null
  }
}

/**
 * 抽取随机表情包
 * @param {string} name - 表情包名称
 * @returns {string|null} 文件路径或api地址
 */
function imagePoke(name = "all") {
  let List = Poke_List
  if (name == "all") {
    const { imageBlack } = Config.Poke
    if (Array.isArray(imageBlack) && imageBlack.length > 0) {
      List = Poke_List.filter(type => !imageBlack.includes(type))
    }
    name = lodash.sample(List)
  }
  const path = Poke_Path + "/" + name
  if (!fs.existsSync(path)) return `https://ciallo.hxxn.cc/?name=${name}`
  return randomFile(path)
}

export { randomFile, imagePoke }
