const { dirname } = require('path')
const fs = require('fs-extra')
const replaceExt = require('replace-ext')
const pProps = require('p-props')

const EXTNAMES = {
  template: 'wxml',
  style: 'wxss',
  script: 'js',
  config: 'json',
}

const template = (parts = {}) => {
  let result =
    Object.keys(parts)
      .map(tag => {
        if (!parts[tag]) {
          return ''
        }
        /**
         * We can assume that the generated virtual files are in the same directory as the source files,
         * so there is no need to consider the problem of resolving relative paths here.
         */
        return `<${tag}>${parts[tag]}</${tag}>`
      })
      .join('') || ''
  return result
}

module.exports = function() {
  this.cacheable()

  const done = this.async()

  this.addContextDependency(dirname(this.resourcePath))

  pProps(EXTNAMES, extname => {
    let filePath = replaceExt(this.resourcePath, `.${extname}`)
    return fs.exists(filePath).then(isExist => {
      if (!isExist) {
        return
      }
      this.addDependency(filePath)
      return fs.readFile(filePath, 'utf8')
    })
  })
    .then(parts => done(null, template(parts)))
    .catch(done)
}
