import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/app.js'

describe('anvil-router health endpoint', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })
    expect(res.statusCode).toBe(200)
  })

  it('GET /health returns { status: "ok", service: "anvil-router" }', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })
    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('anvil-router')
  })

  it('GET /health body includes a version string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })
    const body = JSON.parse(res.payload)
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })
})
