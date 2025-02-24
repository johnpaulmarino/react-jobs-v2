import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { getDisplayName, isPromise, propsWithoutInternal } from './utils'

const validSSRModes = ['resolve', 'defer', 'boundary']
const neverWorkAgain = () => false

export default function withJob(config) {
  if (typeof config !== 'object') {
    throw new Error('You must provide a config object to withJob')
  }

  const {
    work,
    LoadingComponent,
    ErrorComponent,
    serverMode = 'resolve',
    shouldWorkAgain = neverWorkAgain,
  } = config

  if (typeof work !== 'function') {
    throw new Error('You must provide a work function to withJob')
  }

  if (validSSRModes.indexOf(serverMode) === -1) {
    throw new Error('Invalid serverMode provided to asyncComponent')
  }

  const env = typeof window === 'undefined' ? 'node' : 'browser'

  return function wrapWithJob(WrappedComponent) {
    let id

    class ComponentWithJob extends Component {
      static displayName = `WithJob(${getDisplayName(WrappedComponent)})`

      static contextTypes = {
        jobs: PropTypes.shape({
          getNextId: PropTypes.func.isRequired,
          register: PropTypes.func.isRequired,
          get: PropTypes.func.isRequired,
          getRehydrate: PropTypes.func.isRequired,
          removeRehydrate: PropTypes.func.isRequired,
        }),
      }

      constructor(props, context) {
        super(props, context)

        // Each instance needs it's own id as that is how we expect work to
        // be executed.  It is not shared between element instances.
        if (context.jobs) {
          id = context.jobs.getNextId()
        }

        let result

        if (context.jobs) {
          result =
            env === 'browser'
              ? context.jobs.getRehydrate(id)
              : context.jobs.get(id)
        }

        this.state = {
          data: result ? result.data : null,
          error: null,
          completed: result != null,
        }
      }

      // @see react-async-walker
      bootstrap() {
        if (env === 'browser') {
          // No logic for browser, just continue
          return true
        }

        // node
        return serverMode === 'defer' ? false : this.resolveWork(this.props)
      }

      componentDidMount() {
        if (!this.state.completed) {
          this.resolveWork(this.props)
        }

        if (this.context.jobs && env === 'browser') {
          this.context.jobs.removeRehydrate(id)
        }
        // end of original code
      }

      componentWillUnmount() {
        this.unmounted = true
      }

      componentDidUpdate(prevProps) {
        if (
          shouldWorkAgain(
            propsWithoutInternal(prevProps),
            propsWithoutInternal(this.props),
            this.getJobState(),
          )
        ) {
          this.resolveWork(this.props)
        }
      }

      resolveWork = props => {
        let workDefinition

        this.setState({ completed: false, data: null, error: null })

        try {
          workDefinition = work(props)
        } catch (error) {
          this.setState({ completed: true, error })
          // Ensures bootstrap stops
          return false
        }

        if (isPromise(workDefinition)) {
          // Asynchronous result.
          return workDefinition
            .then(data => {
              if (this.unmounted) {
                return undefined
              }
              this.setState({ completed: true, data })
              if (this.context.jobs) {
                this.context.jobs.register(id, { data })
              }
              // Ensures bootstrap continues
              return true
            })
            .catch(error => {
              if (this.unmounted) {
                return undefined
              }
              if (env === 'browser') {
                setTimeout(() => {
                  if (!this.unmounted) {
                    this.setState({ completed: true, error })
                  }
                }, 16)
              } else {
                // node
                // We will at least log the error so that user isn't completely
                // unaware of an error occurring.
                // eslint-disable-next-line no-console
                console.warn('Failed to resolve job')
                // eslint-disable-next-line no-console
                console.warn(error)
              }
              // Ensures bootstrap stops
              return false
            })
        }

        // Synchronous result.
        this.setState({ completed: true, data: workDefinition, error: null })

        // Ensures bootstrap continues
        return true
      }

      getJobState = () => ({
        completed: this.state.completed,
        error: this.state.error,
        data: this.state.data,
      })

      render() {
        const { data, error, completed } = this.state

        if (error) {
          return ErrorComponent ? (
            <ErrorComponent {...this.props} error={error} />
          ) : null
        }
        if (!completed) {
          return LoadingComponent ? <LoadingComponent {...this.props} /> : null
        }
        return <WrappedComponent {...this.props} jobResult={data} />
      }
    }

    return ComponentWithJob
  }
}
