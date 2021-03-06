const path = require('path')
const JSON5 = require('json5')
const merge = require('lodash.merge')
const compose = require('compose-function')
const replaceExt = require('replace-ext')
const loaderUtils = require('loader-utils')
const resolveFrom = require('resolve-from')
const ensurePosix = require('ensure-posix-path')
const pMap = require('p-map')
const pAll = require('p-all')

const helpers = require('../helpers')

function stripExt(path) {
  return replaceExt(path, '')
}

function mapObject(object, iteratee) {
  let result = {}
  for (let key in object) {
    result[key] = iteratee(object[key], key, object)
  }
  return result
}

function resolveFile(dirname, target, context) {
  let resolve = target =>
    compose(
      ensurePosix,
      helpers.toSafeOutputPath
    )(resolveFromModule(context, target))

  if (target.startsWith('/')) {
    return resolve(target.slice(1))
  }

  // relative url
  return resolve(path.relative(context, path.resolve(dirname, target)))
}

function resolveFromModule(context, filename) {
  return stripExt(
    path.relative(
      context,
      resolveFrom(context, loaderUtils.urlToRequest(filename))
    )
  )
}

module.exports = function(source) {
  const done = this.async()
  const webpackOptions = loaderUtils.getOptions(this) || {}
  const options = merge(
    {},
    {
      publicPath: helpers.getPublicPath(webpackOptions, this),
    },
    webpackOptions
  )
  const relativeToRoot = path.relative(
    path.dirname(this.resource),
    this.rootContext
  )
  const loadModule = helpers.loadModule.bind(this)

  let config
  try {
    config = JSON5.parse(source)
  } catch (error) {
    return done(error)
  }

  if (!config) {
    return done(null, '')
  }

  Promise.resolve(config)
    /**
     * pages
     */
    .then(config => {
      const { pages } = config
      if (!Array.isArray(pages) && typeof pages !== 'object') {
        return config
      }

      const map = Array.isArray(pages)
        ? [].map.bind(pages)
        : mapObject.bind(null, pages)
      return Object.assign(config, {
        pages: map(page => resolveFile(this.context, page, this.rootContext)),
      })
    })
    /**
     * usingComponents
     */
    .then(config => {
      if (typeof config.usingComponents !== 'object') {
        return config
      }

      return Object.assign(config, {
        usingComponents: mapObject(config.usingComponents, file => {
          if (file.startsWith('plugin://')) {
            return file
          }

          return `/${resolveFile(this.context, file, this.rootContext)}`
        }),
      })
    })
    /**
     * publicComponents
     */
    .then(config => {
      if (typeof config.publicComponents !== 'object') {
        return config
      }

      return Object.assign(config, {
        publicComponents: mapObject(config.publicComponents, file =>
          resolveFile(this.context, file, this.rootContext)
        ),
      })
    })
    /**
     * tabBar
     */
    .then(config => {
      if (!config.tabBar || !Array.isArray(config.tabBar.list)) {
        return config
      }

      function loadAndReplace(tab, field) {
        return loadModule(tab[field])
          .then(source => helpers.extract(source, options.publicPath))
          .then(outputPath =>
            Object.assign(tab, {
              [field]: outputPath,
            })
          )
      }

      return pMap(config.tabBar.list, tab => {
        if (tab.pagePath) {
          tab = Object.assign(tab, {
            pagePath: ensurePosix(stripExt(tab.pagePath)),
          })
        }
        return Promise.resolve(tab)
          .then(tab => {
            if (!tab.iconPath) {
              return tab
            }
            return loadAndReplace(tab, 'iconPath')
          })
          .then(tab => {
            if (!tab.selectedIconPath) {
              return tab
            }
            return loadAndReplace(tab, 'selectedIconPath')
          })
      }).then(list =>
        Object.assign(config, {
          tabBar: Object.assign(config.tabBar, {
            list,
          }),
        })
      )
    })
    .then(config =>
      done(null, JSON.stringify(config, null, webpackOptions.minimize ? 0 : 2))
    )
    .catch(error => done(error))
}
