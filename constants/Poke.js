import Data from "../components/Data.js"
import fs from "node:fs"
import { Poke_Path } from "./Path.js"

let Poke_List = Array.from(Data.getJSON("FaceList.json", "json"))

const PokeGitURL = "https://cnb.cool/denfenglai/poke.git"

/**
 * 兼容用户自建目录
 * 用户可以在resources/poke下自建多个目录用于存放图片
 */
;(async() => {
  if (fs.existsSync(Poke_Path)) {
    try {
      const directories = await fs.promises.readdir(Poke_Path, { withFileTypes: true })
      const dirNames = directories
        .filter(dirent => dirent.isDirectory() && dirent.name !== ".git" && !dirent.name.startsWith("."))
        .map(dirent => dirent.name)
      Poke_List = Array.from(new Set([ ...Poke_List, ...dirNames ]))
    } catch (e) { }
  }
})()

export { Poke_List, PokeGitURL }
