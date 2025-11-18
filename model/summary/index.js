import { Config, request } from "#components"
import _ from "lodash"
import { logger } from "#lib"

let Sum
let lock = false
let raw

export default new class Summary {
  init() {
    raw = segment.image
    Sum = this.getSummary("ciallo")
    if (Config.summary.type === 2) this.getSummaryApi()
    segment.image = (...args) => {
      const im = raw(...args)
      im.summary ??= this.getSummary()
      return im
    }
  }

  /**
   * 获取外显
   * @param {1|2|3|"ciallo"} type
   */
  getSummary(type = Config.summary.type) {
    switch (type) {
      case 1:
        return Config.summary.text
      case 2: {
        const data = Sum
        this.getSummaryApi()
        return data
      }
      case 3:
        return _.sample(Config.summary.list)
      case "ciallo":
      default:
        return "Ciallo ~ (∠・ω< )⌒★"
    }
  }

  /** 更新一言外显 */
  async getSummaryApi() {
    if (lock) return
    lock = true
    try {
      const data = await request.get(Config.summary.api, { responseType: "text", log: false })
      if (data) {
        logger.debug("一言外显更新失败")
        Sum = data
      }
    } catch (err) {
      logger.error(`获取一言接口时发生错误：${err}`)
    } finally {
      lock = false
    }
  }

  /**
   * 开关外显
   * @param value 开关
   */
  async Switch(value) {
    if (value) {
      this.init()
    } else {
      if (typeof raw === "function") segment.image = raw
    }
  }
}()
