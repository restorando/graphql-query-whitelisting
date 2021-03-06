import supertest from 'supertest'
import chai from 'chai'
import spies from 'chai-spies'

import app from './app'
import graphqlWhitelist from '../lib'
import { MemoryStore } from '../lib/store'
import { QueryRepository } from '../lib/utils'

chai.use(spies)

const { expect } = chai

describe('Query whitelisting middleware', () => {
  const validQuery = 'query ValidQuery { firstName }'
  const validQueryId = 'Hwf+pzIq09drbuQSzDSAXEwuk9HfwrGKw7yFzd1buNM='
  const invalidQuery = 'query InvalidQuery { lastName }'
  const unauthorizedError = { errors: [{ message: 'Unauthorized query' }] }

  let store, repository, request

  beforeEach(async () => {
    store = new MemoryStore()
    repository = new QueryRepository(store)
    await repository.put(validQuery)
    request = supertest(app({ store }))
  })

  describe('Query whitelisting', () => {
    it('throws an error if body is not being parsed before by a middleware', done => {
      supertest(app({ store, noBodyParser: true }))
        .get('/graphql')
        .query({ query: validQuery })
        .expect(500, (err, res) => {
          if (err) return done(err)
          expect(res.error.text).to.include('body-parser middleware')
          done()
        })
    })

    it('allows a valid query', done => {
      request
        .post('/graphql')
        .send({ query: validQuery })
        .expect({ data: { firstName: 'John' } }, done)
    })

    it('doesn\'t allow an invalid query', done => {
      request
        .post('/graphql')
        .send({ query: invalidQuery })
        .expect(401, unauthorizedError, done)
    })

    it('allows to send only the queryId using a body parameter', done => {
      request
        .post('/graphql')
        .send({ queryId: validQueryId })
        .expect({ data: { firstName: 'John' } }, done)
    })

    it('allows to send only the queryId using a query parameter', done => {
      request
        .post('/graphql')
        .query({ queryId: validQueryId })
        .expect({ data: { firstName: 'John' } }, done)
    })

    it('skips the middleware for a GET if no query is being sent', done => {
      request
        .get('/graphql')
        .expect(400, { errors: [{ message: 'Must provide query string.' }] }, done)
    })

    it('allows to query the schema via GET', done => {
      request
        .get('/graphql')
        .query({ query: invalidQuery })
        .expect(401, done)
    })

    it('allows to query the schema via GET using a queryId', done => {
      request
        .get('/graphql')
        .query({ queryId: validQueryId })
        .expect(200, { data: { firstName: 'John' } }, done)
    })
  })

  describe('Query normalization', () => {
    [validQuery, 'query ValidQuery \n{\n\nfirstName\n\n          }'].forEach((query) => {
      it(`adds the QueryId and the normalizedQuery attributes to the req object`, async () => {
        const req = { body: { query }, query: {} }
        const res = {}
        const next = () => {}

        const normalizedQuery = 'query ValidQuery {\n  firstName\n}\n'

        await graphqlWhitelist({ store })(req, res, next)

        expect(req.queryId).to.equal(validQueryId)
        expect(req.operationName).to.equal('ValidQuery')
        expect(req.body.query).to.equal(normalizedQuery)
      })
    })
  })

  describe('Skip validation function', () => {
    it('doesn\'t skip the middleware if the skip function is not provided', done => {
      const request = supertest(app({ store }))

      request
        .post('/graphql')
        .send({ query: invalidQuery })
        .expect(401)
        .expect(unauthorizedError, done)
    })

    it('skips the middleware if the skip function returns a truthy value', done => {
      const request = supertest(app({ store, skipValidationFn: () => true }))

      request
        .post('/graphql')
        .send({ query: invalidQuery })
        .expect({ data: { lastName: 'Cook' } }, done)
    })

    it('doesn\'t skip the middleware if the skip function returns a falsey value', done => {
      const request = supertest(app({ store, skipValidationFn: () => false }))

      request
        .post('/graphql')
        .send({ query: invalidQuery })
        .expect(401)
        .expect(unauthorizedError, done)
    })
  })

  describe('Error validation function', () => {
    it('calls the error validation function if the query is invalid', done => {
      const spy = chai.spy()
      const request = supertest(app({ store, validationErrorFn: spy }))

      request
        .post('/graphql')
        .send({ query: invalidQuery })
        .expect(401, (err, res) => {
          if (err) return done(err)
          expect(spy).to.have.been.called()
          done()
        })
    })

    it('doesn\'t call the error validation function if the query is valid', done => {
      const spy = chai.spy()
      const request = supertest(app({ store, validationErrorFn: spy }))

      request
        .post('/graphql')
        .send({ query: validQuery })
        .expect(200, (err, res) => {
          if (err) return done(err)
          expect(spy).to.not.have.been.called()
          done()
        })
    })

    describe('Dry run', () => {
      it('calls the error validation function but skips the whitelisting', done => {
        const spy = chai.spy()
        const request = supertest(app({ store, validationErrorFn: spy, dryRun: true }))

        request
          .post('/graphql')
          .send({ query: invalidQuery })
          .expect(200, (err, res) => {
            if (err) return done(err)
            expect(spy).to.have.been.called()
            done()
          })
      })
    })
  })
})
