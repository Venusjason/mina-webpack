const path = require('path')
const fs = require('fs-extra')
const JSON5 = require('json5')
const replaceExt = require('replace-ext')
const resolve = require('resolve')
const ensurePosix = require('ensure-posix-path')
const { urlToRequest } = require('loader-utils')
const { parseComponent } = require('vue-template-compiler')
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin')
const MultiEntryPlugin = require('webpack/lib/MultiEntryPlugin')
const compose = require('compose-function')

const { toSafeOutputPath, getResourceUrlFromRequest } = require('./helpers')

const RESOLVE_EXTENSIONS = ['.js', '.wxml', '.json', '.wxss']

function isAbsoluteUrl(url) {
  return !!url.startsWith('/')
}

function addEntry(context, item, name) {
  if (Array.isArray(item)) {
    return new MultiEntryPlugin(context, item, name)
  }
  return new SingleEntryPlugin(context, item, name)
}

function readConfig(minaFilePath) {
  let buffer = fs.readFileSync(minaFilePath)
  let blocks = parseComponent(buffer.toString()).customBlocks
  let matched = blocks.find(block => block.type === 'config')
  if (!matched || !matched.content || !matched.content.trim()) {
    return {}
  }
  return JSON5.parse(matched.content)
}

function getRequestsFromConfig(config) {
  let requests = []
  if (!config) {
    return requests
  }
  if (Array.isArray(config.pages)) {
    requests = [...requests, ...config.pages]
  }

  if (config.main) {
    urls = [...urls, config.main]
  }

  ;['pages', 'usingComponents', 'publicComponents'].forEach(prop => {
    if (typeof config[prop] !== 'object') {
      return
    }

    requests = [
      ...requests,
      ...Object.keys(config[prop]).map(tag => config[prop][tag]),
    ]
  })
  return requests
}

function getItems(rootContext, entry) {
  let memory = []

  function search(currentContext, originalRequest) {
    let resourceUrl = getResourceUrlFromRequest(originalRequest)
    let request = urlToRequest(
      isAbsoluteUrl(resourceUrl)
        ? resourceUrl.slice(1)
        : path.relative(rootContext, path.resolve(currentContext, resourceUrl))
    )

    let resourcePath, isSeparation
    try {
      resourcePath = resolve.sync(request, {
        basedir: rootContext,
        extensions: [],
      })
      isSeparation = false
    } catch (error) {
      resourcePath = resolve.sync(request, {
        basedir: rootContext,
        extensions: RESOLVE_EXTENSIONS,
      })
      request = `!${require.resolve('@tinajs/mina-loader')}!${require.resolve(
        './virtual-mina-loader.js'
      )}!${resourcePath}`
      isSeparation = true
    }

    let name = compose(
      ensurePosix,
      path => replaceExt(path, '.js'),
      urlToRequest,
      toSafeOutputPath
    )(path.relative(rootContext, resourcePath))

    let current = {
      name,
      request,
    }

    if (memory.some(item => item.request === current.request)) {
      return
    }
    memory.push(current)

    if (isSeparation) {
      return
    }
    let requests = getRequestsFromConfig(readConfig(resourcePath))
    if (requests.length > 0) {
      requests.forEach(req => {
        if (req.startsWith('plugin://')) {
          return
        }
        return search(path.dirname(resourcePath), req)
      })
    }
  }

  search(rootContext, entry)
  return memory
}

module.exports = class MinaEntryWebpackPlugin {
  constructor(options = {}) {
    this.map =
      options.map ||
      function(entry) {
        return entry
      }

    /**
     * cache items to prevent duplicate `addEntry` operations
     */
    this._items = []
  }

  rewrite(compiler, done) {
    try {
      let { context, entry } = compiler.options

      // assume the latest file in array is the app.mina
      if (Array.isArray(entry)) {
        entry = entry[entry.length - 1]
      }

      getItems(context, entry).forEach(item => {
        if (this._items.some(({ request }) => request === item.request)) {
          return
        }
        this._items.push(item)

        addEntry(context, this.map(ensurePosix(item.request)), item.name).apply(
          compiler
        )
      })
    } catch (error) {
      if (typeof done === 'function') {
        console.error(error)
        return done()
      }
      throw error
    }

    if (typeof done === 'function') {
      done()
    }

    return true
  }

  apply(compiler) {
    compiler.hooks.entryOption.tap('MinaEntryPlugin', () =>
      this.rewrite(compiler)
    )
    compiler.hooks.watchRun.tap('MinaEntryPlugin', (compiler, done) =>
      this.rewrite(compiler, done)
    )
  }
}
