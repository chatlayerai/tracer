'use strict'

const BaseTracer = require('opentracing').Tracer
const opentelemetry = require('@opentelemetry/api')
const NoopTracer = require('./noop/tracer')
const DatadogTracer = require('./tracer')
const Config = require('./config')
const Instrumenter = require('./instrumenter')
const metrics = require('./metrics')
const log = require('./log')
const { setStartupLogInstrumenter } = require('./startup-log')
const NoopSpan = require('./noop/span')

const noop = new NoopTracer()

class Tracer extends BaseTracer {
  constructor () {
    super()
    this._tracer = noop
    this._instrumenter = new Instrumenter(this)
    this._deprecate = (method) =>
      log.deprecate(
        `tracer.${method}`,
        [
          `tracer.${method}() is deprecated.`,
          'Please use tracer.startSpan() and tracer.scope() instead.',
          'See: https://datadog.github.io/dd-trace-js/#manual-instrumentation.'
        ].join(' ')
      )
  }

  init (options) {
    if (this._tracer === noop) {
      try {
        const config = new Config(options)

        log.use(config.logger)
        log.toggle(config.debug, config.logLevel, this)

        if (config.hasOwnProperty('profiling') && config.profiling.enabled) {
          // do not stop tracer initialization if the profiler fails to be imported
          try {
            const profiler = require('./profiler')
            profiler.start(config)
          } catch (e) {
            log.error(e)
          }
        }

        if (config.enabled) {
          if (config.runtimeMetrics) {
            metrics.start(config)
          }

          // dirty require for now so zero appsec code is executed unless explicitely enabled
          if (config.appsec.enabled) {
            require('./appsec').enable(config)
          }

          this._tracer = new DatadogTracer(config)
          this._instrumenter.enable(config)
          setStartupLogInstrumenter(this._instrumenter)
        }
      } catch (e) {
        log.error(e)
      }
    }
    // register as global opentelemetry tracer
    // and context manager
    this.register()
    return this
  }

  use () {
    this._instrumenter.use.apply(this._instrumenter, arguments)
    return this
  }

  trace (name, options, fn) {
    if (!fn) {
      fn = options
      options = {}
    }

    if (typeof fn !== 'function') return

    options = options || {}

    return this._tracer.trace(name, options, fn)
  }

  wrap (name, options, fn) {
    if (!fn) {
      fn = options
      options = {}
    }

    if (typeof fn !== 'function') return fn

    options = options || {}

    return this._tracer.wrap(name, options, fn)
  }

  setUrl () {
    this._tracer.setUrl.apply(this._tracer, arguments)
    return this
  }

  startSpan () {
    return this._tracer.startSpan.apply(this._tracer, arguments)
  }

  inject () {
    return this._tracer.inject.apply(this._tracer, arguments)
  }

  extract () {
    return this._tracer.extract.apply(this._tracer, arguments)
  }

  scopeManager () {
    this._deprecate('scopeManager')
    return this._tracer.scopeManager.apply(this._tracer, arguments)
  }

  scope () {
    return this._tracer.scope.apply(this._tracer, arguments)
  }

  currentSpan () {
    this._deprecate('currentSpan')
    return this._tracer.currentSpan.apply(this._tracer, arguments)
  }

  addSpanProcessor () {
    return this._tracer.addSpanProcessor.apply(this._tracer, arguments)
  }

  bind (callback) {
    this._deprecate('bind')
    return callback
  }

  bindEmitter () {
    this._deprecate('bindEmitter')
  }

  getRumData () {
    return this._tracer.getRumData.apply(this._tracer, arguments)
  }

  register () {
    opentelemetry.trace.setGlobalTracerProvider(this)

    opentelemetry.context.setGlobalContextManager({
      active: () => {
        const activeSpan = this.scope().active()
        return activeSpan || new NoopSpan(this, null)
      },
      with: (span, fn, ...args) => {
        return this.scope().activate(span, () => fn.apply(...args))
      }
    })
  }

  // otel
  getTracer (name, version) {
    return this
  }

  startActiveSpan (name, arg2, arg3, arg4) {
    let opts = {}
    let ctx
    let fn
    if (arguments.length < 2) {
      return
    }
    if (arguments.length === 2) {
      fn = arg2
    } else if (arguments.length === 3) {
      opts = arg2
      fn = arg3
    } else {
      opts = arg2
      ctx = arg3
      fn = arg4
    }
    const ddOptions = {}
    ctx = ctx || this.scope().active()
    if (ctx) {
      ddOptions.childOf = ctx
    }
    return this._tracer.trace(name, ddOptions, (span) => {
      span.addTags(opts.attributes)
      if (typeof fn === 'function') {
        return fn(span)
      }
    })
  }
}

module.exports = Tracer
