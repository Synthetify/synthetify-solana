const anchor = require('@project-serum/anchor')
const assert = require('assert')
describe('oracle customer', () => {
  const provider = anchor.Provider.local()
  anchor.setProvider(provider)

  const program = anchor.workspace.OracleCustomer

  const oracleProgram = anchor.workspace.Oracle
  const initPrice = new anchor.BN(100)
  const ticker = Buffer.from('GME', 'utf-8')
  let priceFeed
  let admin
  before(async () => {
    await program.state.rpc.new({
      accounts: {},
    })
  })
  beforeEach(async () => {
    priceFeed = new anchor.web3.Account()
    admin = new anchor.web3.Account()
    await oracleProgram.rpc.create(admin.publicKey, initPrice, ticker, {
      accounts: {
        priceFeed: priceFeed.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [priceFeed],
      instructions: [await oracleProgram.account.priceFeed.createInstruction(priceFeed, 56)],
    })
  })
  it('Check initialState', async () => {
    const state = await program.state()
    assert.ok(state.price.eq(new anchor.BN(0)))
    assert.ok(state.ticker.equals(Buffer.from([1, 2, 3])))
    // Oracle account
    const oracleAccount = await oracleProgram.account.priceFeed(priceFeed.publicKey)
    assert.equal(oracleAccount.paused, false)
    assert.ok(oracleAccount.price.eq(initPrice))
    assert.ok(oracleAccount.admin.equals(admin.publicKey))
    assert.ok(oracleAccount.symbol.equals(ticker))
  })

  it('Pull data from priceFeed', async () => {
    await program.state.rpc.pullData({
      accounts: {
        priceFeedAccount: priceFeed.publicKey,
      },
    })
    const state = await program.state()
    assert.ok(state.price.eq(initPrice))
    assert.ok(state.ticker.equals(ticker))
  })
})
