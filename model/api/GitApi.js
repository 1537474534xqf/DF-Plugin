import { request, Config } from "#components"
import { logger } from "#lib"

const GitUrl = {
  GitHub: "https://api.github.com/repos",
  Gitee: "https://gitee.com/api/v5/repos",
  Gitcode: "https://api.gitcode.com/api/v5/repos",
  CNB: "https://api.cnb.cool"
}

const ApiUrl = (source) => {
  const CfgApiUrl = Config.CodeUpdate.repos.reduce((acc, item) => {
    acc[item.provider] = item.ApiUrl
    return acc
  }, {})
  return CfgApiUrl[source] || GitUrl[source]
}

export default new class {
  /**
   * 获取仓库的最新数据
   * @param {string} repo - 仓库路径（用户名/仓库名）
   * @param {string} source - 数据源（GitHub/Gitee/Gitcode）
   * @param {string} type - 请求类型（commits/releases）
   * @param {string} token - 访问Token
   * @param {string} sha - 提交起始的SHA值或者分支名. 默认: 仓库的默认分支
   * @returns {Promise<object[]>} 提交数据或false（请求失败）
   */
  async getRepositoryData(repo, source, type = "commits", token, sha) {
    const sourceLower = String(source || "").toLowerCase()
    // const isGitHub = /github/i.test(sourceLower)
    const isGitea = /gitea/i.test(sourceLower)
    const isGitee = /gitee/i.test(sourceLower)
    const isCNB = /cnb/i.test(sourceLower)

    const baseURL = ApiUrl(source)
    if (!baseURL) {
      logger.error(`未知数据源: ${source}`)
      return "return"
    }

    let pathname = ""
    const params = new URLSearchParams()

    if (type === "commits" && sha) {
      if (isGitea) {
      // Gitea: /{repo}/commits?per_page=1&sha={sha}
        pathname = `${repo}/commits`
        params.set("page", "1")
        params.set("sha", sha)
      } else if (isCNB) {
        pathname = `${repo}/-/git/commits/${sha}`
      } else {
        pathname = `${repo}/commits/${sha}`
      }
    } else {
      if (isCNB) {
        pathname = `${repo}/-/git/${type}`
        params.set("page", "1")
      } else {
        pathname = `${repo}/${type}`
        isGitea
          ? params.set("page", "1")
          : params.set("per_page", "1")
      }
    }

    const joinUrl = (base, relative) => {
      try {
        const u = new URL(base)
        const basePath = (u.pathname || "").replace(/\/+$/, "")
        const rel = String(relative).replace(/^\/+/, "")
        u.pathname = basePath === "" ? `/${rel}` : `${basePath}/${rel}`
        return u.toString()
      } catch (e) {
        const b = String(base).replace(/\/+$/, "")
        const r = String(relative).replace(/^\/+/, "")
        return `${b}/${r}`
      }
    }

    const urlBaseWithPath = joinUrl(baseURL, pathname)
    let urlObj
    try {
      urlObj = new URL(urlBaseWithPath)
    } catch (e) {
      logger.error("构造 URL 失败", { baseURL, pathname, err: e })
      return "return"
    }

    for (const [ k, v ] of params.entries()) urlObj.searchParams.set(k, v)

    if (!isGitee && token) urlObj.searchParams.set("access_token", token)

    const headers = this.getHeaders(token, source)

    try {
      const data = await this.fetchData(urlObj.toString(), headers, repo, source)
      return data || "return"
    } catch (err) {
      logger.error("获取仓库数据失败", { url: urlObj.toString(), err })
      return "return"
    }
  }

  /**
   * 获取仓库默认分支
   * @param {string} repo - 仓库路径（用户名/仓库名）
   * @param {string} source - 数据源（GitHub/Gitee/Gitcode）
   * @param {string} token - 访问Token
   * @returns {Promise<string|false>} 默认分支名或false（请求失败）
   */
  async getDefaultBranch(repo, source, token) {
    const baseURL = ApiUrl(source)
    const isCNB = /cnb/i.test(source)

    if (!baseURL) {
      logger.error(`未知数据源: ${source}`)
      return "return"
    }
    let url = `${baseURL}/${repo}`
    if (isCNB) url = `${baseURL}/${repo}/-/git/head`

    const headers = this.getHeaders(token, source)
    const data = await this.fetchData(url, headers, repo, source)
    if (data) {
      return isCNB ? data?.name : data?.default_branch
    } else {
      return "return"
    }
  }

  /**
   * 获取请求头
   * @param {string} token - 访问Token
   * @param {string} source - 数据源（GitHub/Gitee/Gitcode）
   * @returns {object} 请求头
   */
  getHeaders(token, source) {
    const headers = {
      "User-Agent": "request",
      "Accept": (() => {
        switch (source) {
          case "GitHub":
            return "application/vnd.github+json"
          case "Gitee":
            return "application/vnd.gitee+json"
          default:
            return "application/json"
        }
      })()
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }

  /**
   * 获取指定 URL 的 JSON 数据
   * @param {string} url - 请求的 URL
   * @param {object} [headers] - 请求头
   * @param {string} repo - 仓库路径
   * @param {string} source - 数据源
   * @returns {Promise<object | false>} 返回请求的数据或 false（请求失败）
   */
  async fetchData(url, headers = {}, repo, source) {
    try {
      const response = await request.get(url, {
        headers,
        responseType: "raw"
      })

      if (!response.ok) {
        let msg
        switch (response.status) {
          case 401:
            msg = "访问令牌无效或已过期 (code: 401)"
            break
          case 403:
            msg = "请求达到Api速率限制或无权限，请尝试填写token或降低请求频率后重试 (code: 403)"
            break
          case 404:
            msg = "仓库不存在 (code: 404)"
            break
          default:
            msg = `状态码：${response.status}`
            break
        }

        logger.error(`请求 ${logger.magenta(source)} 失败: ${logger.cyan(repo)}, ${msg}`)
        return false
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        logger.error(`响应非 JSON 格式: ${url} , 内容：${await response.text()}`)
        return false
      }

      return await response.json()
    } catch (error) {
      logger.error(`请求失败: ${url}，错误信息: ${error.stack}`)
      return false
    }
  }
}()
