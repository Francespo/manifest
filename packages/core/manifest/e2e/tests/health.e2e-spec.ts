import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'

import TestAgent from 'supertest/lib/agent'
import { AppModule } from '../../src/app.module'
import { TypeOrmModule } from '@nestjs/typeorm'
import { YamlService } from '../../src/manifest/services/yaml/yaml.service'

describe('Health (e2e)', () => {
  let app: INestApplication
  let request: TestAgent

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(YamlService)
      .useValue(global.MockYamlService)
      .overrideModule(TypeOrmModule)
      .useModule(TypeOrmModule.forRootAsync(global.mockTypeOrmOptions))
      .compile()

    app = moduleFixture.createNestApplication()
    request = supertest(app.getHttpServer())
    await app.init()
  })

  it('/GET health', () => {
    return request
      .get('/health')
      .expect(200)
      .expect(JSON.stringify({ status: 'OK' }))
  })
})
