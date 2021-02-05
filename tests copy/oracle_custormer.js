const anchor = require('@project-serum/anchor')
const assert = require('assert')
describe('oracle', () => {
  const provider = anchor.Provider.local()
  anchor.setProvider(provider)

  const program = anchor.workspace.Oracle
})
